# Styling & Assets

> Tailwind compiled to one committed CSS file, all assets self-hosted. This exists to satisfy a
> deliberately tight CSP — do not reintroduce CDNs.

---

## Tailwind Build

- Author styles as Tailwind utility classes in the HTML, plus custom layers in `src/input.css`.
- `tailwind.config.js` scans the `.html` files (content globs) for used classes.
- Compile with:

  ```bash
  npm run build   # tailwindcss -i src/input.css -o assets/tailwind.css --minify
  ```

- `assets/tailwind.css` is the **committed** build output, served at `/assets/tailwind.css`.
  Deployment is build-free, so **you must rebuild and commit the CSS whenever you add/change HTML
  classes**, or the new classes won't exist in production.

Do not hand-edit `assets/tailwind.css` — it is generated and will be overwritten.

## Self-Hosted Assets (no CDN)

Everything the pages load is same-origin:

- **Fonts** — Inter lives in `assets/fonts/` (vendored from `@fontsource-variable/inter`), served
  under `/assets`. No Google Fonts link.
- **Icons** — Lucide icons are **inlined as raw `<svg>`** directly in the markup (see the card
  actions at `library.html:549`), sourced from the `lucide-static` dev dependency. There is no
  icon-font or `<script>` icon loader.

The `/assets` directory is served **before** the auth wall (`app.js:163`) so the login page is
styled even when logged out.

## Why: The CSP Constraint

The server sends a strict CSP (`app.js:118`): `script-src 'self' 'unsafe-inline'`,
`style-src 'self' 'unsafe-inline'`, `font-src 'self'`, and **no external origins / no
`unsafe-eval`**. That is the reason nothing loads from a CDN. If you need a library or font:

1. Add it as a dev dependency, **vendor** the built file into `assets/`, and reference `/assets/...`.
2. Never add an external origin to the CSP or drop in a `<script src="https://cdn...">`.

See backend [Security](../backend/security.md) for the full CSP rationale.

## Theme

Pages are dark liquid-glass, set via `<html data-theme="dark">`. `login.html` has a theme toggle
(`login.html:249`) that flips `data-theme`; keep new components readable in the dark default.

## Anti-Patterns

- Adding a `<link>`/`<script>` to a CDN (jsDelivr, unpkg, Google Fonts) — breaks the CSP by design.
- Shipping HTML with new Tailwind classes but forgetting `npm run build` (classes silently missing in prod).
- Replacing inline Lucide SVGs with an icon-font or a runtime icon script.
