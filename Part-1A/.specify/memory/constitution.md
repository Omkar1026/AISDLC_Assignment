<!--
Sync Impact Report
Version change: unratified scaffold → 1.0.0
Modified principles:
- Unfilled principle 1 → I. Runtime and Dependency Discipline
- Unfilled principle 2 → II. Modular Architecture
- Unfilled principle 3 → III. Strict Input Validation
- Unfilled principle 4 → IV. Monetary Correctness
- Unfilled principle 5 → V. Testability and Import Safety
Added sections: none; populated the template's existing sections.
Removed sections: none.
Follow-up TODO: Confirm the original ratification date.
-->
# Expense Split & Settlement Engine REST API Constitution

## Core Principles

### I. Runtime and Dependency Discipline
The API MUST use Node.js 20 or later and CommonJS modules (`require` and
`module.exports`). Runtime code MUST use native Node.js modules, including
`http` where applicable, and MUST have zero external runtime dependencies.
This keeps deployment reproducible and limits the runtime attack surface.

### II. Modular Architecture
HTTP routing, input validation, and settlement algorithm logic MUST remain
separate modules with explicit responsibilities. Route handlers MUST use the
validation layer before invoking settlement logic. This separation makes the
API contract and financial calculations independently testable.

### III. Strict Input Validation
The API MUST reject missing required fields, non-string participant names,
non-positive monetary amounts, and splits containing only one participant.
Invalid requests MUST receive HTTP 400 with a JSON object shaped as
`{ "error": "..." }`. Request parsing and validation MUST not silently coerce
invalid input into valid values.

### IV. Monetary Correctness
All monetary values MUST be rounded to two decimal places. For every settlement
calculation, the sum of all participant net balances MUST equal exactly 0.00
after rounding. Tests MUST exercise these invariants so rounding cannot create
or destroy money.

### V. Testability and Import Safety
The server MUST be exported from `src/app.js` using CommonJS and MUST NOT bind a
fixed port when imported by tests. Tests MUST use Node.js built-ins,
`node:test` and `node:assert/strict`, and MUST cover API behavior and settlement
invariants. This allows deterministic testing without third-party test
dependencies or unwanted network listeners.

## Additional Constraints

The API MUST enforce a maximum request body size of 10 KB and respond with
HTTP 413 when that limit is exceeded. Every HTTP response MUST set
`Content-Type: application/json` and `X-Content-Type-Options: nosniff`.
Application code MUST NOT use `eval()` or `new Function()`, and MUST NOT
hardcode secrets.

## Development Workflow

Changes MUST be tested with the built-in Node.js test runner and strict
assertions. Tests MUST verify the specified validation status codes and JSON
error shape, response security headers, request size limit, import behavior,
two-decimal monetary precision, and zero-sum net balances. Reviewers MUST
verify that changes preserve the separation between routing, validation, and
settlement logic and introduce no external runtime dependencies.

## Governance

This constitution governs feature specifications, implementation, and review.
An amendment MUST update this document and explain its impact in the Sync
Impact Report at the top. Changes require review for compatibility with the
API contract and financial invariants before implementation proceeds.

The version follows semantic versioning: MAJOR for backward-incompatible
governance changes, MINOR for new principles or materially expanded
requirements, and PATCH for clarifications that do not change requirements.
Every implementation review MUST verify compliance with these principles,
constraints, and tests; any non-compliance MUST be corrected before the
change is accepted.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): confirm original adoption date | **Last Amended**: 2026-11-09
