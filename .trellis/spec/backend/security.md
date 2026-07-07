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
(`app.js:51`). The policy has three layers:

- **Private-range block (always on).** `isPrivateHost` rejects loopback / private / link-local
  IP literals (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` incl. cloud metadata,
  `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped) — **even with an empty whitelist**. Non-`http(s)`
  schemes are rejected too.
- **Whitelist.** A configured `IMAGE_PROXY_WHITELIST` restricts to exact hostnames and, being an
  explicit opt-in, *overrides* the private-range block (so you can whitelist an internal host on
  purpose). Empty whitelist = allow all **public** hosts only.
- **Redirect re-validation.** The proxies fetch through `safeFetch` (`redirect: 'manual'`), which
  re-runs `isUrlAllowed` on every `Location` hop so a whitelisted host can't 302 to an internal
  target. It throws `code: 'SSRF_BLOCKED'` → **403**. A 30s `AbortController` timeout still applies.

Downloads to the media cache go through `ensureCached` → `safeFetch`; caching is atomic
(`tmp` → rename) and concurrent misses for the same URL are coalesced. Blocked URLs return **403**
and are `console.warn`ed with the hostname.

Any new endpoint that fetches a caller-provided URL **must** run it through `isUrlAllowed`/`safeFetch`
and a timeout before fetching. This is the single most important rule in this file.

## CORS

The app is **same-origin** — the frontend pages and the API are served from the same Express host,
so there is no global `cors()` middleware (removed; do not re-add a permissive `app.use(cors())`).
The media proxies set their own `Access-Control-Allow-Origin: *` on cached responses so
`<img crossorigin>` / `<video>` can load them; that is intentional and independent of any global
CORS policy.

## Content Security Policy

helmet is configured with a deliberately tight CSP (`app.js:118`): `script-src 'self' 'unsafe-inline'`
with **no** `unsafe-eval` and no external script origins. This is why all frontend assets are
self-hosted (see frontend [Styling & Assets](../frontend/styling-and-assets.md)). Do not add a
CDN origin or loosen `script-src` to pull in a library — vendor it locally instead.

## Rate Limiting

- Global limiter on `/api/` (`app.js:142`): `RATE_LIMIT_MAX_REQUESTS` (default 500) per
  `RATE_LIMIT_WINDOW_MS` (default 15 min). Both are read via `parseInt` — keep numeric parsing.
- Stricter `loginLimiter` on `/api/login`.
- `/api/proxy/video` is **exempted** (`app.js:150`) because it streams large files; keep it exempt.
- `app.set('trust proxy', ...)` (`app.js:25`) trusts the first hop so `req.ip` is the real client
  behind nginx/Cloudflare. Overridable with `TRUST_PROXY`; `0` = direct exposure. Getting this
  wrong makes rate limiting see the proxy IP for everyone.

## Anti-Patterns

- Comparing secrets with `===` instead of `timingSafeEqualStr` / `crypto.timingSafeEqual`.
- Storing the plaintext password anywhere (cookie, log, DB).
- Fetching a user-supplied URL without `isUrlAllowed` / `safeFetch` + timeout, or following
  redirects without re-validating each hop.
- Re-adding a permissive global `cors()` — the app is same-origin.
- Loosening the CSP or adding external origins to serve a script/font.
- Logging `provider.apiKey`, `AUTH_PASSWORD`, `CHEVERETO_API_KEY`, or full request bodies containing them.
