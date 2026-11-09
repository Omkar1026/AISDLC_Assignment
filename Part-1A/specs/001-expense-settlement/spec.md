# Feature Specification: Expense Split & Settlement Engine

**Feature Branch**: `001-expense-settlement`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Build a deterministic Expense Split & Settlement Engine REST API for group expense tracking. Supported endpoints: POST /expenses: Record an expense with { payer: string, amount: number, participants: string[], description: string, splitType: "EQUAL" | "EXACT", exactShares?: Record<string, number> }. Returns HTTP 201 with created expense ID and per-participant share breakdown. GET /balances: Returns HTTP 200 with each participant's net balance rounded to 2 decimals (positive = owed money, negative = owes money). GET /settle: Computes and returns HTTP 200 with the minimum-transaction settlement plan [{ from, to, amount }] using a deterministic greedy net-balance algorithm. DELETE /reset: Clears in-memory state for isolated testing (HTTP 200). Define user stories, functional requirements, mathematical invariants, and binary acceptance criteria for valid (200/201) and invalid (400/404/413) requests. Exclude authentication and external databases."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a Group Expense (Priority: P1)

As a group member, I want to record who paid, how much was paid, who shares the
expense, and how the amount is split so that the group has an accurate expense
ledger.

**Why this priority**: Recording expenses creates the ledger data needed for
balances and settlement.

**Independent Test**: Submit one valid equal or exact expense and verify the
created expense ID and shares for all participants.

**Acceptance Scenarios**:

1. **Given** a valid equal-split expense with at least two distinct
   participants, **When** it is recorded, **Then** the response is HTTP 201
   with an expense ID and a `shares` object mapping each participant to a
   share rounded to two decimal places.
2. **Given** a valid exact-split expense whose shares sum to its amount,
   **When** it is recorded, **Then** the response is HTTP 201 with the exact
   shares rounded to two decimal places in a JSON object containing `id` and
   `shares`.
3. **Given** a request with a missing required field, invalid field type,
   non-positive amount, invalid split, or malformed JSON, **When** it is
   submitted, **Then** the response is HTTP 400 with a JSON `{ "error": "..." }`
   object and no expense is recorded.
4. **Given** a request body larger than 10 KB, **When** it is submitted,
   **Then** the response is HTTP 413 and no expense is recorded.

---

### User Story 2 - Review Group Balances (Priority: P2)

As a group member, I want to see each participant's net balance so that I know
who is owed money and who owes money.

**Why this priority**: Balances make the financial position of the group
transparent after expenses are recorded.

**Independent Test**: Record a known expense and compare every returned balance
with the amount paid minus the participant's allocated shares.

**Acceptance Scenarios**:

1. **Given** one or more valid expenses, **When** balances are requested,
   **Then** the response is HTTP 200 and includes every participant or payer
   in the ledger, including zero balances, rounded to two decimal places,
   where positive means owed money and negative means money owed.
2. **Given** no recorded expenses, **When** balances are requested, **Then**
   the response is HTTP 200 with an empty balances collection.
3. **Given** balances are requested after expenses are recorded, **When** the
   response is evaluated, **Then** the sum of all returned net balances is
   exactly 0.00.

---

### User Story 3 - Settle Group Debts (Priority: P3)

As a group member, I want a deterministic list of payments that settles the
group's net balances so that the group can pay back expenses with fewer
transactions.

**Why this priority**: The settlement plan turns the ledger into concrete
payments while relying on the same balances as the balance view.

**Independent Test**: Create a ledger with known positive and negative
balances, request settlement twice, and verify that the plan is repeatable and
settles every balance.

**Acceptance Scenarios**:

1. **Given** a ledger with positive and negative balances, **When** settlement
   is requested, **Then** the response is HTTP 200 with transfers from debtors
   to creditors, each rounded to two decimal places, and applying the plan
   leaves all balances at 0.00.
2. **Given** a fixed ledger, **When** settlement is requested repeatedly,
   **Then** the same ordered plan is returned each time.
3. **Given** no unsettled balances, **When** settlement is requested,
   **Then** the response is HTTP 200 with an empty plan.

---

### User Story 4 - Reset the Ledger (Priority: P2)

As a tester or group operator, I want to clear all recorded expenses so that I
can start a fresh, isolated ledger.

**Why this priority**: Reset supports repeatable tests and a clean start without
requiring persistence or database management.

**Independent Test**: Record an expense, reset the ledger, and verify that
subsequent balance and settlement responses are empty.

**Acceptance Scenarios**:

1. **Given** one or more recorded expenses, **When** the ledger is reset,
   **Then** the response is HTTP 200 and later balance and settlement requests
   return empty collections.
