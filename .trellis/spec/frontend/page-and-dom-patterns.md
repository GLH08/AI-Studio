# Page & DOM Patterns

> How the inline page scripts are written. Follow these so new UI matches the existing vanilla-JS
> style instead of importing a framework.

---

## Inline Script Shape

Each page's logic lives in one bottom-of-body `<script>`. Typical order: helper functions →
element lookups (`document.getElementById(...)`) → `fetch`-based data loaders → render functions →
event wiring. No modules, no classes, no framework lifecycle.

## Data Fetching

All server calls use `fetch` against the same-origin `/api/*` endpoints, wrapped in
`try/catch`, reading the `{ error }` field on failure. Reference: `loadProviders()` at
`index.html:499` and `loadData()` at `library.html:469`.

```js
try {
    const res = await fetch('/api/providers');
    const providers = await res.json();
    // ...populate UI
} catch (e) {
    // surface a friendly error in the DOM
}
```

Parallel loads use `Promise.all` (`library.html:471`). POSTs send JSON with
`headers: { 'Content-Type': 'application/json' }` and read `data.error` when `!res.ok`
(`index.html:577`, `login.html:267`).

## Rendering: Template Strings, Not a VDOM

Lists are rendered by building an HTML string and assigning `innerHTML`. Cards are produced by a
`cardHtml(item)` function (`library.html:522`) and joined. There is no diffing — re-render the
whole container when data changes (`render()` at `library.html:559`).

**Every interpolated value that could contain user text MUST go through `escapeHtml`** before it
enters the HTML string — prompts, model names, provider names, URLs in attributes. `escapeHtml`
is defined at `library.html:443` / `index.html:481`. This is the primary XSS defense; see
[Quality Guidelines](./quality-guidelines.md).

## Event Handling: Delegation via `data-*`

Interactive elements carry `data-*` attributes and are handled by **one delegated listener** on a
container, not per-element handlers. The grid is the reference (`library.html:575`):

```js
grid.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const card = actionBtn.closest('[data-id]');
    const id = card.dataset.id;
    // switch on actionBtn.dataset.action: copy / hide / delete
});
```

Segmented tab/mode/filter controls follow the same `data-tab` / `data-mode` / `data-filter`
pattern with a shared `initSegmented(containerId, indicatorId)` helper (`index.html:409`) that
also repositions the active indicator on click and on `resize`. Reuse it for new segmented UIs.

## Media URLs Always Go Through The Proxy

Never point an `<img>`/`<video>` `src` at a remote provider URL directly. Wrap it with the
proxy helper so caching + SSRF gating + CORS work:

```js
function getImageProxyUrl(url) {
    if (!url) return '';
    if (url.startsWith('/api/proxy/') || url.startsWith('data:')) return url;
    return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}
```

`getImageProxyUrl` (`index.html:471`) and `getVideoProxyUrl` (`index.html:476`) already handle the
"already-proxied" and `data:` cases — use them, don't inline the concatenation.

## Anti-Patterns

- Interpolating user/server strings into `innerHTML` without `escapeHtml`.
- Attaching one listener per card/button instead of delegating on the container.
- Setting media `src` to a raw remote URL (breaks CORS/caching and bypasses SSRF gating).
- Introducing React/Vue/Alpine or a client router to "modernize" a page.
