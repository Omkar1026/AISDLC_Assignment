# Implementation Plan: Expense Split & Settlement Engine

**Branch**: `001-expense-settlement` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-expense-settlement/spec.md`

## Summary

Build a deterministic, in-memory REST API for recording group expenses,
calculating net balances, generating greedy settlement transfers, and resetting
state. Use Node.js 20+ CommonJS and native `http`, keep routing, validation,
and settlement logic separate, and exercise behavior through built-in contract
and unit tests. Add required lint, SAST, and contract-test gates under
`.harness/`; development tooling MUST NOT become a runtime dependency.

## Technical Context

**Language/Version**: Node.js 20+, CommonJS

**Primary Dependencies**: Zero external runtime dependencies; native `http`,
`node:test`, and `node:assert/strict`. ESLint is development-only; Semgrep is a
CI/harness security scanner.

**Storage**: Process-local in-memory ledger; no external database or durable
storage.

**Testing**: `node --test tests/app.test.js`; contract and unit coverage using
`node:test` and `node:assert/strict`.

**Target Platform**: Node.js 20+ on supported developer and CI operating
systems.

**Project Type**: Single-process REST web service.

**Performance Goals**: No latency or throughput SLA is specified for v1.
Requests and calculations are bounded by the 10 KB request limit and in-memory
group ledger.

**Constraints**: All HTTP responses are JSON and include
`X-Content-Type-Options: nosniff`. Reject bodies larger than 10,240 bytes with
HTTP 413. Reject invalid request data with HTTP 400 and unknown routes/methods
with HTTP 404. Use integer cents internally and guard all conversions and
aggregations against unsafe integer overflow. No fixed port may be bound when
`src/app.js` is imported. No authentication, external database, `eval()`, or
`new Function()`.

**Scale/Scope**: One in-memory ledger per running process; no multi-group
isolation, persistence, or horizontal shared state. An initial technical
ceiling of 1,000,000,000.00 currency units per expense is proposed to keep
cent arithmetic exact with JavaScript numbers; enforce safe-integer checks on
every accumulated balance as well. This ceiling is a documented assumption,
not a domain requirement from the feature request.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle or constraint | Plan compliance |
|---|---|
| Node.js 20+, CommonJS, native runtime modules only | Pass; runtime imports are built-in modules only |
| Separate HTTP routing, validation, and settlement logic | Pass; distinct modules under `src/` |
| Strict input validation and HTTP 400 JSON error shape | Pass; validation precedes ledger mutation |
| Two-decimal monetary values and exactly zero-sum balances | Pass; integer cents, exact split validation, and balance invariant tests |
| Server export from `src/app.js` without listening on import | Pass; expose server factory and bind only from executable entry point |
| No `eval()`, `new Function()`, or hardcoded secrets | Pass; prohibited by implementation and SAST gates |
| 10 KB maximum request body and required response headers | Pass; enforce while streaming and centrally set headers |
| Built-in Node test and assertion modules | Pass; tests use `node:test` and `node:assert/strict` |
| Requested `.harness` lint, SAST, and contract gates | Pass; define required fail-closed gates separately from runtime |

No constitution violations are identified. The proposed per-expense ceiling
and overflow rejection are safety controls to make the money representation
well-defined; they do not add dependencies or alter the specified routes.

## Project Structure

### Documentation (this feature)

```text
specs/001-expense-settlement/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── openapi.yaml
    └── quality-gates.json
```

### Source Code (repository root)

```text
.harness/
├── quality-gates.json
└── semgrep.yml

src/
├── app.js
├── routes.js
├── validation.js
├── ledger.js
└── settlement.js

tests/
└── app.test.js

package.json
eslint.config.js
```

**Structure Decision**: Use one CommonJS service with a server factory exported
from `src/app.js`. Keep route dispatch, request validation, in-memory ledger
operations, and settlement calculation in separate modules. Use one built-in
test file as requested, with clearly separated unit and HTTP-contract test
groups. Store the harness gate manifest in `.harness/quality-gates.json`;
it declares required lint, SAST, and contract-test commands and fails the gate
on a non-zero command result. Store the project-owned SAST ruleset at
`.harness/semgrep.yml`; the proposed manifest contract is documented in
`contracts/quality-gates.json`.

## Complexity Tracking

No constitution violations require justification.
