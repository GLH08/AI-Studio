# Directory Structure

> How the backend is organized. The entire server is one file: `app.js`.

---

## Overview

There is no `src/` tree on the server side. All backend logic lives in `app.js`, split into
ordered banner-comment sections. New code goes into the section that matches its role, in the
same top-to-bottom order the file already uses.

## Section Map (`app.js`)

| Banner | Lines (approx) | Owns |
|--------|----------------|------|
| Setup / constants | 1–75 | imports, `__dirname`, `AUTH_TOKEN`, `DATA_DIR`, `isUrlAllowed`, MIME map |
| Provider Configuration | 77–114 | `parseModels`, `loadProviders`, `getProvider`, `PROVIDERS` registry |
| Middleware | 116–208 | helmet/CSP, cors, compression, morgan, body-parser, rate limiters, auth, static, login route |
| Database Helpers | 210–270 | `readDb`, `writeDb`, `addImageToDb`, `addVideoToDb` |
| API Adapters | 272–616 | `buildMediaBody`, `callOpenAI`, `callOpenAICompatible`, `callGemini`, video generation, `callProvider` |
| Chevereto Upload Helper | 618–685 | `uploadToChevereto` |
| API Routes | 687–805 | `/health`, `/api/providers`, `/api/generate`, `/api/generate/video` |
| Image Endpoints | 807–896 | list/stats/manual/delete/hide/unhide for images |
| Video Endpoints | 898–1033 | list/stats/manual t2v & i2v/delete/hide/unhide for videos |
| Video Proxy | 1035–1171 | `/api/proxy/video` + cache helpers |
| Image Proxy | 1173–1287 | `/api/proxy/image` + cache helpers |
| Server Startup | 1289–1337 | `onListening`, `app.listen`, export block |

## Supporting Files

```
app.js                     # the whole server
scripts/validate-config.js # `npm run validate` — env-var sanity check
test/*.test.js             # node --test integration + unit tests
data/                      # runtime state (gitignored): db.json, image-cache/, video-cache/
```

## Rules For New Backend Code

- Add routes next to sibling routes in the correct banner section — do not append everything to the bottom.
- Pure, reusable helpers (parsing, URL checks) go near the top and, if a test needs them, into the `export { ... }` block at `app.js:1328`. Keep route handlers out of the export block.
- Do not introduce a build step, a framework, or a database engine to "organize" the file. The single-file layout is intentional and deployment is build-free on the server.

## Anti-Patterns

- Creating `src/routes/`, `src/services/`, etc. — there is no module system here; splitting the file is a larger architectural decision, not a casual refactor.
- Registering middleware after the routes it must protect (order matters — see [Security](./security.md)).