2. **Given** an empty ledger, **When** it is reset, **Then** the response is
   HTTP 200 and the ledger remains empty.

### Edge Cases

- An unknown path or unsupported method returns HTTP 404 with a JSON error
  object and does not change the ledger.
- A declared or streamed request body exceeding 10 KB returns HTTP 413 and is
  not processed.
- Empty or whitespace-only payer or participant names, duplicate participant
  names, fewer than two distinct participants, and non-string names are
  invalid.
- The payer may be outside the participant list; the payer's payment still
  contributes to the ledger and the payer is included in balances when owed.
- Equal splits allocate any leftover cents in participant input order so the
  same request always yields the same breakdown.
- Exact shares must be supplied for exactly the listed participants and, after
  rounding to cents, must sum to the rounded expense amount.
- Monetary input that rounds to 0.00 is rejected for the expense amount.
- Malformed JSON, a non-object request body, or a request with invalid field
  types returns HTTP 400 without recording an expense.
- When a requested expense or ledger has no outstanding debt, settlement is
  an empty list rather than a zero-value transfer.
- Names are trimmed before comparison and storage; comparisons are
  case-sensitive.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The service MUST accept expense creation with the required fields
  `payer`, `amount`, `participants`, `description`, and `splitType`, where
  `splitType` is `EQUAL` or `EXACT`.
- **FR-002**: The service MUST accept `POST /expenses` only when `payer` and
  `description` are strings, `payer` is non-empty after trimming, `amount` is
  a finite positive number, and `participants` is an array of at least two
  distinct non-empty strings after trimming. It MUST reject missing required
  fields, wrong types, duplicates, self-only splits, and amounts that round to
  0.00 with HTTP 400 and a JSON error object.
- **FR-003**: For an `EQUAL` split, the service MUST divide the rounded amount
  among all listed participants in cents and assign any remainder cents in
  participant input order. `exactShares` MUST be absent for this split type.
- **FR-004**: For an `EXACT` split, the service MUST require `exactShares` to
  contain exactly one finite, non-negative amount for each listed participant.
  The rounded shares MUST sum exactly to the rounded expense amount; otherwise
  the request MUST receive HTTP 400.
- **FR-005**: For a valid `POST /expenses`, the service MUST return HTTP 201
  with a JSON object containing a unique created expense `id` and a `shares`
  object mapping each participant name to their share rounded to two decimal
  places. It MUST NOT record an expense for an invalid request.
- **FR-006**: The ledger MUST account for each recorded expense by crediting
  the payer with the amount paid and debiting each participant by their share.
  A payer need not be listed as a participant.
- **FR-007**: `GET /balances` MUST return HTTP 200 with a JSON object
  containing a `balances` object mapping every participant and payer in the
  ledger to their net balance, including zero balances, expressed to two
  decimal places. Positive balances MUST mean the person is owed money;
  negative balances MUST mean the person owes money. The sum of all net
  balances MUST equal 0.00.
- **FR-008**: `GET /settle` MUST return HTTP 200 with a JSON array of
  debtor-to-creditor transfer objects, each containing `from`, `to`, and
  `amount`, that settles all net balances. It MUST use a deterministic greedy
  process that matches the largest outstanding debt against the largest
  credit, transfers the lesser amount, and repeats until all balances are
  zero. Ties MUST be resolved by participant name in case-sensitive
  alphabetical order. Each transfer MUST be positive and rounded to two
  decimal places; no transfer may exceed either balance being settled.
- **FR-009**: The settlement plan MUST settle all balances without redundant
  transfers. Each transfer MUST eliminate at least one non-zero balance; for
  `k` non-zero balances, the plan MUST contain at most `k - 1` transfers. A
  ledger with no non-zero balances MUST return an empty plan.
- **FR-010**: `DELETE /reset` MUST clear all recorded expenses and all derived
  balances so subsequent balance and settlement requests return empty
  collections. It MUST return HTTP 200, including when the ledger was already
  empty.
- **FR-011**: Unknown paths and unsupported methods MUST return HTTP 404 with
  a JSON error object and MUST NOT mutate the ledger.
- **FR-012**: The service MUST reject malformed JSON, missing fields, invalid
  types, invalid amounts, and inconsistent split data with HTTP 400 and a JSON
  object shaped as `{ "error": "..." }`.
- **FR-013**: The service MUST reject any request body larger than 10 KB
  (10,240 bytes) with HTTP 413 and a JSON object shaped as
  `{ "error": "..." }` before route processing or ledger mutation.
- **FR-014**: Every response MUST set `Content-Type: application/json` and
  `X-Content-Type-Options: nosniff`.
