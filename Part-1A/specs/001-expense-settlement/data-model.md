# Data Model: Expense Split & Settlement Engine

## Money representation

- Monetary values are represented internally as signed integer cents.
- Request amounts are finite JSON numbers and are converted with decimal-aware
  half-up rounding.
- Expense amount must round to at least one cent and must not exceed the
  confirmed maximum of 1,000,000,000.00 currency units; a greater amount
  receives HTTP 400.
- Every sum and balance update must remain a safe integer in cents. Reject an
  expense before mutating state if any resulting aggregate would overflow.
- JSON monetary output is expressed in currency units rounded to exactly two
  decimal places.

## Expense

One successfully recorded group expense.

| Field | Type | Constraints |
|---|---|---|
| `id` | string | Unique for the lifetime of the process; generated only after validation succeeds |
| `payer` | string | Trimmed, non-empty participant name |
| `amountCents` | safe integer | Positive, rounded total expense in cents |
| `participants` | string array | At least two distinct trimmed non-empty names; preserve request order |
| `description` | string | Required string |
| `splitType` | enum | `EQUAL` or `EXACT` |
| `sharesCents` | name-to-safe-integer map | Exactly one non-negative share for every participant; sum equals `amountCents` |

### Split validation and calculation

- `EQUAL`: derive equal unrounded portions, half-up round each portion to
  cents, and apply the complete difference between share sum and expense total
  to the first listed participant.
- `EXACT`: require keys to match the participant names exactly; all values
  must be finite and non-negative. The unrounded sum must be within 0.001 of
  the submitted expense amount. After cent rounding each share, the sum must
  equal the rounded expense amount or the request is rejected.
- Duplicate participant names are invalid. Name matching is case-sensitive
  after trimming whitespace.

## Ledger

Process-local collection of validated expenses and derived participant
balances. Reset clears all expenses and derived state.

### Participant balance

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Trimmed, case-sensitive participant or payer name |
| `netCents` | safe integer | Total paid in cents minus shares owed in cents |

- Positive balance means the person is owed money.
- Negative balance means the person owes money.
- Include all participants and payers encountered in the ledger, including
  zero balances.
- The sum of all `netCents` is exactly zero after each accepted expense.

## Settlement transfer

| Field | Type | Constraints |
|---|---|---|
| `from` | string | Debtor with a negative net balance |
| `to` | string | Creditor with a positive net balance |
| `amountCents` | positive safe integer | Lesser of the debtor's absolute debt and creditor's credit |

The greedy algorithm sorts debtors and creditors by absolute balance
descending, then case-sensitive alphabetical name. It matches the first
debtor and creditor, emits a transfer for the lesser balance, removes settled
entries, and repeats until all balances are zero. The same ledger must always
produce the same ordered plan.

## State transitions

1. **Empty ledger** → valid expense accepted → **Ledger with expense**.
2. **Ledger with expenses** → valid expense accepted → **Updated ledger**.
3. **Any ledger** → invalid or oversized request → **Unchanged ledger**.
4. **Any ledger** → reset request → **Empty ledger**.
5. Balance and settlement reads do not mutate ledger state.
