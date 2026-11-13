'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const dataset = require('../evals/dataset.json');
const { runEvaluation } = require('../.harness/eval-runner');
const { ExternalApiError } = require('../src/agent');

function fixtureDecision(benchmarkCase) {
  const expected = benchmarkCase.expectedInvariants;
  const keywords = benchmarkCase.semanticRubric.requiredKeywords.join(' ');
  const summary = `${keywords} request issue summary`.slice(0, 240);
  const requiresClarification = expected.requiresClarification;
  const guardrailTriggered = expected.guardrailTriggered;
  let suggestedAction = requiresClarification
    ? 'Please clarify which system and symptom needs support.'
    : 'Contact the relevant support team and share details for review.';
  if (guardrailTriggered) {
    suggestedAction = expected.requiresSafeIncidentReporting
      ? 'I refuse the unsafe action; report the incident to IT security through standard channels.'
      : 'I refuse the unsafe request; contact IT security for safe assistance.';
  }
  return {
    category: expected.category,
    priority: Array.isArray(expected.priority) ? expected.priority[0] : expected.priority,
    assignedTeam: expected.assignedTeam,
    summary,
    extractedEntities: [],
    requiresClarification,
    clarificationQuestion: requiresClarification ? 'Which system and symptom should support review?' : null,
    guardrailTriggered,
    refusalReason: guardrailTriggered ? 'I cannot help perform the unsafe request.' : null,
    suggestedAction
  };
}

test('runner evaluates all cases and writes secret-free evidence without raw output', async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-evaluation-'));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const evidencePath = path.join(temporaryDirectory, 'eval-results.json');

  const result = await runEvaluation({
    datasetPath: path.resolve(__dirname, '..', 'evals', 'dataset.json'),
    evidencePath,
    agent: async (requestText) => {
      const benchmarkCase = dataset.find((item) => item.input === requestText);
      const parsedOutput = fixtureDecision(benchmarkCase);
      return {
        rawText: JSON.stringify(parsedOutput),
        parsedOutput,
        attemptCount: 1,
        latencyMs: 42
      };
    }
  });

  assert.equal(result.totalCases, 16);
  assert.equal(result.passingCases, 16);
  assert.equal(result.passRate, 1);
  assert.equal(result.adversarialPassRate, 1);
  assert.equal(result.accepted, true);
  const storedEvidence = fs.readFileSync(evidencePath, 'utf8');
  assert.doesNotMatch(storedEvidence, /rawText|VPN client status/);
  assert.match(storedEvidence, /"failureKind": null/);
});

test('runner preserves external status separately from application failures', async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-external-'));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const evidencePath = path.join(temporaryDirectory, 'eval-results.json');

  const result = await runEvaluation({
    datasetPath: path.resolve(__dirname, '..', 'evals', 'dataset.json'),
    evidencePath,
    agent: async () => {
      throw new ExternalApiError('HTTP_404', {
        status: 404,
        attemptCount: 1,
        latencyMs: 125
      });
    }
  });

  assert.equal(result.externalFailureCount, 16);
  assert.equal(result.applicationFailureCount, 0);
  assert.equal(result.caseResults[0].httpStatus, 404);
  assert.deepEqual(result.caseResults[0].layer1.failureCodes, ['HTTP_404']);
  assert.equal(result.caseResults[0].caseScore, 0);
  assert.equal(result.accepted, false);
});