- **FR-015**: The service MUST keep ledger state in memory only, provide no
  authentication, and use no external database.
- **FR-016**: The service MUST run on Node.js 20 or later, use CommonJS and
  native runtime modules only, and have zero external runtime dependencies.
- **FR-017**: The service MUST separate HTTP routing, validation, and
  settlement calculation logic. The server MUST be exported by `src/app.js`
  without binding a fixed port when imported by tests.
- **FR-018**: Application code MUST NOT use `eval()` or `new Function()` and
  MUST NOT hardcode secrets.
- **FR-019**: Automated tests MUST use `node:test` and `node:assert/strict`
  and verify valid status codes, invalid status codes and error shapes,
  response headers, body-size enforcement, import safety, two-decimal
  rounding, and zero-sum balances.

### Binary Acceptance Criteria

| Request or condition | Pass condition |
|---|---|
| Valid `POST /expenses` with `EQUAL` split | HTTP 201; response contains a unique `id` and a `shares` object with one two-decimal share for every participant; ledger updates once |
| Valid `POST /expenses` with `EXACT` shares summing to the rounded amount | HTTP 201; response contains the `id` and a `shares` object with the supplied rounded share for every participant |
| Missing required field, malformed JSON, wrong field type, non-positive amount, self-only or duplicate participants, or inconsistent split | HTTP 400; JSON body has string `error`; ledger is unchanged |
| Valid `GET /balances` | HTTP 200; response contains a `balances` object; every recorded participant and payer has a value with two decimal places and the correct sign; all net balances sum to 0.00 |
| Valid `GET /settle` | HTTP 200; response is an array of positive, deterministic debtor-to-creditor transfers that settle every balance and meet FR-009's transfer bound |
| Valid `DELETE /reset` | HTTP 200; balances and settlement are empty afterward |
| Unknown path or unsupported method | HTTP 404; JSON body has string `error`; ledger is unchanged |
| Any request body greater than 10 KB | HTTP 413; JSON body has string `error`; request is not processed and ledger is unchanged |
| Any response | Both required headers are present: `Content-Type: application/json` and `X-Content-Type-Options: nosniff` |

### Key Entities *(include if feature involves data)*

- **Expense**: A recorded group purchase with a unique ID, payer, rounded
  amount, participant list, description, split type, and participant share
  breakdown.
- **Participant balance**: A person's net amount across the ledger, calculated
  as amounts paid minus allocated expense shares; positive means owed and
  negative means owing.
- **Settlement transfer**: A positive amount one debtor pays to one creditor
  as part of the computed plan.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid expense-creation test cases receive HTTP 201 and a
  complete share breakdown; 100% of invalid expense test cases receive HTTP
  400 and leave the ledger unchanged.
- **SC-002**: 100% of balance test cases express values to two decimal places
  and have a net sum of exactly 0.00.
- **SC-003**: 100% of settlement test cases return the same ordered plan for
  the same ledger, and applying that plan leaves every net balance at 0.00.
- **SC-004**: 100% of tested unknown routes or methods receive HTTP 404, and
  every tested request over 10 KB receives HTTP 413 without changing state.
- **SC-005**: In all tested ledgers, a settlement plan contains no more than
  one fewer transfer than the number of non-zero balances, and every transfer
  reduces the number of unsettled participants by at least one.
- **SC-006**: In 100% of valid response checks, consumers can identify the
  expense shares, the direction and value of each balance, and who pays whom
  from the returned JSON without inferring missing values.

## Assumptions

- The service maintains one process-local group ledger; separating groups,
  users, or ledgers is outside this feature.
- Participant and payer names are trimmed and compared case-sensitively.
- The payer may be excluded from the participant list; the ledger still
  records the payer's payment and includes that payer in balances when needed.
- Currency precision is two decimal places using conventional half-up
  rounding. Expense amounts are rounded to cents before split calculation;
  exact shares are rounded to cents before their sum is compared with the
  rounded expense amount.
- The 10 KB request-body limit means 10,240 bytes; a body of exactly 10,240
  bytes is within the limit.
- Equal-split remainder cents go to participants in request order. Settlement
  ties are resolved by case-sensitive alphabetical participant name.
- “Minimum-transaction” means the deterministic greedy plan specified in
  FR-008, with no redundant transfers and the upper bound in FR-009; global
  optimization across every possible grouping of balances is not required.
- `exactShares` is required for `EXACT` and rejected for `EQUAL`; exact share
  values may be zero but not negative.
- Error messages are human-readable, but clients rely on HTTP status and the
  string-valued `error` field rather than exact message text.
- Authentication, external databases, multi-group support, and persistence
  across process restarts are out of scope.
