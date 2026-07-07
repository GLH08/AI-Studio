# Database Guidelines

> Persistence is a single JSON file. There is **no ORM, no SQL, and no migrations**.

---

## Overview

State lives in `data/db.json` (path overridable via `DB_FILE`, used by tests for isolation).
The shape is fixed:

```json
{
  "images": [ /* newest first */ ],
  "videos": [ /* newest first */ ],
  "statistics": { "total": 0, "byModel": {}, "videoTotal": 0, "videoByModel": {} }
}
```

All access goes through the helpers in the Database Helpers section (`app.js:210`). Do not read
or write `db.json` directly anywhere else.

## In-Memory Cache (write-through)

The DB is cached in a module-level `dbCache`. `readDb()` serves from memory (loading + normalizing
once on first call); `writeDb()` persists atomically **and** updates `dbCache`, so memory and disk
never diverge after a successful write. This means list/stats/mutation endpoints never re-parse the
whole file per request. Invariants to preserve:

- **The single write path is `writeDb`.** Anything that mutates state must persist through it (or
  through `addImageToDb`/`addVideoToDb`, which call it) — otherwise the cache goes stale.
- Do not mutate the object returned by `readDb()` without following up with `writeDb()`.
- `__resetDbCache()` (`app.js`) exists only for tests that write `db.json` on disk directly and
  need the next `readDb` to re-read.

## Accessors

- `readDb()` (`app.js:212`) — returns the cached DB. On first load: a **missing** file yields a
  fresh empty structure, but a **corrupt/unparseable existing** file makes it **throw** (loud) —
  it must never return an empty DB that a following `writeDb` would persist over real data (that
  was a data-loss bug). It back-fills newer/missing fields (`videos`, and a missing `statistics`
  object and its counters) so older DB files keep working — the project's substitute for migrations.
- `writeDb(data)` (`app.js:227`) — **atomic**: serializes to `db.json.tmp`, then `rename`s over
  the target so an interrupted write can never leave a half-written file; then updates `dbCache`.
  Always persist through this; never `fs.writeFileSync(DB_FILE, ...)` directly.
- `addImageToDb(image)` / `addVideoToDb(video)` — the **only** way to insert. They `unshift`
  (newest first), bump the matching statistics counters, then `writeDb`. They wrap everything in
  try/catch and log on failure rather than throwing, so a persistence error never crashes a request.
- `makeDeleteHandler` / `makeHideHandler` — shared factories generate the images & videos
  delete/hide/unhide route handlers from one implementation (`collection` = `images` | `videos`).

## Read-Modify-Write Pattern

Mutations (delete, hide/unhide) follow one pattern — read the whole DB, mutate the array in
memory, write it back:

```js
const db = readDb();
const item = (db[collection] || []).find(i => i.id === id);
if (!item) return res.status(404).json({ error: `${label} not found` });
item.hidden = hidden;
writeDb(db);
```

This lives in the shared `makeHideHandler` / `makeDeleteHandler` factories. Delete uses
`filter` + length comparison to detect a missing id and return 404.

## Records

- IDs are generated inline as `'<prefix>-' + Date.now() + '-' + Math.random().toString(36).substr(2,9)`
  (prefixes: `gen-`, `gen-vid-`, `manual-`, `video-t2v-`, `video-i2v-`). Keep the prefix meaningful.
- Every record carries `timestamp` (ISO string), `hidden: false`, and a `source` (`generated` / `manual`).
- New fields must be added to the record object **and** back-filled in `readDb()` if list/stats endpoints assume they exist.

## Concurrency Caveat

This is a last-writer-wins store with no locking. Two writes that interleave read-modify-write
can lose data. That is an accepted tradeoff for a single-user tool — do **not** add a database
engine to "fix" it without an explicit requirement. If you add a hot write path, keep the
read-modify-write window as small as possible.

## Anti-Patterns

- Bypassing `writeDb` / `addImageToDb` / `addVideoToDb` and touching `db.json` directly (also goes stale vs `dbCache`).
- Making `readDb` return an empty DB on a corrupt existing file — it must **throw** so a following write can't overwrite real data. (A *missing* file → empty DB is fine.)
- Mutating the object from `readDb()` without calling `writeDb()` (leaves the cache/disk inconsistent).
- Adding a stats counter without updating both the `add*` helper and the back-fill in `readDb`.
