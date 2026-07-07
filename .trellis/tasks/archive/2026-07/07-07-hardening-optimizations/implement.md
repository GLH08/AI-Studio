# Implement — Backend hardening & optimizations

Execution order = ascending risk (R1 → R11), R12 tests woven per item. Each step
is one commit with its own test(s). Run `npm run lint && npm test` after every step.

## Ordered checklist

### Step 1 — R1: config truth `[docs]`
- [ ] Rewrite `.env.example` to the real read-set (see design §3).
- [ ] Extend `scripts/validate-config.js` to warn on unknown env keys.
- Verify: `npm run validate` warns on a planted bogus var; documents `IMAGE_PROXY_WHITELIST`.

### Step 2 — R2: image-to-video SSRF gate
- [ ] Add `isUrlAllowed` for `url` + `sourceImageUrl` in `/api/videos/image-to-video` (`app.js:952`).
- [ ] Test: non-whitelisted URL → 403 (add to `test/media.test.js`).
- Verify: `npm test`.

### Step 3 — R4: readDb statistics guard (data-loss)
- [ ] Back-fill `data.statistics` before sub-field access (`app.js:219`); split ENOENT vs parse-error.
- [ ] Test: a `db.json` with `images` but no `statistics` reads intact, and a following write does not wipe it (`test/core.test.js` or new `test/db.test.js`).
- Verify: `npm test`.

### Step 4 — R3: rate-limit config
- [ ] Read `RATE_LIMIT_WINDOW_MS` + parsed `RATE_LIMIT_MAX_REQUESTS` with defaults (`app.js:142`).
- [ ] Test: extend `test/ratelimit.test.js` to assert env-driven max.
- Verify: `npm test`.

### Step 5 — R5: same-origin CORS
- [ ] Remove `app.use(cors())` + import (`app.js:134`).
- [ ] Confirm proxy media responses still send `Access-Control-Allow-Origin: *`.
- [ ] Test: image-proxy test still passes; app routes reachable same-origin.
- Verify: `npm test`.

### Step 6 — R6: SSRF private-range + redirect validation `[P0]`
- [ ] Add `isPrivateHost` + integrate into `isUrlAllowed` (design §1); export for tests.
- [ ] Add `safeFetch(url, {enforceWhitelist})` with `redirect:'manual'` + re-check + max-hops.
- [ ] Route both proxies (and manual-add URL validation) through the guard.
- [ ] Tests: `169.254.169.254` blocked with empty whitelist; whitelisted host 302→internal blocked; normal fetch still works (`test/image-proxy.test.js` + core unit tests).
- Verify: `npm test`.

### Step 7 — R7: atomic cache write
- [ ] Cache to `${cachePath}.tmp`, rename on `end`, unlink on error/abort — both proxies (`app.js:1087`, `app.js:1201`).
- [ ] Test: simulated mid-stream error leaves no final cache file.
- Verify: `npm test`.

### Step 8 — R9: in-flight de-dup
- [ ] `Map` of in-flight downloads keyed by cache path; coalesce concurrent misses.
- [ ] Test: two concurrent requests for same uncached URL trigger one upstream fetch.
- Verify: `npm test`.

### Step 9 — R8: stream Chevereto upload
- [ ] Append `response.body` stream to `form-data` (fallback: buffered + size cap) (`app.js:647`).
- [ ] Test: upload path exercised in `test/media.test.js` (mock upstream).
- Verify: `npm test`.

### Step 10 — R10: CRUD handler factory
- [ ] Replace 6 handlers with `makeHideHandler`/`makeDeleteHandler` (`app.js:862-1033`).
- [ ] Verify identical status/body via existing `test/api.test.js`.
- Verify: `npm test`.

### Step 11 — R11: in-memory DB cache + write-through `[largest]`
- [ ] `dbCache` module var; `readDb` serves memory; `writeDb` updates memory + atomic persist.
- [ ] Test reset hook for `DB_FILE` isolation; stale-cache regression test.
- [ ] Update `.trellis/spec/backend/database-guidelines.md`.
- Verify: full `npm test`; manual smoke of list/generate/delete.

### Step 12 — R12 + spec sweep (final)
- [ ] Confirm coverage for video-poll path, Chevereto, SSRF cases.
- [ ] Update `.trellis/spec/backend/security.md` (SSRF, CORS) + any others touched.
- [ ] Full-scope check (Phase 2.2): lint, tests, cross-layer, reuse, consistency.

## Validation commands

```bash
npm run lint
npm test
npm run validate
```

## Risky files / rollback points

- `app.js` `isUrlAllowed` / `safeFetch` (R6) — security-critical; over-blocking breaks all media. Land behind tests first.
- `app.js` `readDb`/`writeDb` (R4, R11) — data integrity; keep single write path; each is its own revertible commit.
- `uploadToChevereto` (R8) — streaming can fail silently on missing content-length; keep buffered fallback.

## Review gates

- After Step 6 (R6) and Step 11 (R11): pause for review before proceeding (highest-risk items).
- Each step commits independently so any single R# can be reverted without unwinding the rest.
