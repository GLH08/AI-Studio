import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'db-guard-test-db.json');

process.env.DB_FILE = TEST_DB;
delete process.env.AUTH_PASSWORD;

const { readDb, addImageToDb, __resetDbCache } = await import('../app.js');

beforeEach(() => {
    __resetDbCache();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

after(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe('readDb robustness (R4: never silently wipe existing data)', () => {
    it('reads a statistics-less db without wiping and back-fills statistics', () => {
        fs.writeFileSync(TEST_DB, JSON.stringify({ images: [{ id: 'x1', model: 'm' }], videos: [] }));
        __resetDbCache();
        const db = readDb();
        assert.strictEqual(db.images.length, 1);
        assert.strictEqual(db.images[0].id, 'x1');
        assert.ok(db.statistics && typeof db.statistics.total === 'number');
        assert.ok(db.statistics.byModel && typeof db.statistics.videoTotal === 'number');
    });

    it('a following write preserves the existing records (no destructive overwrite)', () => {
        fs.writeFileSync(TEST_DB, JSON.stringify({ images: [{ id: 'x1', model: 'm' }], videos: [] }));
        __resetDbCache();
        addImageToDb({ id: 'x2', model: 'm' });
        const onDisk = JSON.parse(fs.readFileSync(TEST_DB, 'utf8'));
        assert.strictEqual(onDisk.images.length, 2);
        assert.ok(onDisk.images.find(i => i.id === 'x1'), 'original record must survive');
        assert.ok(onDisk.images.find(i => i.id === 'x2'), 'new record must be added');
    });

    it('throws on a corrupt db file instead of returning an empty DB', () => {
        fs.writeFileSync(TEST_DB, '{ not valid json ');
        __resetDbCache();
        assert.throws(() => readDb());
    });

    it('returns a fresh empty DB when the file does not exist', () => {
        __resetDbCache();
        const db = readDb();
        assert.deepStrictEqual(db.images, []);
        assert.deepStrictEqual(db.videos, []);
        assert.strictEqual(db.statistics.total, 0);
    });
});

describe('in-memory cache write-through (R11)', () => {
    it('serves reads from cache and stays consistent after a write', () => {
        __resetDbCache();
        addImageToDb({ id: 'c1', model: 'm' });
        // A second read without touching disk returns the cached, updated object.
        assert.strictEqual(readDb().images[0].id, 'c1');
        // And it matches what was persisted atomically.
        const onDisk = JSON.parse(fs.readFileSync(TEST_DB, 'utf8'));
        assert.strictEqual(onDisk.images[0].id, 'c1');
    });
});
