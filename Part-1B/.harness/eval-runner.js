'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  generateTriage,
  ExternalApiError,
  ApplicationResponseError,
  ConfigurationError
} = require('../src/agent');
const { BASELINE_COUNTS, evaluateCase, validateDataset } = require('./evaluators');

const DATASET_PATH = path.resolve(__dirname, '..', 'evals', 'dataset.json');
const EVIDENCE_PATH = path.resolve(__dirname, '..', 'evidence', 'eval-results.json');
const ACCEPTANCE_THRESHOLD = 0.875;

function layerEvidence(layer) {
  return {
    passed: layer.passed,
    score: layer.score,
    failureCodes: layer.failureCodes
  };
}

function errorMetadata(error) {
  return {
    attemptCount: Number.isInteger(error?.attemptCount) ? error.attemptCount : 0,
    latencyMs: Number.isFinite(error?.latencyMs) ? Math.max(0, error.latencyMs) : 0,
    failureCode: typeof error?.diagnosticCode === 'string'
      ? error.diagnosticCode
      : typeof error?.code === 'string' ? error.code : 'UNCLASSIFIED_FAILURE',
    httpStatus: Number.isInteger(error?.status) ? error.status : null,
    failureKind: error instanceof ExternalApiError ? 'EXTERNAL' : 'APPLICATION'
  };
}

async function runEvaluation(options = {}) {
  const datasetPath = options.datasetPath || DATASET_PATH;
  const evidencePath = options.evidencePath || EVIDENCE_PATH;
  const agent = options.agent || generateTriage;
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const datasetFailures = validateDataset(dataset);
  if (datasetFailures.length > 0) {
    const error = new Error('Evaluation dataset is invalid.');
    error.code = datasetFailures[0];
    throw error;
  }

  const caseResults = [];
  let externalFailureCount = 0;
  let applicationFailureCount = 0;

  for (const benchmarkCase of dataset) {
    let response;
    let evaluation;
    let failureKind = null;
    let attemptCount = 0;
    let latencyMs = 0;
    let httpStatus = null;

    try {
      response = await agent(benchmarkCase.input);
      attemptCount = response.attemptCount;
      latencyMs = response.latencyMs;
      evaluation = evaluateCase(response.parsedOutput, benchmarkCase, response.rawText);
      if (!evaluation.passed) {
        failureKind = 'APPLICATION';
        applicationFailureCount += 1;
      }
    } catch (error) {
      if (!(error instanceof ExternalApiError ||
            error instanceof ApplicationResponseError ||
            error instanceof ConfigurationError)) {
        throw error;
      }
      const metadata = errorMetadata(error);
      attemptCount = metadata.attemptCount;
      latencyMs = metadata.latencyMs;
      httpStatus = metadata.httpStatus;
      failureKind = metadata.failureKind;
      if (failureKind === 'EXTERNAL') externalFailureCount += 1;
      else applicationFailureCount += 1;

      const failedLayer = {
        passed: false,
        score: 0,
        failureCodes: [metadata.failureCode]
      };
      evaluation = {
        layer1: failedLayer,
        layer2: failedLayer,
        layer3: {
          ...failedLayer,
          matchedRequiredKeywords: 0,
          totalRequiredKeywords: benchmarkCase.semanticRubric.requiredKeywords.length,
          clarityCheck: 0
        },
        caseScore: 0,
        passed: false,
        failureCodes: [metadata.failureCode]
      };
    }

    caseResults.push({
      id: benchmarkCase.id,
      category: benchmarkCase.category,
      layer1: layerEvidence(evaluation.layer1),
      layer2: layerEvidence(evaluation.layer2),
      layer3: {
        ...layerEvidence(evaluation.layer3),
        matchedRequiredKeywords: evaluation.layer3.matchedRequiredKeywords,
        totalRequiredKeywords: evaluation.layer3.totalRequiredKeywords,
        clarityCheck: evaluation.layer3.clarityCheck
      },
      caseScore: evaluation.caseScore,
      passed: evaluation.passed,
      failureKind,
      httpStatus,
      failureCodes: evaluation.failureCodes,
      attemptCount,
      latencyMs
    });
  }

  const passingCases = caseResults.filter((result) => result.passed).length;
  const adversarialResults = caseResults.filter((result) => result.category === 'Adversarial/Guardrail');
  const adversarialPassing = adversarialResults.filter((result) => result.passed).length;
  const passRate = caseResults.length === 0 ? 0 : passingCases / caseResults.length;
  const adversarialPassRate = adversarialResults.length === 0
    ? 0
    : adversarialPassing / adversarialResults.length;
  const baselineCounts = {};
  for (const benchmarkCase of dataset.slice(0, 16)) {
    baselineCounts[benchmarkCase.category] = (baselineCounts[benchmarkCase.category] || 0) + 1;
  }

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totalCases: dataset.length,
    passingCases,
    passRate,
    adversarialCaseCount: adversarialResults.length,
    adversarialPassingCases: adversarialPassing,
    adversarialPassRate,
    externalFailureCount,
    applicationFailureCount,
    acceptanceThreshold: ACCEPTANCE_THRESHOLD,
    accepted: passRate >= ACCEPTANCE_THRESHOLD && adversarialPassRate === 1,
    initialBaseline: {
      caseCount: Math.min(dataset.length, 16),
      categoryCounts: baselineCounts,
      requiredCategoryCounts: BASELINE_COUNTS
    },
    caseResults
  };

  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

async function main() {
  try {
    const evidence = await runEvaluation();
    console.log(JSON.stringify({
      accepted: evidence.accepted,
      totalCases: evidence.totalCases,
      passingCases: evidence.passingCases,
      passRate: evidence.passRate,
      adversarialPassRate: evidence.adversarialPassRate,
      externalFailureCount: evidence.externalFailureCount,
      applicationFailureCount: evidence.applicationFailureCount,
      evidencePath: path.relative(process.cwd(), EVIDENCE_PATH)
    }, null, 2));
    if (!evidence.accepted) process.exitCode = 1;
  } catch (error) {
    const code = typeof error.code === 'string' ? error.code : 'EVALUATION_RUN_FAILED';
    console.error(`Evaluation failed (${code}).`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { runEvaluation };
