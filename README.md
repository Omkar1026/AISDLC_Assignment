# Assignment 1

This repository contains two independent Node.js projects developed from their
Spec Kit requirements, plans, contracts, implementation tasks, and validation
evidence.

## Parts

- **Part-1A - Expense Split & Settlement Engine REST API:** A deterministic,
  in-memory REST API for recording group expenses, calculating balances, and
  producing settlement transfers. Its tests cover the API contract and
  settlement behavior; a deterministic harness runs lint, security/SAST, and
  contract/unit-test gates.
- **Part-1B - Natural-Language IT Helpdesk Ticket Triage & Routing Agent:**
  An agent that classifies and routes employee support requests using a
  configured Gemini model. Its evaluation harness checks each result through
  three layers: structural schema, invariants and guardrails, and semantic
  quality.

## Repository structure

```text
Assignment-1/
├── Part-1A/
│   ├── .harness/              # Lint, security, and deterministic test gates
│   ├── .specify/              # Spec Kit memory and templates
│   ├── evidence/              # Harness reports, log, and generation snapshots
│   ├── specs/001-expense-settlement/
│   │   ├── checklists/
│   │   ├── contracts/
│   │   ├── data-model.md
│   │   ├── plan.md
│   │   ├── quickstart.md
│   │   ├── research.md
│   │   ├── spec.md
│   │   └── tasks.md
│   ├── src/                    # API, ledger, validation, and settlement
│   ├── tests/
│   ├── eslint.config.js
│   └── package.json
├── Part-1B/
│   ├── .harness/              # Three-layer evaluation runner and evaluators
│   ├── .specify/              # Spec Kit memory and templates
│   ├── evals/dataset.json     # Fixed triage evaluation dataset
│   ├── evidence/              # Evaluation reports, log, and snapshots
│   ├── prompts/system-prompt.md
│   ├── specs/001-ticket-triage-routing/
│   │   ├── checklists/
│   │   ├── contracts/
│   │   ├── data-model.md
│   │   ├── plan.md
│   │   ├── quickstart.md
│   │   ├── research.md
│   │   ├── spec.md
│   │   └── tasks.md
│   ├── src/agent.js
│   ├── tests/
│   ├── .env.example
│   └── package.json
└── README.md
```

## Run and validate

The commands below use Windows PowerShell and assume the terminal starts at the
repository root. Node.js 20 or later is required.

### Part-1A tests and deterministic harness

```powershell
Set-Location .\Part-1A
node demo.js
node --test tests/app.test.js
node .harness/harness.js
```

The harness runs the configured lint, security/SAST, and contract/unit-test
gates and writes its report to `Part-1A/evidence/harness-results.json`.
`node demo.js` starts a temporary server on an ephemeral port and prints sample
expense, balance, settlement, and validation responses.

### Part-1B offline tests and three-layer evaluation

First run the offline tests. They use mock responses and do not require Gemini
credentials:

```powershell
Set-Location .\Part-1B
node demo.js
node --test
```

The live demo uses Gemini credentials for the VPN ticket; the ambiguous and
unsafe examples are resolved locally.

To run the evaluation against Gemini, create a local `.env` from the example
and edit it to set a valid API key and the required model. If `.env` already
exists, keep it and edit it rather than overwriting local credentials.

```powershell
Copy-Item .env.example .env
notepad .env
```

Set these values in `.env`, replacing the API key placeholder with your own
key. Do not commit `.env`:

```dotenv
GEMINI_API_KEY=your_real_api_key
LLM_MODEL=gemini-flash-lite-latest
```

Save the file, then run the three-layer evaluation harness:

```powershell
node .harness/eval-runner.js
```

The evaluation requires Gemini API access. It evaluates all cases through
structural, invariant/guardrail, and semantic layers and writes sanitized
results to `Part-1B/evidence/eval-results.json`.

## Specifications and evidence

Each part's Spec Kit artifacts are under its `specs/` feature directory:

- [Part-1A Spec Kit artifacts](Part-1A/specs/001-expense-settlement/)
- [Part-1B Spec Kit artifacts](Part-1B/specs/001-ticket-triage-routing/)

For validation history and the final review decision, see each part's
[`evidence/harness-log.md`](Part-1A/evidence/harness-log.md) and
[`evidence/harness-log.md`](Part-1B/evidence/harness-log.md). Machine-readable
results and initial/final generation snapshots are stored alongside each log
in that part's `evidence/` directory.
