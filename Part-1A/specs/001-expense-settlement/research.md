# Research: Expense Split & Settlement Engine

## Request handling and import safety

**Decision**: Implement a native HTTP server factory that is exported by
`src/app.js`; bind a listening port only when the module is executed directly.
Check a valid `Content-Length` early and also count incoming stream bytes so
chunked requests cannot bypass the 10,240-byte limit. Do not buffer or parse a
body until the byte limit is satisfied.

**Rationale**: Node's HTTP API exposes request bodies as streams and leaves
body parsing to the application. Counting streamed bytes enforces the limit
regardless of transfer framing. Import-safe construction permits tests to
create a server without an implicit port listener.

**Alternatives considered**:
- Trusting only `Content-Length`: rejected because chunked requests can omit
  it and lengths are untrusted.
- Binding the listener at module load: rejected because importing the module
  in tests would start network activity.

**References**:
- [Node.js v20 HTTP API](https://nodejs.org/docs/latest-v20.x/api/http.html)
- [Node.js CommonJS modules](https://nodejs.org/docs/latest-v20.x/api/modules.html#accessing-the-main-module)
- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)

## Monetary representation and limits

**Decision**: Convert accepted monetary values to integer cents at the
validation boundary. Use decimal-aware half-up conversion, require a positive
expense amount, enforce the plan's conservative 1,000,000,000.00 per-expense
ceiling, and verify all accumulated cents remain safe integers before
committing an expense. Reconcile equal-split rounding remainder to the first
participant. For `EXACT`, enforce the specified 0.001 unrounded-sum tolerance
and also require rounded shares to sum exactly to the rounded expense total.

**Rationale**: Binary floating-point arithmetic must not create or destroy
money. Bounded integer-cent arithmetic supports exact balances and deterministic
settlement. The technical ceiling keeps ordinary JSON-number inputs within a
range where cent-level decimal conversion is reliable; callers can request a
different business ceiling before implementation if needed.

**Alternatives considered**:
- Accumulating decimal currency in floating point: rejected because rounding
  errors can violate the zero-sum invariant.
- Unbounded monetary inputs: rejected because they make precision and safe
  integer guarantees impossible with JavaScript `Number`.
- `BigInt` cents: not selected for v1 because JSON numbers and response
  serialization still require a defined boundary and `BigInt` would add
  conversion complexity without a stated need for larger amounts.

**References**:
- [ECMAScript `Number.MAX_SAFE_INTEGER`](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.max_safe_integer)
- [MDN: `Number.MAX_SAFE_INTEGER`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)

## Development quality gates

**Decision**: Keep runtime dependencies empty. Add ESLint as a development
dependency with its recommended rules, run Semgrep with a pinned JavaScript
ruleset in the harness/CI environment, and run built-in contract tests with
`node --test tests/app.test.js`. The `.harness/quality-gates.json` manifest
declares each gate as required and must treat any non-zero exit as failure.

**Rationale**: Static lint catches common code defects and consistency issues;
SAST provides a separate security-focused scan; contract tests verify exact
status codes, payload shapes, headers, and state invariants. Separating tools
from runtime preserves zero external runtime dependencies.

**Alternatives considered**:
- Shipping lint or scanner packages as production dependencies: rejected as
  unnecessary runtime attack surface and deployment weight.
- Relying on tests alone for security: rejected because tests do not provide
  static security pattern analysis.
- Using an unpinned SAST ruleset: rejected because rule changes can make the
  gate nondeterministic.

**References**:
- [ESLint rules](https://eslint.org/docs/latest/rules/)
- [ESLint configuration files](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Semgrep CLI reference](https://semgrep.dev/docs/cli-reference)
- [npm `devDependencies`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#devdependencies)

## Harness manifest

**Decision**: Use a project-owned JSON manifest at
`.harness/quality-gates.json` with three required named gates: `static-lint`,
`sast-security`, and `api-contract`. Each gate records its command and
`failOnNonZero: true`. A matching sample manifest is included in
`contracts/quality-gates.json`. The harness runner must reject a missing
command, unknown gate, or invalid manifest rather than report success. Store
the Semgrep ruleset at `.harness/semgrep.yml` and keep rule changes reviewed.

**Rationale**: No `.harness` directory or existing manifest schema is present
in the repository. A small explicit manifest avoids assuming an unavailable
tool-specific format while making the requested gates concrete and auditable.

**Alternatives considered**:
- Adopting an unknown pre-existing harness schema: not possible; none was
  found in the repository.
- Making gates optional: rejected because the user requested gates, not
  advisory checks.
