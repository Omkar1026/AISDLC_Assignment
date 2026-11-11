# Research: Natural-Language IT Helpdesk Ticket Triage & Routing Agent

## Decisions

### Gemini API transport

- **Decision**: Call the Gemini `generateContent` REST endpoint with Node.js 20's native
  `fetch`; submit the model in the endpoint path and the request body as JSON. Send
  `GEMINI_API_KEY` in the `x-goog-api-key` header.
- **Rationale**: Native `fetch` satisfies the zero-runtime-dependency constitution. The
  header avoids placing credentials in URLs, which are commonly exposed in request logs
  and diagnostics. The model identifier is configured through `LLM_MODEL`.
- **Alternatives considered**: Google's `@google/genai` SDK is recommended for general
  application integration and provides automatic retry behavior, but it violates the
  zero external runtime dependency requirement and risks duplicating retries.
- **Sources**:
  - [Gemini `generateContent` API](https://ai.google.dev/api/generate-content/generate-content)
  - [Gemini API key guidance](https://ai.google.dev/gemini-api/docs/api-key)
  - [Gemini REST text generation example](https://ai.google.dev/gemini-api/docs/text-generation?lang=rest)
  - [Node.js 20 global `fetch`](https://nodejs.org/docs/latest-v20.x/api/globals.html#fetch)

### Retry and request deadline

- **Decision**: Make at most three total attempts for HTTP 429/503 or transient network
  errors. Apply exponential backoff with jitter, honor a valid server retry hint when
  present, and stop scheduling attempts when the overall 10-second request deadline
  would be exceeded. Do not retry permanent 4xx responses. A deadline expiration is a
  typed external timeout, not an HTTP status or triage decision.
- **Rationale**: Bounded retries can recover from temporary service throttling/outage
  without creating an unbounded delay or retry storm. A single overall deadline aligns
  with SC-008; the finite attempt cap protects the external quota. Google documents
  bounded retries with jitter and lists transient statuses; its recommended delays are
  examples rather than a required policy.
- **Alternatives considered**: Unbounded retries or retries of all 4xx statuses are
  rejected because they can exceed the response target and repeat permanent failures.
  The official SDK retry layer is unavailable under the no-dependency constraint.
- **Sources**:
  - [Gemini troubleshooting and retry strategy](https://ai.google.dev/gemini-api/docs/troubleshooting)
  - [Gemini API errors](https://ai.google.dev/gemini-api/docs/api-errors)
  - [Node.js 20 AbortSignal](https://nodejs.org/docs/latest-v20.x/api/globals.html#class-abortsignal)

### Rate-limit pacing

- **Decision**: Serialize calls through one in-process queue, enforce at least one
  second between request starts, prevent simultaneous retries from the same process,
  and apply a longer server-provided retry delay when available. Do not treat this
  local pacing interval as a universal safe quota. When a 429 indicates quota
  exhaustion rather than a short transient limit, stop retrying beyond the bounded
  policy and surface the external failure.
- **Rationale**: A one-second start interval smooths bursts from this process, while the
  queue prevents overlapping attempts. Gemini quotas differ by model and project/usage
  tier and can include request, token, and daily quotas, so this local limit cannot
  promise compliance with every project's quota. Actual project quotas must guide any
  future configured pacing.
- **Alternatives considered**: Hardcoding a provider-wide RPM is rejected because limits
  vary. A distributed limiter is unnecessary for the specified single-process scope.
- **Sources**:
  - [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
  - [Gemini API errors](https://ai.google.dev/gemini-api/docs/api-errors)

### Failure boundary and secret-safe diagnostics

- **Decision**: Expose an external failure type for fetch/network errors, timeout, and
  HTTP non-success status; expose a distinct application-validation failure for
  malformed response JSON, missing candidate text, or invalid decision structure.
  Return no triage decision for either failure. Diagnostics may contain status, attempt
  count, and a sanitized category, but not the key, request headers, full URL with
  credentials, raw provider body, or raw model output.
- **Rationale**: This preserves the clarified caller contract and distinguishes service
  availability from application correctness. Google treats API keys as secrets and
  recommends keeping them confidential.
- **Alternatives considered**: A fallback `UNKNOWN` decision would disguise a failure as
  a successful triage outcome and violate FR-024.
- **Sources**:
  - [Gemini API key security guidance](https://ai.google.dev/gemini-api/docs/api-key)
  - [Gemini API errors](https://ai.google.dev/gemini-api/docs/api-errors)

## Research Notes

- The Gemini `generateContent` error reference varies by API surface; the implementation
  must not depend on a particular error-body shape. Handle non-JSON and malformed error
  bodies defensively and report the HTTP status when available.
- The model and the actual project quota are deployment configuration. Do not assume the
  sample model in `.env.example` defines a permanent supported model or quota.
- The ten-second response target is an end-to-end acceptance target. Retry delays and
  queue wait must fit inside the bounded request deadline; it is not permission to hide
  slow external calls.
