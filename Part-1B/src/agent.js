'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 2_000;
const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    category: { type: 'STRING', enum: ['NETWORK', 'HARDWARE', 'ACCESS', 'SOFTWARE', 'SECURITY', 'UNKNOWN'] },
    priority: { type: 'STRING', enum: ['P1', 'P2', 'P3', 'P4'] },
    assignedTeam: {
      type: 'STRING',
      enum: ['NET_OPS', 'ENDPOINT_SUPPORT', 'IAM_SECURITY', 'APP_SUPPORT', 'MANUAL_TRIAGE']
    },
    summary: { type: 'STRING' },
    extractedEntities: { type: 'ARRAY', items: { type: 'STRING' } },
    requiresClarification: { type: 'BOOLEAN' },
    clarificationQuestion: { type: 'STRING', nullable: true },
    guardrailTriggered: { type: 'BOOLEAN' },
    refusalReason: { type: 'STRING', nullable: true },
    suggestedAction: { type: 'STRING' }
  },
  required: [
    'category',
    'priority',
    'assignedTeam',
    'summary',
    'extractedEntities',
    'requiresClarification',
    'clarificationQuestion',
    'guardrailTriggered',
    'refusalReason',
    'suggestedAction'
  ]
};

let requestQueue = Promise.resolve();
let lastRequestStartedAt = 0;

class ConfigurationError extends Error {
  constructor(code) {
    super('Agent configuration is invalid.');
    this.name = 'ConfigurationError';
    this.code = code;
    this.attemptCount = 0;
    this.latencyMs = 0;
  }
}

class ExternalApiError extends Error {
  constructor(code, { status = null, attemptCount, latencyMs, diagnosticCode = null }) {
    super('Gemini API request failed.');
    this.name = 'ExternalApiError';
    this.code = code;
    this.status = status;
    this.attemptCount = attemptCount;
    this.latencyMs = latencyMs;
    this.diagnosticCode = diagnosticCode;
  }
}

class ApplicationResponseError extends Error {
  constructor(code, { attemptCount, latencyMs }) {
    super('Gemini returned an unusable response.');
    this.name = 'ApplicationResponseError';
    this.code = code;
    this.attemptCount = attemptCount;
    this.latencyMs = latencyMs;
  }
}

function parseDotEnv(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const assignment = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!assignment) continue;

    let value = assignment[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[assignment[1]] = value;
  }
  return values;
}

