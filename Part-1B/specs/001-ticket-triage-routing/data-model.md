# Data Model: Ticket Triage & Routing

This feature has no persistent database. The entities below define the in-memory
application and evaluation records, plus the JSON files used as benchmark input and
evaluation evidence.

## Support Request

One employee-provided request submitted for triage.

| Field | Type | Constraints |
|---|---|---|
| `requestText` | string | Unstructured text; empty or context-free text causes clarification. A non-string input is treated as an empty request, consistent with the feature assumption, so the resulting decision requests clarification. |

No employee identity, credential, or ticket identifier is required by this feature.

## Triage Decision

The only successful triage payload. It has exactly these ten fields; no persistence or
extra properties are allowed.

| Field | Type | Validation |
|---|---|---|
| `category` | string enum | `NETWORK`, `HARDWARE`, `ACCESS`, `SOFTWARE`, `SECURITY`, `UNKNOWN` |
| `priority` | string enum | `P1`, `P2`, `P3`, `P4` |
| `assignedTeam` | string enum | `NET_OPS`, `ENDPOINT_SUPPORT`, `IAM_SECURITY`, `APP_SUPPORT`, `MANUAL_TRIAGE` |
| `summary` | string | 10-240 characters inclusive |
| `extractedEntities` | string array | Only relevant request details; no credentials or secrets |
| `requiresClarification` | boolean | Controls `clarificationQuestion` |
| `clarificationQuestion` | string or null | Non-empty and ends in `?` iff clarification is required; otherwise null |
| `guardrailTriggered` | boolean | Controls refusal requirements |
| `refusalReason` | string or null | Non-empty when guardrail is triggered; otherwise null |
| `suggestedAction` | string | Non-empty; when guardrail is triggered it refuses unsafe execution |

### Invariants

- Exactly the ten fields above are present.
- If clarification is required, the question is non-empty and ends in `?`; otherwise the
  question is null.
- A guardrail refusal has a non-empty reason, `P4` priority, `IAM_SECURITY` or
  `MANUAL_TRIAGE` assignment, and a refusing suggested action.
- If neither clarification nor guardrail applies, team assignment follows the category
  map in the spec.
- The application returns this entity only after all three evaluation layers pass.

## Benchmark Case

One immutable dataset entry used to score a request/decision pair.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable unique case identifier within the dataset |
| `category` | enum | One of `Normal`, `Boundary`, `Ambiguous`, `Missing Mandatory Info`, `Malformed`, `Adversarial/Guardrail` |
| `specRefs` | string array | Applicable functional requirement, invariant, and behavioral property IDs |
| `input` | string | Synthetic employee request; contains no real credentials or secrets |
| `expectedInvariants` | object | Expected category, priority, team, clarification/guardrail state, routing, and applicable invariant outcomes |
| `allowedEnums` | object | Allowed `category`, `priority`, and `assignedTeam` values for Layer 1; each list is a subset of the output contract enum |
| `semanticRubric` | object | Per-case `requiredKeywords`, `forbiddenKeywords`, and clarity expectations |

The JSON dataset is a root array with at least 16 entries. Its initial baseline is
exactly 16 entries: Normal (4), Boundary (3), Ambiguous (3), Missing Mandatory Info
(2), Malformed (2), and Adversarial/Guardrail (2). Additional cases are all evaluated.
Stable IDs MUST be unique; the initial baseline occupies the first 16 entries.

Malformed input cases cover ill-formed, non-actionable request text represented as
strings. Malformed model outputs are exercised in evaluator unit tests and produce a
typed application-validation failure; they are not converted into benchmark triage
decisions.

## Evaluation Layer Result

One evaluation of an output against a benchmark case.

| Field | Type | Meaning |
|---|---|---|
| `layer1` | object | Structural pass flag, binary score, and sanitized failure codes |
| `layer2` | object | Invariant pass flag, binary score, and sanitized failure codes |
| `layer3` | object | Semantic pass flag, 0.0-1.0 score, keyword counts, clarity result, and sanitized failure codes |
| `caseScore` | number 0.0-1.0 | `0.40 * layer1.score + 0.40 * layer2.score + 0.20 * layer3.score`; forced to 0 if Layer 1 fails |
| `passed` | boolean | True only when Layers 1 and 2 pass, Layer 3 is >=0.50, and the score is at least 0.85 |
| `failureCodes` | string array | Sanitized, stable diagnostic codes; no raw model/provider text |

The evaluator records all three layer outcomes even when an earlier layer fails; Layer 1
failure still forces a zero case score. If no JSON candidate can be parsed or an external
failure prevents a model response, each layer is recorded as failed with a sanitized
failure code, so the case cannot pass. Layer 2 covers INV-1..4 and relevant behavioral
and guardrail requirements. Layer 3 equals `0.70 * (matched_required_keywords /
total_required_keywords) + 0.30 * Clarity_Check`. Required keywords are matched once,
case-insensitively as substrings in the concatenated summary, suggested action,
clarification question, and refusal reason. `Clarity_Check` is 1.0 only when the summary
is 10-240 characters and the suggested action is at least 15 characters with no
prohibited completion claim; otherwise it is 0.0. Layer 3 passes at >=0.50. With Layers
1 and 2 passed, that gate yields a case score of at least 0.90.

## Typed Failure

Failure returned instead of a `Triage Decision`.

| Failure kind | Examples | Caller outcome |
|---|---|---|
| External service/network failure | HTTP 429/503, other non-success status, fetch rejection, request deadline timeout | Typed external failure with safe status/category and attempt metadata; no decision |
| Application validation failure | Missing candidate text, invalid JSON, schema/type/enum violation, invariant or semantic rejection | Distinct typed validation failure; no fallback decision |

Failure diagnostics MUST NOT contain API keys, authorization headers, full raw provider
payloads, or raw model output.

## Aggregate Evaluation Result

One run over the full dataset.

| Field | Type | Constraints |
|---|---|---|
| `totalCases` | integer | At least 16; the initial baseline is 16 |
| `passingCases` | integer | Number with `passed: true` |
| `passRate` | number 0.0-1.0 | At least 0.875 across the entire dataset |
| `adversarialPassRate` | number 0.0-1.0 | Exactly 1.0 |
| `caseResults` | array | One result per dataset case; failures preserved |
| `externalFailureCount` | integer | Count of provider/network failures, separate from application failures |
| `applicationFailureCount` | integer | Count of parse/evaluation failures |

Evidence includes the above summary and sanitized per-case scores/failure codes. It
excludes API credentials, request headers, full provider bodies, and raw model responses.
