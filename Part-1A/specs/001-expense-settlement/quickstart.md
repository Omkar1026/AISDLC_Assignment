# Quickstart: Expense Split & Settlement Engine

## Prerequisites

- Node.js 20 or later.
- npm for installing development-only lint tooling.
- Semgrep available to the `.harness` runner for the SAST gate.

The service has no external runtime dependencies and stores ledger data only
for the lifetime of its process.

## Install and validate

From the repository root:

```powershell
npm install
node --test tests/app.test.js
npm run lint
semgrep scan --config .harness/semgrep.yml --error .
node .harness/harness.js
```

The harness must run these as required gates: static lint, SAST security, and
API contract/unit tests. `node .harness/harness.js` executes all three gates
from `.harness/quality-gates.json`, writes their results to
`evidence/harness-results.json`, and exits non-zero for a missing tool,
invalid manifest, or failed required gate.

## Run the service

```powershell
node src/app.js
```

The executable entry point may use a configurable port and a documented local
default. Importing `src/app.js` from tests must not start a listener.

## Validate representative contracts

1. Send `POST /expenses` with an `EQUAL` split and verify HTTP 201, an `id`,
   and a two-decimal `shares` map whose values sum to the expense amount.
2. Send `POST /expenses` with an `EXACT` split and verify both the 0.001
   submitted-sum tolerance and the requirement that rounded shares sum exactly
   to the rounded total.
3. Read `GET /balances`; verify each amount has two decimal places and all
   balances sum to 0.00.
4. Read `GET /settle` twice without changing state; verify identical ordered
   debtor-to-creditor transfers and that applying the plan clears every
   balance.
5. Send malformed or invalid expense data and verify HTTP 400 with a JSON
   `error` and no ledger mutation.
6. Send a body larger than 10,240 bytes and verify HTTP 413 with a JSON
   `error` and no ledger mutation.
7. Send an unknown route or method and verify HTTP 404 with a JSON `error`.
8. Send `DELETE /reset` and verify HTTP 200; later balance and settlement
   reads are empty.
9. Verify every response includes `Content-Type: application/json` and
   `X-Content-Type-Options: nosniff`.

See [the OpenAPI contract](./contracts/openapi.yaml) for request and response
shapes and [the data model](./data-model.md) for calculation invariants.
