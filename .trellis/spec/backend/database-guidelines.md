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

All access goes through four helpers in the Database Helpers section (`app.js:210`). Do not read
or write `db.json` directly anywhere else.

## Accessors

- `readDb()` (`app.js:212`) — returns the parsed DB, or a fresh empty structure if the file is
  missing **or unparseable** (it never throws). It also back-fills newer fields (`videos`,
  `videoTotal`, `videoByModel`) so older DB files keep working. This is the project's substitute
  for migrations: tolerate old shapes on read.
- `writeDb(data)` (`app.js:227`) — **atomic**: serializes to `db.json.tmp`, then `rename`s over
  the target so an interrupted write can never leave a half-written file. Always persist through
  this; never `fs.writeFileSync(DB_FILE, ...)` directly.
- `addImageToDb(image)` / `addVideoToDb(video)` (`app.js:235`, `255`) — the **only** way to
  insert. They `unshift` (newest first), bump the matching statistics counters, then `writeDb`.
  They wrap everything in try/catch and log on failure rather than throwing, so a persistence
  error never crashes a request.

## Read-Modify-Write Pattern

Mutations (delete, hide/unhide) follow one pattern — read the whole DB, mutate the array in
memory, write it back:

```js
const db = readDb();
const image = db.images.find(img => img.id === id);
if (!image) return res.status(404).json({ error: 'Image not found' });
image.hidden = true;
writeDb(db);
```

See `app.js:862` (delete) and `app.js:874` (hide) for the canonical shape. Delete uses
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

- Bypassing `writeDb` / `addImageToDb` / `addVideoToDb` and touching `db.json` directly.
- Letting `readDb` throw on a corrupt file — it must degrade to an empty DB.
- Adding a stats counter without updating both the `add*` helper and the back-fill in `readDb`.
