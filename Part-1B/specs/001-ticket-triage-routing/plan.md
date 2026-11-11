# Implementation Plan: Natural-Language IT Helpdesk Ticket Triage & Routing Agent

**Branch**: `001-ticket-triage-routing` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ticket-triage-routing/spec.md`

## Summary

Build a Node.js 20+ CommonJS triage agent that sends employee support requests to
Gemini, obtains raw and parsed model output, and accepts a decision only after structural,
invariant/guardrail, and semantic evaluation. Keep the system prompt, app logic, benchmark
dataset, and evaluation harness in their constitution-defined locations. Run the fixed
16-case benchmark with bounded external retries, safe pacing, typed failures, and
secret-redacted evidence.

## Technical Context

**Language/Version**: Node.js 20+; CommonJS (`require`/`module.exports`)

**Primary Dependencies**: Node.js built-ins only; global `fetch`, `fs`, `path`,
`node:test`, and `node:assert/strict`. Zero external runtime dependencies.

**Storage**: Filesystem for system prompt, benchmark dataset, and generated evaluation
evidence; no database.

**Testing**: `node --test tests/evaluator.test.js`; end-to-end benchmark through
`node .harness/eval-runner.js`.

**Target Platform**: Node.js 20+ on a platform with outbound HTTPS access to Gemini.

**Project Type**: Single Node.js application module plus command-line evaluation harness.

**Performance Goals**: At least 95% of valid employee requests receive a valid decision
within 10 seconds, including the external model call (SC-008). The benchmark contains
exactly 16 cases for the specified 4/3/3/2/2/2 category distribution.

**Constraints**: Load `GEMINI_API_KEY` and `LLM_MODEL` from the process environment or
`.env`; never log or persist credentials or raw model output in evidence. Retry only
transient HTTP 429/503 and network timeouts using bounded backoff within a 10-second
request deadline. Serialize in-process calls with at least one second between request
starts and pace retries; no universal Gemini quota is assumed. Classify provider/network
errors separately from application parse, schema, invariant, guardrail, and semantic
failures. No database or external package.

**Scale/Scope**: One in-process application and a 16-case evaluation run. A single-process
request queue smooths local bursts; distributed rate coordination and production
availability targets are outside this feature's stated scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Plan decision | Status |
|---|---|---|
| Node.js 20+, CommonJS, built-in runtime only | Use Node global `fetch`, built-in filesystem/path/test modules, and CommonJS modules; install no runtime packages. | PASS |
| Environment-only secrets | Read `GEMINI_API_KEY` and `LLM_MODEL` from environment/`.env`; send the key in the API-key header; exclude keys and raw provider payloads from logs/evidence. | PASS |
| Directory separation | Keep runtime logic in `src/`, prompt in `prompts/`, dataset at `evals/dataset.json`, and evaluation code in `.harness/`. | PASS |
| Layered trust boundary | Expose no accepted decision before Layer 1, Layer 2, and Layer 3 pass. | PASS |
| Failure classification | Return distinct typed external/network and application-validation failures; never turn either into a success-shaped fallback decision. | PASS |
| Benchmark integrity | Keep all 16 cases, apply the declared 87.5% and 100% adversarial thresholds, and retain failure evidence without weakening guards. | PASS |

No constitution violations are identified. The specification's requested agent, prompt,
dataset, harness, evidence, and test files conform to the mandated directory boundaries.

## Phase 0: Outline & Research

See [research.md](./research.md) for decisions and source references.

Key choices:

- Use the Gemini `generateContent` REST API via Node's native `fetch`; send the key in
  `x-goog-api-key`, not in a URL or loggable request string.
- Make at most three total HTTP attempts for retryable failures, with exponential
  backoff/jitter and provider retry hints when supplied. Apply one 10-second overall
  deadline; do not retry permanent client errors.
- Serialize calls in process and pace retries; do not hardcode a supposed account-wide
  Gemini request quota because actual limits vary by model and project. The local queue
  enforces at least one second between request starts.
- Distinguish invalid JSON/model structure as an application-validation failure from
  transport, timeout, and non-success HTTP statuses as external failures.

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md). It defines support requests, triage decisions,
benchmark cases, layer results, aggregate metrics, and redacted evidence.

### Interface Contracts

See [contracts/agent-and-evaluation.md](./contracts/agent-and-evaluation.md) for the
CommonJS module boundary, Gemini request/response boundary, typed error outcomes,
evaluation pipeline, and evidence contract.

### Validation Guide

See [quickstart.md](./quickstart.md) for environment setup, unit tests, benchmark
execution, latency measurement, and expected pass/failure outcomes.

## Project Structure

### Documentation (this feature)

```text
specs/001-ticket-triage-routing/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── agent-and-evaluation.md
├── checklists/
│   └── requirements.md
└── tasks.md                         # Phase 2 output, not created during planning
```

### Source Code (repository root)

```text
prompts/
└── system-prompt.md
src/
└── agent.js
evals/
└── dataset.json
.harness/
├── evaluators.js
└── eval-runner.js
tests/
└── evaluator.test.js
evidence/
└── eval-results.json                # Generated, redacted evaluation output
```

**Structure Decision**: Use one Node.js project organized by the project constitution.
The agent handles configuration and the external model boundary; the system prompt is
externalized; evaluators are isolated from application logic; and the runner connects the
dataset, agent, evaluators, and redacted evidence output. Unit tests directly exercise
evaluators with deterministic mock decisions and malformed responses.

## Constitution Check (Post-Design)

| Gate | Design evidence | Status |
|---|---|---|
| Node.js 20+, CommonJS, zero runtime dependencies | Only platform APIs are specified; tests use `node:test` and `node:assert/strict`. | PASS |
| Secret handling | API key uses the request header; `.env` is ignored; evidence stores neither key nor raw model text/provider body. | PASS |
| Separation of concerns | All planned implementation and data files occupy the required `src/`, `prompts/`, `evals/`, and `.harness/` locations. | PASS |
| Three-layer validation | Runner accepts a decision only after schema, invariants/guardrails, and semantic rubric complete. | PASS |
| Failure classification | Contract distinguishes external provider/network failures from parse/schema/invariant/semantic failures. | PASS |
| Threshold and benchmark integrity | Dataset remains 16 cases; threshold and adversarial gate are recorded verbatim; failures are preserved. | PASS |

No post-design gate failures or unjustified complexity were found.

## Complexity Tracking

No constitution violations requiring justification.
