# Error Handling

> There are no custom error classes. Validation returns early with a 4xx; adapters throw plain
> `Error`s that route `try/catch` blocks turn into `{ error }` JSON.

---

## Response Contract

Every error response is JSON with a single `error` string:

```js
res.status(400).json({ error: 'Missing prompt.' });
```

Clients rely on this shape everywhere (the frontend reads `data.error`). Never return an error
as plain text, an array, or a different key.

## Validate-First (early 400s)

Route handlers validate input at the top and `return` immediately on the first failure, before
any side effect. The generation routes are the reference (`app.js:712`, `app.js:760`):

```js
if (!providerId) return res.status(400).json({ error: 'Missing provider.' });
const provider = getProvider(providerId);
if (!provider) return res.status(400).json({ error: `Unknown provider: ${providerId}` });
if (!model) return res.status(400).json({ error: 'Missing model.' });
if (!provider.models.includes(model)) return res.status(400).json({ error: `Model "${model}" not available.` });
if (!prompt) return res.status(400).json({ error: 'Missing prompt.' });
```

URL inputs are validated with `new URL(...)` in a `try/catch` and, where relevant, against the
SSRF whitelist returning **403** (`app.js:839`). Missing resources return **404** with the
read-modify-write pattern (see [Database Guidelines](./database-guidelines.md)).

## Status Codes In Use

| Code | When |
|------|------|
| 400 | Missing/invalid input (provider, model, prompt, malformed URL) |
| 401 | Unauthenticated API request (auth middleware) |
| 403 | URL/domain not on the SSRF whitelist |
| 404 | Image/video id not found |
| 500 | Generation or unexpected upstream failure (`error.message`) |
| 504 | Video generation timeout, or proxy fetch `AbortError` |

## Throwing From Adapters

Adapters and helpers throw `new Error(...)` with a descriptive message (including upstream status
and body text, e.g. `app.js:321`). The route's `try/catch` logs and maps it to a 500:

```js
try {
    const result = await callProvider(provider, { model, prompt, n, params });
    // ...
} catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message });
}
```

### Typed control flow via `error.code`

The one place a code is attached is the video timeout (`app.js:596`): the error carries
`code = 'VIDEO_TIMEOUT'` and `requestId`, and the route special-cases it to **504** with the
`request_id` so the client can keep polling. Follow this pattern (a `code` property on a plain
`Error`) if you need to distinguish a failure mode — do not introduce an error-class hierarchy.

## Non-Fatal Failures (log and continue)

Some failures must **not** fail the request:

- Chevereto upload failures return `null` and fall back to the original URL (`app.js:731`, `app.js:681`).
- `addImageToDb` / `addVideoToDb` catch and log instead of throwing.
- Proxy cache-write errors delete the partial file and keep serving the stream (`app.js:1151`).

Decide deliberately whether a failure is fatal (throw → 500) or degradable (log → continue).

## Anti-Patterns

- Sending `res.status(500).send(error)` (leaks stack/objects) — always `{ error: error.message }`.
- Doing work before validation finishes (e.g. calling a provider before checking `prompt`).
- Swallowing an error silently with no `console.error`.
