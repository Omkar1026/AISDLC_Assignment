<!--
Sync Impact Report
Version change: unratified scaffold → 1.0.0
Modified principles:
- Principle slot 1 → Node.js Runtime and Dependencies
- Principle slot 2 → Secret and Configuration Handling
- Principle slot 3 → Strict Architectural Separation
- Principle slot 4 → Three-Layer Output Validation
- Principle slot 5 → Failure Classification and Benchmark Integrity
Added sections: Runtime and Security Constraints; Evaluation and Change Workflow
Removed sections: None
Follow-up TODO: Confirm the original ratification date.
-->

# Natural-Language IT Helpdesk Ticket Triage & Routing AI Agent Constitution

## Core Principles

### I. Node.js Runtime and Dependencies
The application MUST run on Node.js 20 or later and use CommonJS (`require` and
`module.exports`). Runtime behavior MUST use native built-in modules, including `fetch`,
`fs`, `path`, `node:test`, and `node:assert/strict` where applicable. The application MUST
have zero external runtime dependencies. This keeps operation and testing reproducible
without third-party runtime packages.

### II. Secret and Configuration Handling
The application MUST obtain `GEMINI_API_KEY` and `LLM_MODEL` only from environment
variables or `.env`. Credentials MUST NOT be hardcoded or exposed in logs, benchmark
results, or other evidence files. Missing or invalid configuration MUST produce an explicit
configuration error without revealing secret values.

### III. Strict Architectural Separation
Application logic MUST reside in `src/`, system prompts in `prompts/`, the benchmark
dataset in `evals/dataset.json`, and the three-layer evaluation harness in `.harness/`.
Changes MUST preserve these ownership boundaries; separating behavior, prompt content,
benchmark cases, and evaluation logic makes each independently inspectable.

### IV. Three-Layer Output Validation
Every AI output MUST be treated as untrusted until it passes all three evaluation layers:
Layer 1 Structural Schema, Layer 2 Property/Invariant & Guardrails, and Layer 3
Semantic/Quality Rubric. A failure at any layer MUST reject the output and be reported
as an application evaluation failure.

### V. Failure Classification and Benchmark Integrity
External LLM API and network failures, including HTTP 429, HTTP 503, and timeouts, MUST
be distinguishable from application schema, invariant, guardrail, and semantic evaluation
failures. A failing benchmark case MUST NOT be deleted, the declared evaluation threshold
lowered, or a guardrail weakened to obtain a PASS. This preserves actionable diagnostics
and prevents evaluation results from overstating quality.

## Runtime and Security Constraints

The application MUST use the native Node.js APIs for supported runtime capabilities and
MUST NOT require installing external runtime packages. Any `.env` loading MUST avoid
introducing a dependency. Logs and evidence MUST exclude secret values, including values
returned in provider or network error details.

## Evaluation and Change Workflow

The harness MUST evaluate AI outputs through Layers 1, 2, and 3 and report external
service/network failures separately from application validation and quality failures.
Benchmark dataset changes and threshold changes MUST be reviewed against the integrity
requirements in Principle V. Evaluation evidence MUST retain failures and MUST NOT
include secrets.

## Governance

This constitution governs implementation, prompts, benchmark data, and evaluation changes.
Amendments MUST document their rationale and be reviewed for consistency with every
principle before adoption. The constitution version MUST follow semantic versioning:
MAJOR for incompatible governance changes or removals, MINOR for new principles or
material expansions, and PATCH for clarifications and non-semantic refinements.
Compliance MUST be checked during implementation and review, including verification of
runtime/dependency constraints, directory boundaries, output validation layers, failure
classification, and benchmark integrity.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): confirm original adoption date | **Last Amended**: 2026-11-11
