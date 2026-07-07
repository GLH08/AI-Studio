# Security

> Auth, SSRF protection, CSP, and rate limiting are load-bearing. Changing this section can
> open the app up — read before editing middleware or the proxies.

---

## Authentication

Enabled only when `AUTH_PASSWORD` is set (`app.js:27`). Design:

- The auth cookie holds an **HMAC-SHA256 token** derived from the password (`AUTH_TOKEN`,
  `app.js:31`), never the plaintext password. It is deterministic so 30-day sessions survive
  restarts.
- The cookie is `httpOnly`, `sameSite: 'lax'`, 30-day `maxAge` (`app.js:203`).
- The auth middleware (`app.js:166`) compares cookies with `timingSafeEqualStr` (constant-time,
  `app.js:38`) — never `===`.
- Unauthenticated `/api/*` requests get **401 JSON**; unauthenticated page requests **redirect**
  to `/login.html`.

**Middleware ordering matters.** `/assets` static is mounted *before* the auth wall (`app.js:163`)
so the login page is styled; everything else is behind it. The public allow-list inside the auth
middleware is exactly `/login.html`, `/api/login`, `/favicon.ico`. Do not widen it casually, and
do not move a protected route above the auth middleware.

Login (`app.js:200`) is the only place the plaintext password is compared, and it is behind a
strict `loginLimiter` (10 attempts / 15 min) to slow brute force.

## SSRF Protection (the proxies & manual add)

`/api/proxy/image`, `/api/proxy/video`, and the manual add/collection endpoints fetch
**user-supplied URLs**, so they must gate on `isUrlAllowed(url, IMAGE_PROXY_WHITELIST)`
(`app.js:51`):

- Empty whitelist = allow all (dev convenience). A configured whitelist restricts by exact hostname.
- Blocked URLs return **403** and are `console.warn`ed with the hostname.
- Both proxies also enforce a **30s fetch timeout** via `AbortController` (`app.js:1123`).

Any new endpoint that fetches a caller-provided URL **must** run it through `isUrlAllowed` and a
timeout before fetching. This is the single most important rule in this file.

## Content Security Policy

helmet is configured with a deliberately tight CSP (`app.js:118`): `script-src 'self' 'unsafe-inline'`
with **no** `unsafe-eval` and no external script origins. This is why all frontend assets are
self-hosted (see frontend [Styling & Assets](../frontend/styling-and-assets.md)). Do not add a
CDN origin or loosen `script-src` to pull in a library — vendor it locally instead.

## Rate Limiting

- Global limiter on `/api/` (`app.js:142`): `RATE_LIMIT_MAX_REQUESTS` (default 500) / 15 min.
- Stricter `loginLimiter` on `/api/login`.
- `/api/proxy/video` is **exempted** (`app.js:150`) because it streams large files; keep it exempt.
- `app.set('trust proxy', ...)` (`app.js:25`) trusts the first hop so `req.ip` is the real client
  behind nginx/Cloudflare. Overridable with `TRUST_PROXY`; `0` = direct exposure. Getting this
  wrong makes rate limiting see the proxy IP for everyone.

## Anti-Patterns

- Comparing secrets with `===` instead of `timingSafeEqualStr` / `crypto.timingSafeEqual`.
- Storing the plaintext password anywhere (cookie, log, DB).
- Fetching a user-supplied URL without `isUrlAllowed` + timeout.
- Loosening the CSP or adding external origins to serve a script/font.
- Logging `provider.apiKey`, `AUTH_PASSWORD`, `CHEVERETO_API_KEY`, or full request bodies containing them.
