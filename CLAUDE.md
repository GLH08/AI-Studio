# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Studio is a **multi-provider AI image generation platform** built with Express.js. It provides a unified frontend for generating images from OpenAI, OpenAI-compatible, and Gemini providers, with optional Chevereto CDN integration. Beyond generation it also lets you manually curate images and save video URLs into local galleries.

> **Scope note:** Server-side generation is **text-to-image only**. Image editing and video *generation* are not implemented (they belonged to a removed `grok2api` integration). The Collection and Video tabs store user-supplied URLs — they do not call a generation API.

## Commands

```bash
npm start        # Start production server
npm run dev      # Start with --watch flag for auto-reload
npm test         # Run tests (node --test test/*.test.js)
npm run lint     # Lint with ESLint
npm run lint:fix # Auto-fix linting issues
npm run validate # Validate environment configuration
npm run build    # Compile Tailwind -> assets/tailwind.css (after editing HTML)
```

## Architecture

### Provider Pattern
The app dynamically loads providers from environment variables (`PROVIDER_1_*` … `PROVIDER_10_*`). Each provider has a type — `openai`, `openai-compatible`, or `gemini` — that determines which adapter handles requests. `loadProviders()` parses the env vars into a registry; `callProvider()` routes to the correct adapter by type.

### API Adapters
- `callOpenAI()` — Standard OpenAI `/v1/images/generations`
- `callOpenAICompatible()` — Reverse proxy via `/v1/chat/completions`, extracts image URLs from markdown (handles both JSON and SSE responses)
- `callGemini()` — Google Gemini `/models/{model}:generateContent` (inline base64 images or URLs)

### Database
Simple JSON file storage at `data/db.json` (override with `DB_FILE`). Images and videos are stored in arrays with metadata (prompt, model, timestamp, etc.) plus a `statistics` block. `readDb()` / `writeDb()` are the accessors; `writeDb()` writes **atomically** (temp file + rename). `addImageToDb()` / `addVideoToDb()` prepend the record and update statistics **before** persisting.

### Generation Flow (`POST /api/generate`)
1. Validate provider / model / prompt.
2. `callProvider()` returns one or more image URLs.
3. Each image is uploaded to Chevereto **in parallel** (falls back to the original URL if Chevereto is unset or fails).
4. Records are saved to the DB and returned.

### Media Proxies (`/api/proxy/image`, `/api/proxy/video`)
Stream remote media to the client while caching to `data/image-cache/` / `data/video-cache/` (MD5-of-URL filename). Both enforce the `IMAGE_PROXY_WHITELIST` SSRF allow-list (via `isUrlAllowed()`) and a 30s fetch timeout. Cache files older than 30 days are cleaned **asynchronously** after startup (never blocking boot). The video proxy skips rate limiting.

### Authentication
If `AUTH_PASSWORD` is set, all routes except `/login.html` and `/api/login` require auth. On login the server sets an HttpOnly cookie containing an **HMAC-signed token** (never the plaintext password). The middleware validates it with a constant-time comparison.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 8787) |
| `AUTH_PASSWORD` | If set, enables password protection |
| `PROVIDER_X_NAME` | Display name for provider X |
| `PROVIDER_X_TYPE` | `openai`, `openai-compatible`, or `gemini` |
| `PROVIDER_X_BASE_URL` | API endpoint base URL |
| `PROVIDER_X_API_KEY` | API authentication key |
| `PROVIDER_X_MODELS` | Comma-separated model list |
| `CHEVERETO_URL` | Chevereto CDN API URL |
| `CHEVERETO_API_KEY` | Chevereto API key |
| `CHEVERETO_ALBUM_ID` | Optional album ID for uploads |
| `IMAGE_PROXY_WHITELIST` | Comma-separated allowed hostnames for the proxies and manual add (empty = allow all) |
| `RATE_LIMIT_MAX_REQUESTS` | Rate limit per 15 minutes (default: 500) |
| `DB_FILE` | Override path to the JSON DB (used by tests) |

## Key API Endpoints

- `POST /api/generate` — Text-to-image generation
- `GET /api/providers` — List configured providers and models
- `GET /api/images` / `GET /api/videos` — List stored media
- `POST /api/images/manual` — Manually add an image URL
- `POST /api/videos/text-to-video` / `POST /api/videos/image-to-video` — Manually add a video URL
- `PATCH /api/images/:id/hide` / `PATCH /api/videos/:id/hide` — Hide items from gallery
- `DELETE /api/images/:id` / `DELETE /api/videos/:id` — Delete items

## Frontend

Multi-page, no framework: `index.html` (Create), `library.html` (Gallery/Collection/Video), `login.html` — each a standalone page with an inline `<script>` (liquid-glass dark UI, floating capsule nav).

Assets are **self-hosted** (no CDN) so the CSP can stay tight (`script-src 'self' 'unsafe-inline'`, no `unsafe-eval` or external origins):
- Tailwind compiles to `assets/tailwind.css` via `npm run build` (the built CSS is **committed**, so deployment stays build-free — rebuild after changing HTML classes).
- Inter font lives in `assets/fonts/`; Lucide icons are inlined as SVG.

## Testing

- `test/core.test.js` / `test/image-proxy.test.js` — unit tests for pure logic (`parseModels`, `isUrlAllowed`, cache-path generation).
- `test/api.test.js` / `test/auth.test.js` — integration tests that import the real `app.js` (which is exported for this purpose) and drive it over an ephemeral port. They set `DB_FILE` for isolation and configure provider/auth env vars **before** importing `app.js` (`app.listen` only runs when the file is executed directly, not when imported).