function loadEnvironment(options) {
  if (options.env !== undefined) return { ...options.env };

  const envPaths = options.dotenvPaths || [
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env')
  ];
  const fileValues = {};
  for (const envPath of [...new Set(envPaths)]) {
    try {
      Object.assign(fileValues, parseDotEnv(fs.readFileSync(envPath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new ConfigurationError('DOTENV_READ_FAILED');
    }
  }
  return {
    ...fileValues,
    ...process.env,
    LLM_MODEL: fileValues.LLM_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL
  };
}

function resolveConfiguration(environment) {
  const apiKey = typeof environment.GEMINI_API_KEY === 'string'
    ? environment.GEMINI_API_KEY.trim()
    : '';
  const configuredModel = typeof environment.LLM_MODEL === 'string'
    ? environment.LLM_MODEL.trim()
    : DEFAULT_MODEL;
  const model = configuredModel.replace(/^models\//, '').trim() || DEFAULT_MODEL;
  if (!apiKey || /^replace_with_your_key$/i.test(apiKey)) {
    throw new ConfigurationError('GEMINI_API_KEY_MISSING');
  }

  const configuredInterval = environment.GEMINI_MIN_INTERVAL_MS;
  let minIntervalMs = DEFAULT_MIN_INTERVAL_MS;
  if (configuredInterval !== undefined && configuredInterval !== '') {
    minIntervalMs = Number(configuredInterval);
    if (!Number.isSafeInteger(minIntervalMs) || minIntervalMs < 0) {
      throw new ConfigurationError('GEMINI_MIN_INTERVAL_MS_INVALID');
    }
    minIntervalMs = Math.max(DEFAULT_MIN_INTERVAL_MS, minIntervalMs);
  }
  return { apiKey, model, minIntervalMs };
}

function loadSystemPrompt() {
  const promptPath = path.resolve(__dirname, '..', 'prompts', 'system-prompt.md');
  try {
    return fs.readFileSync(promptPath, 'utf8');
  } catch {
    throw new ConfigurationError('SYSTEM_PROMPT_UNAVAILABLE');
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(headerValue, now) {
  if (typeof headerValue !== 'string' || headerValue.trim() === '') return 0;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(headerValue);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

function makeError(code, status, attempts, latencyMs, diagnosticCode = null) {
  return new ExternalApiError(code, {
    status,
    attemptCount: attempts,
    latencyMs: Math.max(0, latencyMs),
    diagnosticCode
  });
}

function classifyProviderError(status, responseText) {
  let message = '';
  try {
    message = String(JSON.parse(responseText)?.error?.message || '').toLowerCase();
  } catch {
    return null;
  }
  if (status === 404 && /no longer available to new users/.test(message)) {
    return 'MODEL_RETIRED_FOR_NEW_USERS';
  }
  if (status === 404 && /not found for api version|not supported for .*generatecontent/.test(message)) {
    return 'MODEL_UNAVAILABLE_OR_METHOD_UNSUPPORTED';
  }
  if (status === 403 && /api key|credential/.test(message)) {
    return 'API_KEY_REJECTED';
  }
  if (status === 403 && /not enabled|permission|access denied/.test(message)) {
    return 'API_ACCESS_NOT_ENABLED';
  }
  return null;
}

async function executeRequest(requestText, configuration, prompt, options, invocationStartedAt) {
  const clock = options.clock || Date.now;
  const wait = options.sleep || sleep;
  const random = options.random || Math.random;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const deadline = invocationStartedAt + REQUEST_TIMEOUT_MS;
  let attemptCount = 0;
  let totalLatencyMs = 0;

  if (typeof fetchImpl !== 'function') throw new ConfigurationError('FETCH_UNAVAILABLE');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const beforePacing = clock();
    const pacingDelay = Math.max(0, lastRequestStartedAt + configuration.minIntervalMs - beforePacing);
    const remainingBeforePacing = deadline - beforePacing;
    if (pacingDelay >= remainingBeforePacing) {
      throw makeError('REQUEST_DEADLINE_EXCEEDED', null, attemptCount, totalLatencyMs);
    }
    if (pacingDelay > 0) await wait(pacingDelay);

    const requestStartedAt = clock();
    const remaining = deadline - requestStartedAt;
    if (remaining <= 0) {
      throw makeError('REQUEST_DEADLINE_EXCEEDED', null, attemptCount, totalLatencyMs);
    }

    lastRequestStartedAt = requestStartedAt;
    attemptCount += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let response;
    let responseText;
    try {
      response = await fetchImpl(
        `${GEMINI_ENDPOINT}/${encodeURIComponent(configuration.model)}:generateContent?key=${encodeURIComponent(configuration.apiKey)}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt }] },
            contents: [{ role: 'user', parts: [{ text: typeof requestText === 'string' ? requestText : '' }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA
            }
          }),
          signal: controller.signal
        }
      );
      responseText = await response.text();
    } catch {
      totalLatencyMs += Math.max(0, clock() - requestStartedAt);
      clearTimeout(timer);
      if (controller.signal.aborted || clock() >= deadline) {
        throw makeError('REQUEST_TIMEOUT', null, attemptCount, totalLatencyMs);
      }
      if (attempt === MAX_ATTEMPTS) {
        throw makeError('NETWORK_ERROR', null, attemptCount, totalLatencyMs);
      }
      const retryDelayMs = Math.ceil(
        Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** (attempt - 1))) *
        (0.5 + Math.max(0, Math.min(1, random())))
      );
      if (clock() + retryDelayMs >= deadline) {
        throw makeError('REQUEST_DEADLINE_EXCEEDED', null, attemptCount, totalLatencyMs);
      }
      await wait(retryDelayMs);
      continue;
    } finally {
      clearTimeout(timer);
    }

    totalLatencyMs += Math.max(0, clock() - requestStartedAt);
    if (!response.ok) {
      const status = Number.isInteger(response.status) ? response.status : null;
      const diagnosticCode = classifyProviderError(status, responseText);
      if (status !== 429 && status !== 503) {
        throw makeError(`HTTP_${status || 'ERROR'}`, status, attemptCount, totalLatencyMs, diagnosticCode);
      }
      if (attempt === MAX_ATTEMPTS) {
        throw makeError(`HTTP_${status}`, status, attemptCount, totalLatencyMs, diagnosticCode);
      }
      const retryHeader = response.headers?.get?.('retry-after');
      const providerDelay = retryAfterMilliseconds(retryHeader, clock());
      const backoffDelay = Math.ceil(
        Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** (attempt - 1))) *
        (0.5 + Math.max(0, Math.min(1, random())))
      );
      const retryDelayMs = Math.max(providerDelay, backoffDelay);
      const remainingDeadline = deadline - clock();
      if (retryDelayMs >= remainingDeadline) {
        throw makeError('REQUEST_DEADLINE_EXCEEDED', status, attemptCount, totalLatencyMs);
      }
      await wait(retryDelayMs);
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new ApplicationResponseError('MODEL_RESPONSE_NOT_JSON', {
        attemptCount,
        latencyMs: totalLatencyMs
      });
    }

    const parts = payload?.candidates?.[0]?.content?.parts;
    const rawText = Array.isArray(parts)
      ? parts.map((part) => part?.text).filter((text) => typeof text === 'string').join('')
      : '';
    if (rawText.trim() === '') {
      throw new ApplicationResponseError('MODEL_CANDIDATE_MISSING', {
        attemptCount,
        latencyMs: totalLatencyMs
      });
    }

    let parsedOutput;
    try {
      parsedOutput = JSON.parse(rawText);
    } catch {
      throw new ApplicationResponseError('MODEL_DECISION_NOT_JSON', {
        attemptCount,
        latencyMs: totalLatencyMs
      });
    }
    return {
      rawText,
      parsedOutput,
      attemptCount,
      latencyMs: Math.max(0, totalLatencyMs)
    };
  }

  throw makeError('REQUEST_DEADLINE_EXCEEDED', null, attemptCount, totalLatencyMs);
}

function generateTriage(requestText, options = {}) {
  const invocationStartedAt = (options.clock || Date.now)();
  const configuration = resolveConfiguration(loadEnvironment(options));
  const prompt = loadSystemPrompt();
  const queuedRequest = requestQueue.then(
    () => executeRequest(requestText, configuration, prompt, options, invocationStartedAt),
    () => executeRequest(requestText, configuration, prompt, options, invocationStartedAt)
  );
  requestQueue = queuedRequest.then(() => undefined, () => undefined);
  return queuedRequest;
}

module.exports = {
  ApplicationResponseError,
  ConfigurationError,
  ExternalApiError,
  generateTriage,
  DEFAULT_MODEL,
  classifyProviderError,
  loadEnvironment,
  parseDotEnv,
  resolveConfiguration
};
