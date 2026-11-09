# Tasks: Expense Split & Settlement Engine

**Input**: Design documents from `specs/001-expense-settlement/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, and `contracts/`

**Tests**: Required by FR-019; use only `node:test` and `node:assert/strict` in `tests/app.test.js`.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because files and prerequisites do not overlap.
- **[Story]**: User-story label matching `spec.md`.
- Every task names the exact file path it creates, changes, or validates.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize CommonJS project tooling and required quality gates.

- [ ] T001 Create `package.json` with CommonJS mode, Node.js 20+ engine, `start`, `test`, and `lint` scripts, no runtime dependencies, and ESLint as a development dependency.
- [ ] T002 [P] Configure the ESLint recommended rules and CommonJS test/source file patterns in `eslint.config.js`.
- [ ] T003 [P] Create fail-closed Semgrep rules prohibiting `eval()`, `new Function()`, and hardcoded secrets in `.harness/semgrep.yml`.
- [ ] T004 [P] Configure required `static-lint`, `sast-security`, and `api-contract` commands with non-zero failure behavior in `.harness/quality-gates.json`, matching `specs/001-expense-settlement/contracts/quality-gates.json`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish safe HTTP handling, common money rules, and process-local state before implementing stories.

**Checkpoint**: Complete these tasks before starting user-story implementation.

- [ ] T005 Export an import-safe `createServer` from `src/app.js`; bind only when run directly, set both required JSON/security headers on every response, and reject request streams exceeding 10,240 bytes with HTTP 413 before parsing or routing.
- [ ] T006 Implement method/path dispatch and a JSON HTTP 404 error for unknown routes and unsupported methods in `src/routes.js`.
- [ ] T007 Implement finite-number validation, decimal-aware half-up conversion to safe integer cents, two-decimal response conversion, and the planned maximum expense amount of 1,000,000,000.00 in `src/validation.js`.
- [ ] T008 Create the process-local expense ledger and atomic append/balance-update primitives in `src/ledger.js`; reject any update that would produce an unsafe integer balance without mutating state.

---

## Phase 3: User Story 1 - Record a Group Expense (Priority: P1) 🎯 MVP

**Goal**: Accept valid EQUAL and EXACT expenses and return an ID and participant shares without mutating the ledger on invalid input.

**Independent Test**: Run `node --test tests/app.test.js` and verify successful expense creation, complete two-decimal shares, HTTP 400 validation errors, HTTP 413 oversized bodies, and unchanged ledger after failures.

### Tests for User Story 1

- [ ] T009 [US1] Add `POST /expenses` contract and validation tests in `tests/app.test.js` for EQUAL and EXACT responses, required fields and types, duplicate participants, non-positive/rounded-zero amounts, malformed JSON, unknown fields, exactShares key mismatch, 0.001 sum tolerance, rounded-share total mismatch, and ledger immutability on failure.

### Implementation for User Story 1

- [ ] T010 [US1] Validate expense requests in `src/validation.js`: require `payer`, `amount`, `participants`, `description`, and `splitType`; require a trimmed non-empty payer, string description, at least two distinct trimmed non-empty participant names, and `splitType` exactly `EQUAL` or `EXACT`; reject `exactShares` for EQUAL and require it for EXACT.
- [ ] T011 [US1] Calculate EQUAL shares by half-up rounding each equal portion to cents and assigning the full remainder to the first participant; for EXACT require precisely the participant keys, finite non-negative shares, an unrounded sum within 0.001 of amount, and rounded shares summing exactly to rounded amount in `src/validation.js`.
- [ ] T012 [US1] Record only validated expenses in `src/ledger.js`, ensuring participant shares sum to total cents, payer credit and participant debits preserve zero-sum balances, the ID is generated only for accepted expenses, and failed validation or overflow leaves state unchanged.
- [ ] T013 [US1] Implement `POST /expenses` in `src/routes.js` to return HTTP 201 JSON `{ "id": "...", "shares": { "name": 0.00 } }` for valid requests and HTTP 400 JSON `{ "error": "..." }` for invalid requests.

**Checkpoint**: Expense creation is independently usable and all invalid requests leave the ledger unchanged.

---

## Phase 4: User Story 2 - Review Group Balances (Priority: P2)

**Goal**: Return all ledger participants' and payers' net balances with correct signs and exact zero-sum totals.

**Independent Test**: Record a valid expense using the US1 endpoint, request balances, verify every encountered name including zero-balance names is present, and verify amounts are two-decimal and sum to 0.00; verify an empty ledger returns an empty balances object.

### Tests for User Story 2

- [ ] T014 [US2] Add `GET /balances` tests in `tests/app.test.js` for empty and populated ledgers, payer outside the participant list, zero balances, positive/negative signs, two-decimal amounts, and a total net balance of exactly 0.00.

### Implementation for User Story 2

- [ ] T015 [US2] Implement balance aggregation in `src/ledger.js` using integer cents, including every participant and payer seen in accepted expenses and retaining zero balances.
- [ ] T016 [US2] Implement `GET /balances` in `src/routes.js` to return HTTP 200 JSON `{ "balances": { "name": 0.00 } }` with all ledger names and two-decimal amounts.

**Checkpoint**: Balance reads are independently verifiable against recorded expense shares and never mutate state.

---

## Phase 5: User Story 3 - Settle Group Debts (Priority: P3)

**Goal**: Return a repeatable greedy settlement plan that settles all balances using debtor-to-creditor transfers.

**Independent Test**: Record expenses that produce multiple debtors and creditors, request settlement repeatedly, compare ordered plans, then apply transfers to confirm all balances become zero.

### Tests for User Story 3

- [ ] T017 [US3] Add `GET /settle` tests in `tests/app.test.js` for creditor/debtor direction, largest absolute balance first, alphabetical tie-breaking, transfer amounts, repeatability, empty plans, complete balance settlement, and at most `k - 1` transfers for `k` non-zero balances.

### Implementation for User Story 3

- [ ] T018 [US3] Implement deterministic greedy settlement in `src/settlement.js`, sorting debtors and creditors by absolute balance descending then case-sensitive alphabetical name, transferring the lesser balance, and emitting only positive cent amounts.
- [ ] T019 [US3] Implement `GET /settle` in `src/routes.js` to return HTTP 200 with a JSON array of `{ "from": "...", "to": "...", "amount": 0.00 }` transfers and an empty array when no debt remains.

**Checkpoint**: Settlement is deterministic, leaves no residual balance, and does not mutate the ledger.

---

## Phase 6: User Story 4 - Reset the Ledger (Priority: P2)

**Goal**: Clear all in-memory expenses and derived balances for repeatable isolated use.

**Independent Test**: Record an expense, reset, and verify balances and settlement are empty; reset an already-empty ledger and verify HTTP 200.

### Tests for User Story 4

- [ ] T020 [US4] Add `DELETE /reset` tests in `tests/app.test.js` for populated and already-empty ledgers, HTTP 200 response, and empty balances and settlement after reset.

### Implementation for User Story 4

- [ ] T021 [US4] Implement an atomic ledger reset that clears all expenses and derived balances in `src/ledger.js`.
- [ ] T022 [US4] Implement `DELETE /reset` in `src/routes.js` to clear the ledger and return HTTP 200 JSON confirmation, including when the ledger was already empty.

**Checkpoint**: Reset is repeatable and later reads observe only the fresh empty ledger.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify the full contract, security boundaries, documentation, and required quality gates.

- [ ] T023 [P] Complete cross-endpoint contract tests in `tests/app.test.js` for both required response headers on success and error responses, HTTP 404 routes/methods, exact 10,240-byte acceptance, over-limit 413 rejection, and no mutation after rejected requests.
- [ ] T024 [P] Verify `src/app.js` imports without opening a listening port and that the executable entry point reads a configurable port without binding a fixed port in `src/app.js`.
- [ ] T025 [P] Verify `specs/001-expense-settlement/contracts/openapi.yaml` matches implemented endpoint paths, methods, request/response shapes, status codes, and required response headers.
- [ ] T026 Run `node --test tests/app.test.js`, `npm run lint`, and the required gates in `.harness/quality-gates.json`; resolve failures in `tests/app.test.js`, `eslint.config.js`, `.harness/semgrep.yml`, or `.harness/quality-gates.json`.
- [ ] T027 Validate every quickstart scenario in `specs/001-expense-settlement/quickstart.md` and update that file if commands or expected outcomes differ from the implementation.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; package, lint, and gate files are separate.
- **Foundational (Phase 2)**: Depends on project setup; blocks all user stories.
- **US1 (Phase 3)**: Depends on the HTTP, money, and ledger foundation.
- **US2 (Phase 4)**: Depends on US1 to create a populated ledger for its primary test; empty-state tests can be prepared independently.
- **US3 (Phase 5)**: Depends on US1 to create a ledger; uses US2's canonical balance aggregation.
- **US4 (Phase 6)**: Depends on US1 for populated-ledger reset tests; can otherwise be developed against the empty ledger foundation.
- **Polish (Phase 7)**: Depends on the stories selected for delivery.

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2; establishes the expense ledger.
- **US2 (P2)**: Requires accepted expenses from US1 for non-empty balance behavior.
- **US3 (P3)**: Requires expenses from US1 and the balance calculation from US2.
- **US4 (P2)**: Reset is a distinct operation but its populated-ledger verification uses US1.

### Within Each User Story

- Write and fail the listed tests before implementing the corresponding behavior.
- Complete validation and ledger calculations before exposing their route.
- Re-run `node --test tests/app.test.js` after each story increment.

### Parallel Opportunities

- T002, T003, and T004 can run in parallel after T001 because they modify different files.
- After Phase 2, US1 implementation is sequential because tasks share validation, ledger, and route modules.
- US2 through US4 have behavioral dependencies on US1 data; their empty-state or test scaffolding may be prepared separately, but route implementations should follow their prerequisites.
- During polish, T023, T024, and T025 touch separate files and can proceed in parallel; T026 and T027 follow completed implementation and contract review.

## Parallel Example: Setup

```text
After T001:
Task: T002 Configure ESLint in eslint.config.js
Task: T003 Create SAST rules in .harness/semgrep.yml
Task: T004 Define required gates in .harness/quality-gates.json
```

## Parallel Example: Polish

```text
After all user stories:
Task: T023 Complete cross-endpoint contract coverage in tests/app.test.js
Task: T024 Verify import safety in src/app.js
Task: T025 Compare the implementation with specs/001-expense-settlement/contracts/openapi.yaml
```

## Implementation Strategy

1. Complete setup and shared HTTP/money/ledger foundations.
2. Deliver US1 as the MVP: validate and record expenses with equal and exact splits.
3. Add balance visibility (US2), deterministic settlement (US3), and reset
   (US4) as independently testable increments.
4. Run all harness gates and quickstart scenarios before considering the
   feature complete.

**Suggested MVP**: US1, plus the foundational tasks it depends on.
