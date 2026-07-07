# Quality Guidelines

> Standards for frontend changes. The two things that most often go wrong here: **unescaped
> user text (XSS)** and **forgetting to rebuild Tailwind**.

---

## XSS: Escape All Interpolated Text

The pages render via `innerHTML` template strings, so escaping is manual and mandatory. Every
value that originates from the server or user — `prompt`, `model`, `provider`, and any URL placed
in an attribute — must pass through `escapeHtml` (`library.html:443`) before it enters the string.

```js
<div data-id="${escapeHtml(item.id)}" data-url="${escapeHtml(url)}">
    <p>${escapeHtml(item.prompt)}</p>
</div>
```

Missing one `escapeHtml` is a stored-XSS hole because prompts are user-controlled and persisted.
This is the single most important review item on the frontend.

## Rebuild CSS After Class Changes

If you add or change any Tailwind class in an HTML file, run `npm run build` and commit the
updated `assets/tailwind.css`. Deployment does not build; unbuilt classes are silently absent in
production. See [Styling & Assets](./styling-and-assets.md).

## Required Patterns

- Route all remote media through `getImageProxyUrl` / `getVideoProxyUrl` (never a raw remote `src`).
- Use delegated `data-*` event handling and the shared `initSegmented` helper for tabbed/segmented UI.
- `fetch` same-origin `/api/*`, wrap in `try/catch`, read `data.error` on failure.
- Keep each page a single self-contained HTML file; duplicated helpers stay in sync across pages.

## Forbidden Patterns

- `innerHTML` with un-escaped user/server strings.
- CDN `<script>` / `<link>` or external font/icon origins (violates the CSP — [Styling & Assets](./styling-and-assets.md)).
- Adding a framework, bundler, or client-side router.
- Editing `assets/tailwind.css` by hand.

## Testing / Verification

There is no automated frontend test suite. Verify manually:

1. `npm run build` succeeds and the page renders with correct styling.
2. Generate/collect an item, confirm it lists, hides/unhides, and deletes.
3. Confirm images/videos load through `/api/proxy/*` (not the raw provider URL).
4. Try a prompt containing `<script>`/`"`/`<` and confirm it renders as text, not markup.

## Code Review Checklist

- [ ] Every interpolated user/server value is `escapeHtml`-wrapped.
- [ ] Media URLs go through the proxy helpers.
- [ ] Event handling is delegated via `data-*`, not per-element.
- [ ] Duplicated helper fixed on every page that has a copy.
- [ ] `npm run build` run and `assets/tailwind.css` committed if classes changed.
- [ ] No new CDN/external origins introduced.
