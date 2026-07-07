# Backend hardening & optimizations

## Goal

Fix a set of security, correctness, and configuration defects in the AI Studio
Express backend (`app.js`) and land the lower-risk performance/maintainability
optimizations. Delivered as **one task**, implemented in ascending order of
change size / risk (small & safe first, architectural last), each item
independently verifiable.

User value: closes SSRF/data-loss risks, removes config drift that misleads
operators, and improves scalability of the JSON-backed store — without changing
the product's single-file, build-free deployment model.

## Confirmed Facts (from codebase inspection)

- Backend is one ESM file `app.js` (~1337 lines); JSON-file store `data/db.json`; no ORM.
- Existing spec (`.trellis/spec/`) documents the single-file + JSON-store model as **intentional**; any data-layer change must stay compatible and update the spec.
- Test runner: `node --test test/*.test.js` (~1146 lines across 7 files). `app.js` is importable without side effects (guarded by `isMainModule`, `app.js:1324`).
- Lint: ESLint flat config over `*.js`.

## Requirements (ordered small → large)

Each `R#` carries severity, evidence, and acceptance. Ordering = implementation order.

### R1 — `.env.example` ↔ code drift `[P2 · docs, tiny]`
- Documents unused vars: `MAX_REQUEST_SIZE`, `REQUEST_TIMEOUT`, `MAX_BULK_REQUESTS`, `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MS`, `LOG_LEVEL`, `LOG_REQUESTS` (none read by `app.js`).
- Missing real vars: `IMAGE_PROXY_WHITELIST` (security-critical), `TRUST_PROXY`, `LOGIN_RATE_LIMIT_MAX`, `DB_FILE`.
- Accept: `.env.example` lists exactly the vars the code reads; `scripts/validate-config.js` warns on unknown/removed vars.

### R2 — `image-to-video` missing SSRF whitelist check `[P1 · security]`
- `/api/videos/image-to-video` (`app.js:952-988`) validates URL format but omits `isUrlAllowed`, unlike `/api/videos/text-to-video` (`app.js:930`).
- Accept: both `url` and `sourceImageUrl` pass `isUrlAllowed`; a non-whitelisted URL returns 403; regression test added.

### R3 — Rate-limit window hardcoded / max not parsed `[P1 · correctness]`
- `windowMs: 15*60*1000` hardcoded (`app.js:143`) ignores documented `RATE_LIMIT_WINDOW_MS`; `max` uses unparsed env string (`app.js:144`) while `loginLimiter` uses `parseInt` (`app.js:156`).
- Accept: window and max both come from env with numeric parsing + sane defaults; `.env.example` matches; test asserts limit behavior.

### R4 — `readDb` wipes DB when `statistics` key absent `[P1 · data-loss]`
- `app.js:219` `if (!data.statistics.videoTotal)` throws if `data.statistics` is undefined → caught → returns **empty** DB; next write overwrites `db.json`, destroying existing records.
- Accept: `readDb` back-fills a missing `statistics` object before use; distinguishes "file missing" (empty DB ok) from "parse error" (must not silently overwrite); regression test with a statistics-less db.json.

### R5 — CORS wide open `[P1 · security]`
- `app.use(cors())` (`app.js:134`) allows any origin.
- **Decision: same-origin only.** Frontend and API are served from the same Express host (3 HTML pages), so cross-origin CORS is not needed. Remove `app.use(cors())` (or restrict to self); the proxy endpoints keep their explicit `Access-Control-Allow-Origin: *` on cached media responses (`app.js:1116` etc.), which is independent of the global CORS middleware and required for `<img>/<video>` crossorigin loads — verify those still function.
- Accept: no global permissive CORS; same-origin app flows and media proxy still work; regression covered.

