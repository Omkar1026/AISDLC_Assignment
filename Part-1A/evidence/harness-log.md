# Harness Feedback-and-Repair Log

## Initial coding-agent generation and task context

The initial generation for the Expense Split & Settlement Engine API was
preserved under [`initial-generation/`](./initial-generation/). It implemented
the Node.js CommonJS REST API and its tests from the approved specification
and implementation tasks in `specs/001-expense-settlement/`. The governing
contract requires JSON responses and `X-Content-Type-Options: nosniff`, strict
input validation, a 10 KB request limit, and correct cent-based balance and
settlement calculations. The initial API did not set a cache directive on
financial responses.

## Attempt 1 — initial harness feedback

Executed `node .harness/harness.js` after tightening the Security / SAST Guard
to require `Cache-Control: no-store` for financial API responses.

- Harness status: **FAILED**; 2 of 3 gates passed.
- Syntax & Lint Guard: **passed**.
- Security / SAST Guard: **failed**.
- Unit & Contract Tests: **passed** (11 tests).

Structured finding supplied back to the coding agent:

```text
Security / SAST Guard failed:
- Cache-Control: no-store must be set for financial API responses
```

The complete machine-readable report, including each gate's command, status,
exit code, and output, is [`harness-results-initial.json`](./harness-results-initial.json).

## Repair and Attempt 2

Based on the structured finding, the shared JSON response writer in
`src/routes.js` now sets `Cache-Control: no-store`. The API tests assert this
header on successful and error responses. The OpenAPI response headers,
specification acceptance criteria, plan, and quickstart were updated to
document the cache-control requirement. The SAST sensor checks for this
required header alongside the existing security controls.

Executed `node .harness/harness.js` again:

- Harness status: **PASSED**; 3 of 3 gates passed.
- Syntax & Lint Guard: **passed**.
- Security / SAST Guard: **passed**.
- Unit & Contract Tests: **passed** (11 tests).

The complete passing report is [`harness-results.json`](./harness-results.json).
The repaired source and tests are snapshotted under
[`final-generation/`](./final-generation/).

## Final human review

**Decision: ACCEPT.**

The failed run records a specific missing security control, and the repair is
limited to enforcing that control in the shared response path, its tests, and
the related contract documentation. The subsequent harness report confirms
all configured gates pass, including the response-header assertion and the
existing API behavior tests.

Known limitations accepted for this scope:

- Ledger data is in memory and resets when the process restarts.
- The API assumes a single currency and does not model currency conversion.

These are accepted because the specification explicitly scopes the service to
a process-local in-memory ledger and does not require persistence or
multi-currency behavior. They should be revisited before a production
multi-user deployment.
