'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ApplicationResponseError,
  ConfigurationError,
  DEFAULT_MODEL,
  ExternalApiError,
  generateTriage,
  loadEnvironment,
  parseDotEnv,
  resolveConfiguration
} = require('../src/agent');

const decision = {
  category: 'NETWORK',
  priority: 'P3',
  assignedTeam: 'NET_OPS',
  summary: 'The VPN connection fails when connecting from home.',
  extractedEntities: ['VPN', 'home'],
  requiresClarification: false,
  clarificationQuestion: null,
  guardrailTriggered: false,
  refusalReason: null,
  suggestedAction: 'Check the VPN client status and share any displayed error with support.'
};

function response(status, candidate = decision) {
  const body = status === 200
    ? { candidates: [{ content: { parts: [{ text: typeof candidate === 'string' ? candidate : JSON.stringify(candidate) }] } }] }
    : { error: { message: typeof candidate === 'string' ? candidate : 'not persisted' } };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  };
}

function environment() {
  return {
    GEMINI_API_KEY: 'test-key-not-a-real-credential',
    LLM_MODEL: 'gemini-test',
    GEMINI_MIN_INTERVAL_MS: '1000'
  };
}

test('dotenv parser reads simple assignments and quoted values', () => {
  assert.deepEqual(parseDotEnv([
    '# comment',
    'GEMINI_API_KEY=sample-value',
    'LLM_MODEL="model name"',
    'export EXTRA=value # comment'
  ].join('\n')), {
    GEMINI_API_KEY: 'sample-value',
    LLM_MODEL: 'model name',
    EXTRA: 'value'
  });
});

test('configuration requires a key and never returns a configurable rate below one second', () => {
  assert.throws(() => resolveConfiguration({ GEMINI_API_KEY: '', LLM_MODEL: 'model' }), ConfigurationError);
  assert.equal(resolveConfiguration({ GEMINI_API_KEY: 'key' }).model, 'gemini-2.5-flash');
  assert.equal(resolveConfiguration({
    GEMINI_API_KEY: 'key',
    LLM_MODEL: 'model',
    GEMINI_MIN_INTERVAL_MS: '200'
  }).minIntervalMs, 1000);
  assert.equal(resolveConfiguration({
    GEMINI_API_KEY: 'key',
    LLM_MODEL: 'model',
    GEMINI_MIN_INTERVAL_MS: '2500'
  }).minIntervalMs, 2500);
});

test('agent requests JSON output and returns model text only for internal validation', async () => {
  let fetchArguments;
  const result = await generateTriage('VPN fails at home.', {
    env: environment(),
    clock: () => Date.now() + 50_000,
    fetchImpl: async (url, init) => {
      fetchArguments = { url, init };
      return response(200);
    }
  });

  assert.equal(result.parsedOutput.category, 'NETWORK');
  assert.equal(result.rawText, JSON.stringify(decision));
  assert.equal(result.attemptCount, 1);
  assert.equal(fetchArguments.init.headers['x-goog-api-key'], undefined);
  assert.equal(
    fetchArguments.url,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent?key=${encodeURIComponent(environment().GEMINI_API_KEY)}`
  );
  const body = JSON.parse(fetchArguments.init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.required.length, 10);
  assert.match(body.systemInstruction.parts[0].text, /untrusted data/i);
});

test('model normalization strips a models prefix and defaults to Gemini 2.5 Flash', () => {
  assert.equal(DEFAULT_MODEL, 'gemini-2.5-flash');
  assert.equal(resolveConfiguration({ GEMINI_API_KEY: 'key' }).model, 'gemini-2.5-flash');
  assert.equal(resolveConfiguration({
    GEMINI_API_KEY: 'key',
    LLM_MODEL: ' models/gemini-2.5-flash '
  }).model, 'gemini-2.5-flash');
});

test('environment loading reads both dotenv files and replaces a stale process model default', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-dotenv-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const appEnvPath = path.join(directory, 'app.env');
  const cwdEnvPath = path.join(directory, 'cwd.env');
  fs.writeFileSync(appEnvPath, 'LLM_MODEL=gemini-stale\nGEMINI_API_KEY=app-key\n');
  fs.writeFileSync(cwdEnvPath, 'LLM_MODEL=models/gemini-2.5-flash\n');

  const previousModel = process.env.LLM_MODEL;
  process.env.LLM_MODEL = 'gemini-stale-process-default';
  try {
    const environment = loadEnvironment({ dotenvPaths: [appEnvPath, cwdEnvPath] });
    assert.equal(environment.LLM_MODEL, 'models/gemini-2.5-flash');
    assert.ok(environment.GEMINI_API_KEY);
  } finally {
    if (previousModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = previousModel;
  }
});

test('agent retries HTTP 503 with bounded backoff and pacing', async () => {
  let calls = 0;
  let now = Date.now() + 200_000;
  const delays = [];
  const result = await generateTriage('VPN fails at home.', {
    env: environment(),
    clock: () => now,
    random: () => 0,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
      now += milliseconds;
    },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(503) : response(200);
    }
  });

  assert.equal(result.parsedOutput.category, 'NETWORK');
  assert.equal(result.attemptCount, 2);
  assert.equal(calls, 2);
  assert.equal(delays.length, 2);
  assert.ok(delays[0] >= 125);
  assert.equal(delays[0] + delays[1], 1000);
});

test('agent classifies permanent HTTP failures and malformed model JSON separately', async () => {
  await assert.rejects(
    generateTriage('Help me.', {
      env: environment(),
      clock: () => Date.now() + 400_000,
      fetchImpl: async () => response(400)
    }),
    (error) => error instanceof ExternalApiError && error.code === 'HTTP_400' && error.status === 400
  );

  await assert.rejects(
    generateTriage('Help me.', {
      env: environment(),
      clock: () => Date.now() + 600_000,
      fetchImpl: async () => response(200, 'not json')
    }),
    (error) => error instanceof ApplicationResponseError && error.code === 'MODEL_DECISION_NOT_JSON'
  );

  await assert.rejects(
    generateTriage('Help me.', {
      env: environment(),
      clock: () => Date.now() + 700_000,
      fetchImpl: async () => response(404, 'This model is no longer available to new users.')
    }),
    (error) => error instanceof ExternalApiError &&
      error.code === 'HTTP_404' &&
      error.diagnosticCode === 'MODEL_RETIRED_FOR_NEW_USERS'
  );
});
