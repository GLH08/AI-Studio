# Providers & Adapters

> The provider registry and per-type adapter pattern — the core abstraction of the backend.

---

## When This Applies

Any time you touch generation: adding a provider type, changing how upstream requests are
built, or extracting media URLs from an upstream response.

## The Registry

Providers are declared **only** through environment variables `PROVIDER_1_*` … `PROVIDER_10_*`
and parsed once at boot by `loadProviders()` (`app.js:83`) into the `PROVIDERS` array. Each
entry is `{ id, name, type, baseUrl, apiKey, models }`. Rules baked into the loader:

- A provider is skipped unless `NAME`, `TYPE`, `BASE_URL`, and `API_KEY` are all set.
- `type` must be one of `openai`, `openai-compatible`, `gemini` (invalid types warn and skip).
- `baseUrl` has its trailing slash stripped; `models` is a comma-separated list via `parseModels()`.
- Providers with zero valid models are skipped.

Look up a provider with `getProvider(id)` (`app.js:112`). Never read `process.env.PROVIDER_*`
outside `loadProviders()`.

## The Adapter Pattern

`callProvider(provider, params)` (`app.js:605`) is a `switch` on `provider.type` that routes to:

- `callOpenAI` — `POST {baseUrl}/images/generations`, reads `result.data[].url` / `b64_json`.
- `callOpenAICompatible` — `POST {baseUrl}/chat/completions`, then **scrapes image URLs** out of the returned markdown/text (handles both JSON and SSE `text/event-stream` bodies).
- `callGemini` — `POST {baseUrl}/models/{model}:generateContent?key=...`, reads inline base64 parts and URLs from text.

Every adapter returns the same shape: `{ url, allUrls, rawContent? }`. Preserve that contract —
routes rely on `allUrls` for multi-image handling (`app.js:727`).

### Adding a new provider type

1. Write a `callX(provider, params)` adapter that returns `{ url, allUrls }`.
2. Add its `type` to `validTypes` in `loadProviders()` (`app.js:93`).
3. Add a `case` to `callProvider()`.
4. Add a unit/integration test alongside `test/generate.test.js`.

## Request Body: `buildMediaBody`

All upstream image/video bodies are built by `buildMediaBody({ model, prompt, n, params }, includeN)`
(`app.js:284`). The contract:

- The caller-supplied `params` object is spread in **verbatim** so provider-specific fields
  (`aspect_ratio`, `resolution`, `duration`, `response_format`, …) reach the upstream without
  being hardcoded per channel.
- Top-level `model` / `prompt` always win — `params` can never override routing.
- `n` is included for image generation only; video generation passes `includeN = false`.

**Do not** hardcode provider-specific parameters in adapters. If a caller needs a field, it
flows through `params`. `callOpenAICompatible` is the deliberate exception — it builds a fixed
chat-completions body and ignores `params` because the upstream is a reverse proxy.

## Video Generation (async)

`callVideoGeneration()` (`app.js:554`) only works against xAI-style `/videos/generations`
endpoints. It POSTs, extracts a `request_id` with the tolerant `extractRequestId()` scan, then
polls `GET {baseUrl}/videos/{request_id}` every `VIDEO_POLL_INTERVAL_MS` up to
`VIDEO_POLL_TIMEOUT_MS`. URL extraction (`extractVideoUrl`) and failure detection
(`videoStatusFailed`) are **field-agnostic** because the gateway passes the upstream shape
through verbatim — keep them tolerant, do not assume a fixed JSON schema.

On timeout it throws an error with `code = 'VIDEO_TIMEOUT'` and `requestId`, which the route
maps to HTTP **504** (see [Error Handling](./error-handling.md)). Keep `VIDEO_POLL_TIMEOUT_MS`
under Cloudflare's ~100s limit.

## Anti-Patterns

- Extracting URLs with a schema-strict parser — upstream responses vary; follow the tolerant field-scan style already in `extractVideoUrl`.
- Returning a bare string or a differently-shaped object from an adapter instead of `{ url, allUrls }`.
- Adding a fourth provider without adding its type to both `validTypes` and `callProvider`.