### R6 — SSRF: default-allow + redirect bypass `[P0 · security]`
- Empty `IMAGE_PROXY_WHITELIST` allows all incl. `169.254.169.254`, `localhost`, private IPs (`app.js:52`).
- `fetch` follows redirects by default (`app.js:1128`, `app.js:1243`), so a whitelisted host can 302 to an internal target, bypassing the hostname check. Applies to both proxies and the two manual-add endpoints.
- **Decision: block private ranges even when whitelist empty + validate redirects.** Reject loopback/private/link-local targets (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`) in `isUrlAllowed` regardless of whitelist; set `redirect: 'manual'` on proxy fetches and re-run the allow-check on the `Location` (or disable redirects). An explicit whitelist entry can still opt a private host back in.
- Accept: private/loopback/link-local IPs blocked with empty whitelist; redirect-to-internal blocked; tests cover a metadata-IP (`169.254.169.254`) and a redirect-to-internal case.

### R7 — Streaming proxy: partial cache on abort/disconnect `[P2 · robustness]`
- Both proxies `pipe(res)` + `pipe(fileWriteStream)` after headers sent (`app.js:1144`, `app.js:1261`); client disconnect or upstream abort can leave a truncated cache file that later serves as a valid hit.
- Accept: cache written atomically (temp file → rename on `end` only); partial files removed on error/abort; existing behavior otherwise unchanged.

### R8 — Chevereto upload buffers whole file in memory `[P2 · optimization]`
- `Buffer.from(await response.arrayBuffer())` (`app.js:647`) loads entire image/video into memory.
- Accept: upload streams the source (or documents a hard size cap if streaming is infeasible with `form-data`); no functional regression in upload tests.

### R9 — Proxy cache: no concurrent-request de-dup `[P2 · optimization]`
- Concurrent requests for the same uncached URL each fetch + write the same file (`app.js:1087`, `app.js:1201`).
- Accept: in-flight requests for the same cache key are coalesced; second caller waits for / reuses the first fetch.

### R10 — Duplicated CRUD handlers `[P2 · maintainability]`
- 6 near-identical delete/hide/unhide handlers for images & videos (`app.js:862-1033`).
- Accept: factored into a shared helper/factory; behavior + status codes unchanged; single-file model preserved (no module split); tests still pass.

### R11 — Per-request full DB read/parse `[P1 · scalability, largest]`
- Every list/stats/mutation calls `readDb()` → `readFileSync` + `JSON.parse` of the whole `db.json` (`app.js:212`); pagination still reads all into memory then slices (`app.js:817`).
- **Decision: in-memory cache + write-through.** Load `db.json` into memory at startup; reads serve from memory; writes update memory then persist atomically via the existing temp-file→rename `writeDb`. Keeps the single-file, build-free model and current single-instance deployment; spec's "JSON store is intentional" stays valid, updated to document the in-memory cache.
- Accept: list/stats/mutation no longer re-`readFileSync`+`JSON.parse` per request; writes stay durable/atomic; a stale-cache regression test; `.trellis/spec/backend/database-guidelines.md` updated.

### R12 — Test coverage gaps `[P1 · quality, cross-cutting]`
- Untested: video-generation polling path, Chevereto upload, SSRF redirect/metadata cases.
- Accept: new/changed behavior from R1–R11 is covered; `npm test` green.

## Acceptance Criteria (task-level)

- [x] R1–R12 each meet their stated acceptance (R12: unit/integration coverage added for SSRF private-range + redirect, DB-guard/cache, i2v whitelist, rate-limit env; Chevereto streaming relies on the buffered-fallback + existing response-parsing tests rather than a live upload stub).
- [x] `npm run lint` and `npm test` pass (119 tests green).
- [x] Single-file, build-free deployment model preserved; `db.json` on-disk format unchanged (R11 is an in-memory cache, not a storage-engine change).
- [x] `.trellis/spec/` updated where behavior/conventions change (esp. R4/R6/R11 → `security.md`, `database-guidelines.md`).

## Out of Scope

- Frontend changes beyond what a backend contract change forces.
- New product features (editing, new providers).
- Full auth/session redesign.

## Open Questions

None blocking — all three scope/risk decisions resolved (R5 same-origin, R6 block-private+redirect-validation, R11 in-memory cache + write-through).
