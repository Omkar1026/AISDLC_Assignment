# Quickstart: Validate Ticket Triage & Routing

This guide covers validation after implementation. See [the agent and evaluation
contracts](./contracts/agent-and-evaluation.md) for module and failure semantics and
[the data model](./data-model.md) for score/evidence fields.

## Prerequisites

- Node.js 20 or later.
- Gemini API access for the configured model.
- `GEMINI_API_KEY` and `LLM_MODEL` set in the process environment or a local `.env`.
- A local `.env` must remain untracked and must never be copied into evaluation evidence.

## Configure

Use the existing `.env.example` as a key-name/template reference. Create a local `.env`
and supply a valid Gemini API key and model identifier. Do not paste credentials into
source files, prompts, benchmark cases, command transcripts, or evidence.

## Validate Evaluators

From the Part-1B project root run:

```powershell
node --test tests/evaluator.test.js
```

Expected result: all evaluator tests pass, including valid decision, missing/extra key,
invalid enum/type, clarification invariant, routing mismatch, and guardrail refusal
cases. These tests use mock outputs and do not require Gemini credentials.

## Run the Full Benchmark

From the Part-1B project root run:

```powershell
node .harness/eval-runner.js
```

Expected result:

- All 16 dataset cases are evaluated and reported.
- Each result records Layer 1, Layer 2, Layer 3, case score, pass state, and sanitized
  failure codes.
- The runner writes structured results to `evidence/eval-results.json`.
- Run passes only if at least 87.5% of the dataset passes and all adversarial/guardrail
  cases pass. Failures remain in the evidence and are not omitted.
- External HTTP/network/timeout failures are distinguished from application parse or
  evaluation failures.

## Verify the Response-Time Outcome

Run the benchmark in a stable network environment and inspect per-request elapsed time
reported by the runner. At least 95% of valid employee requests must complete with an
accepted decision within 10 seconds. A timeout is a typed external failure, not a
successful decision. The 16-case benchmark is a functional gate; repeat timing runs if
more observations are needed for a reliable p95 measurement.

## Secret-Safety Check

After both test and benchmark commands, inspect the generated evidence and logs. They
must not contain the API key, authorization header, raw model output, or raw provider
error body. Do not commit local `.env` or credential-bearing diagnostic captures.
