# Design — Backend hardening & optimizations

All work stays inside `app.js` (single-file model) plus `.env.example`,
`scripts/validate-config.js`, `test/*`, and `.trellis/spec/`. No new runtime
dependencies, no module split, no build step. ESM throughout.

## 1. SSRF hardening (R2, R6)

**`isUrlAllowed(urlString, whitelist)` (`app.js:51`) — extend, keep signature.**
Order of checks:
1. Parse URL (existing). Reject non-`http:`/`https:` schemes.
2. **Always** reject if the hostname resolves to a private/loopback/link-local
   literal: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
   `169.254.0.0/16`, `0.0.0.0`, `::1`, `fc00::/7`, `fe80::/10`. Match on IP
   literals in the hostname; a bare DNS name that *resolves* to a private IP is
   out of scope for this pass (documented limitation — literal-IP block covers
   the metadata/localhost attack, redirect validation covers the indirection).
3. If `whitelist` non-empty: require exact hostname membership (existing).
   An explicit whitelist entry overrides the private-range block (opt-in).
4. Empty whitelist → allow only after the private-range block (was: allow all).

New helper `isPrivateHost(hostname)` next to `isUrlAllowed`; unit-tested via the
export block.

**Redirect validation.** Proxy fetches (`app.js:1128`, `app.js:1243`) and any
server-side fetch of a user URL set `{ redirect: 'manual' }`. On a 3xx, read
`Location`, resolve against the request URL, re-run `isUrlAllowed`; if allowed,
fetch once more (bounded to a small max-hops, e.g. 3) else 403. Factor a small
`safeFetch(url, whitelist, opts)` helper so both proxies and Chevereto download
share one guarded path. `uploadToChevereto` downloads a **provider** URL, not a
user URL — keep it on `safeFetch` but private-range block should not apply to
provider hosts; scope `safeFetch`'s strictness via a flag (`enforceWhitelist`).

**R2:** add `isUrlAllowed` gate for both `url` and `sourceImageUrl` in
`/api/videos/image-to-video` (`app.js:952`), mirroring text-to-video.

## 2. CORS same-origin (R5)

Remove `app.use(cors())` (`app.js:134`) and the `cors` import. The proxy media
responses set their own `Access-Control-Allow-Origin: *` headers
(`app.js:1116/1140/1231/1257`) — these are independent of the middleware and
must stay so `<img crossorigin>`/`<video>` still load cached media. Verify no
route depended on the global middleware (none do — same-origin frontend).

## 3. Config truth (R1, R3)

**R3:** introduce parsed numeric env reads with defaults:
`RATE_LIMIT_WINDOW_MS` (default 900000 = 15min) and `RATE_LIMIT_MAX_REQUESTS`
(default 500, via `parseInt`), used by the global `limiter` (`app.js:142`).
Align style with `loginLimiter`'s `parseInt` (`app.js:156`).

**R1:** rewrite `.env.example` to the real read-set:
`PORT, AUTH_PASSWORD, LOGIN_RATE_LIMIT_MAX, PROVIDER_N_*, CHEVERETO_*,
IMAGE_PROXY_WHITELIST, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS,
VIDEO_POLL_INTERVAL_MS, VIDEO_POLL_TIMEOUT_MS, TRUST_PROXY, DB_FILE`.
Extend `scripts/validate-config.js` to warn on env keys not in this known set
(soft warning, non-fatal).

## 4. Data-layer robustness + in-memory cache (R4, R11)

**R4 (do first, independently):** in `readDb` (`app.js:212`) guard the back-fill:
`data.statistics = data.statistics || { total:0, byModel:{}, videoTotal:0, videoByModel:{} }`
before touching sub-fields. Separate the two failure modes: `ENOENT` → fresh
empty DB (ok); `JSON.parse`/other error → **throw** (or return a sentinel that
callers refuse to overwrite) so a transient/corrupt read never triggers a
destructive rewrite.

**R11:** introduce a module-level `let dbCache = null`.
- `readDb()` returns `dbCache` (loading + back-filling once on first call / at
  startup). Callers that mutate must not alias-and-persist a stale copy.
- `writeDb(data)` updates `dbCache = data` then does the existing atomic
  temp→rename persist (`app.js:227`). Invariant: memory and disk never diverge
  after a successful write.
- `addImageToDb`/`addVideoToDb` already read→mutate→write; they now operate on
  the cached object. Keep them the single write path.
- Tests set `DB_FILE` and import fresh; ensure cache init respects `DB_FILE` and
  can be reset between tests (export a `__resetDbCache()` test hook or re-import).
- Concurrency note unchanged (single-process, last-writer-wins) — document in spec.

## 5. Streaming proxy correctness (R7, R9)

**R7:** write cache to `${cachePath}.tmp`; `rename` to final only on stream
`end`; on `error`/client `res` close, destroy the write stream and unlink the
tmp file. A final cache file therefore always represents a complete download —
no truncated hits. Mirror in both proxies (`app.js:1087`, `app.js:1201`).

**R9:** module-level `Map<cachePath, Promise>` of in-flight fetches. First
request populates it; concurrent requests for the same key await the same
download (then both stream from the now-complete cache file). Clear the entry on
settle. Keep it simple — coalesce the fetch+cache-write, not the response
streaming.

## 6. Chevereto memory (R8)

`uploadToChevereto` (`app.js:620`) currently buffers via `arrayBuffer()`
(`app.js:647`). `form-data` accepts a Node stream, so append
`response.body` (the node-fetch stream) directly with an explicit `filename`/
`contentType`. If the upstream omits `content-length`, `form-data` needs
`knownLength` or falls back to buffering — if streaming proves unreliable,
fall back to buffering **with a hard size cap** and document it. Validate with
the media test.

## 7. CRUD de-dup (R10)

Factor the 6 handlers (`app.js:862-1033`) into two generators, e.g.
`makeHideHandler(collectionKey, hidden)` and `makeDeleteHandler(collectionKey)`,
where `collectionKey ∈ {images, videos}`. Register the routes with these. Status
codes and JSON bodies must be byte-identical to today. No behavior change — pure
refactor guarded by existing api tests.

## 8. Tests & spec (R12, cross-cutting)

Per-item tests listed in `implement.md`. Spec updates:
`.trellis/spec/backend/security.md` (SSRF private-range + redirect, CORS change),
`database-guidelines.md` (in-memory cache invariant, R4 read semantics),
`quality-guidelines.md` if env-var contract changes.

## Compatibility / Rollback

- Each R# is an isolated commit → revert individually.
- Behavior-changing items with external impact: R5 (CORS), R6 (default deny of
  private IPs — could break a deployment that proxied localhost; mitigated by
  whitelist opt-in), R11 (cache — risk of stale reads if a write path bypasses
  `writeDb`; mitigated by keeping the single write path + test).
- No DB schema/format change; `db.json` on disk stays identical.
