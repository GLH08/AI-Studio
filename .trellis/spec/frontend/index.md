# Frontend Development Guidelines

> The frontend is **multi-page vanilla HTML/JS with Tailwind** — no framework, no React, no
> TypeScript, no client-side router, no build step for the JS.

---

## Overview

Three standalone pages, each a self-contained HTML file with one inline `<script>`:

- `index.html` — **Create** (generate image/video) + inline Gallery/Collection/Video tabs.
- `library.html` — **Gallery / Collection / Video** browser (grid, filters, lightbox).
- `login.html` — password login.

Pages are served directly by Express (`app.js:185`); navigation between them is plain links via
the floating capsule nav. There is no shared JS bundle — small helper functions are intentionally
**duplicated** across pages. Styling is Tailwind compiled to a single committed CSS file.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Page files, `assets/`, `src/input.css`, the Tailwind build |
| [Page & DOM Patterns](./page-and-dom-patterns.md) | Inline script structure, `fetch`, event delegation, template-string rendering, `escapeHtml` |
| [Styling & Assets](./styling-and-assets.md) | Tailwind workflow, self-hosted assets, inline Lucide SVG, CSP constraints |
| [Quality Guidelines](./quality-guidelines.md) | XSS/escaping, proxy usage, when to rebuild CSS, review checklist |

---

## Conventions At A Glance

- Vanilla DOM APIs only: `document.querySelector`, `addEventListener`, `classList`, `fetch`.
- `data-*` attributes drive behavior (`data-tab`, `data-mode`, `data-filter`, `data-action`, `data-id`).
- All markup is dark-theme liquid-glass; `<html data-theme="dark">`.
- After editing any HTML class, run `npm run build` and commit `assets/tailwind.css`.

**Language**: All documentation is written in **English**.
