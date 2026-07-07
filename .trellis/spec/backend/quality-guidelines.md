# Quality Guidelines

> Standards for backend changes to `app.js`. Keep changes surgical and covered by `node --test`.

---

## Linting

ESLint (flat config, `eslint.config.js`) runs over `*.js`. Enforced rules that matter:

- 4-space indentation, single quotes, semicolons, Unix line endings.
- `no-unused-vars` (args ignored via `argsIgnorePattern: '^_'`).
- `prefer-const`, `no-var`, `eqeqeq` (`===` always).

Run before every commit:

```bash
npm run lint       # must pass clean
npm run lint:fix   # auto-fix formatting
```

## Required Patterns

- **Config via env only.** Read configuration through `process.env` at module load (like
  `PROVIDERS`, `AUTH_TOKEN`, `DB_FILE`). No config files, no hardcoded secrets or URLs.
- **Params passthrough.** Provider-specific request fields flow through the `params` object into
  `buildMediaBody`, never hardcoded per provider (see [Providers & Adapters](./providers-and-adapters.md)).
- **Persist through helpers.** All DB writes go through `writeDb` / `addImageToDb` / `addVideoToDb`
  (see [Database Guidelines](./database-guidelines.md)).
- **Validate-first, `{ error }` responses** (see [Error Handling](./error-handling.md)).
- **Gate user URLs** through `isUrlAllowed` + timeout (see [Security](./security.md)).
- Keep `app.js` importable without side effects beyond route registration — real startup is
  guarded by `isMainModule` (`app.js:1324`). Tests depend on this.

## Testing Requirements

Tests use the built-in runner: `node --test test/*.test.js` (`npm test`). Two styles:

- **Unit** (`test/core.test.js`, `test/image-proxy.test.js`) — pure helpers exported from
  `app.js` (`parseModels`, `isUrlAllowed`, cache-path generation). Add here when you add/change a
  pure helper.
- **Integration** (`test/api.test.js`, `test/auth.test.js`, `test/generate.test.js`,
  `test/media.test.js`, `test/ratelimit.test.js`) — import the real `app`, set `DB_FILE` and
  provider/auth env vars **before** importing `app.js`, and drive it over an ephemeral port.

Any new route or behavioral change needs a test in the matching file. A new pure helper that a
test needs must be added to the `export { ... }` block (`app.js:1328`).

## Code Review Checklist

- [ ] Change traces to the request; no unrelated refactors or reformatting.
- [ ] New logic sits in the correct `app.js` banner section (see [Directory Structure](./directory-structure.md)).
- [ ] Validation runs before side effects; errors return `{ error }` with the right status.
- [ ] User-supplied URLs pass `isUrlAllowed` + timeout; no secrets logged.
- [ ] DB access only through the four helpers; new fields back-filled in `readDb`.
- [ ] `npm run lint` and `npm test` pass.
- [ ] Rebuilt CSS committed **if** HTML classes changed (`npm run build`).

## Anti-Patterns

- Adding dependencies or a build step for the server (deployment is build-free).
- Splitting `app.js` into a module tree as an incidental "cleanup."
- Reading `process.env.PROVIDER_*` anywhere but `loadProviders()`.
