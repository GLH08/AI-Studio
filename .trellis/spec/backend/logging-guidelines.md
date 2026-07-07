# Logging Guidelines

> Logging is deliberately simple: `console.*` with tagged, emoji-prefixed messages, plus
> `morgan` for HTTP access logs. There is no structured logger and no log library to add.

---

## The Two Layers

1. **HTTP access log** — `morgan('combined')` middleware (`app.js:136`) logs every request in
   Apache combined format. Do not replace or reconfigure it without a reason.
2. **Application log** — plain `console.log` / `console.warn` / `console.error` calls throughout
   `app.js`.

## Level Convention

| Call | Use for |
|------|---------|
| `console.log` | Normal flow: successful saves (`✅`), upstream calls, cache hits, proxy fetches |
| `console.warn` | Recoverable/suspicious: invalid provider type at boot, **blocked SSRF domain** (`app.js:1103`) |
| `console.error` | Failures: generation errors, Chevereto upload failures, cache write errors |

## Message Style

Follow the existing conventions so logs stay greppable:

- **Bracket tags** name the subsystem: `[OpenAI]`, `[Gemini]`, `[Video]`, `[Generate]`, `[Proxy]`.
  Example: `` console.log(`[Proxy] Serving from cache: ${cachePath}`) `` (`app.js:1111`).
- **Emoji prefixes** mark lifecycle events: `✅` success, `⚠️` warning/disabled, `❌`/`🚀`/`☁️`.
  Example: `` console.log(`✅ Image saved to database: ${image.model} (Total: ${db.statistics.total})`) ``.
- Include the identifying context (model, url, hostname, status) but see "What NOT to log" below.

Match the tag of the section you are editing; add a new `[Tag]` only for a genuinely new subsystem.

## What NOT To Log

Never log secrets or anything derived from them:

- `AUTH_PASSWORD`, `AUTH_TOKEN`, the auth cookie value.
- `provider.apiKey`, `CHEVERETO_API_KEY`.
- Full request/response bodies when they may carry Authorization headers or keys.

Note the existing adapters log the **request body** (`app.js:308`, `app.js:559`) — that is
acceptable because the body is `{ model, prompt, params }` with no credentials; the API key lives
in the `Authorization` header, which is never logged. Preserve that boundary: if you ever move a
secret into the body, stop logging the body.

## Anti-Patterns

- Introducing winston/pino/etc. — not warranted for this app's size.
- Logging an entire `error` object that may contain a request with an `Authorization` header (log `error.message`).
- Dropping the `[Tag]` / emoji conventions so operators can no longer grep by subsystem.
