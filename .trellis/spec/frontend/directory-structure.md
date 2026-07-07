# Directory Structure

> The frontend is a flat set of HTML pages at the repo root plus self-hosted `assets/`. There is
> no `src/` component tree.

---

## Layout

```
index.html            # Create page + inline gallery tabs
library.html          # Gallery / Collection / Video browser
login.html            # Login page
src/input.css         # Tailwind entry (@tailwind directives + custom layers)
tailwind.config.js    # Tailwind config (content globs → *.html)
assets/
├── tailwind.css      # COMPILED output — committed, served at /assets/tailwind.css
└── fonts/            # self-hosted Inter (from @fontsource-variable/inter)
```

## Each Page Is Self-Contained

A page file contains, in order: `<head>` with `<link rel="stylesheet" href="/assets/tailwind.css">`,
the markup, and one inline `<script>` at the bottom holding all of that page's logic. There is no
shared `.js` file and no ES-module imports in the browser.

Small helpers (`getImageProxyUrl`, `getVideoProxyUrl`, `escapeHtml`, `initSegmented`) are
**deliberately duplicated** across pages rather than extracted into a shared module — this keeps
each page a single deployable file and avoids a client bundler. When you fix such a helper, check
whether the same function exists on another page and update both. (Cross-check: they appear at
`index.html:471` and `library.html:433`.)

## Naming

- Pages are lowercase `.html` at the repo root; the route is the filename (`/index.html`, `/library.html`).
- IDs and `data-*` hooks are camelCase / kebab (`data-tab`, `resetParams`, `generateBtn`).

## Where Things Go

- New UI element → the relevant page's markup + its inline `<script>`.
- New shared visual style → a Tailwind utility in the markup, or a custom layer in `src/input.css` (then rebuild).
- Never add a `node_modules` script tag or a CDN link — see [Styling & Assets](./styling-and-assets.md).

## Anti-Patterns

- Creating a `src/components/` or `js/` tree and wiring a bundler — the multi-page, build-free-JS model is intentional.
- Editing `assets/tailwind.css` by hand — it is generated; edit `src/input.css` and rebuild.
