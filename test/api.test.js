import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'api-test-db.json');

// Configure env BEFORE importing app.js — the module reads these at load time.
process.env.DB_FILE = TEST_DB;
process.env.IMAGE_PROXY_WHITELIST = 'allowed.example.com';
process.env.PROVIDER_1_NAME = 'TestOpenAI';
process.env.PROVIDER_1_TYPE = 'openai';
process.env.PROVIDER_1_BASE_URL = 'https://api.test.com/v1';
process.env.PROVIDER_1_API_KEY = 'sk-test';
process.env.PROVIDER_1_MODELS = 'model-a, model-b';
delete process.env.AUTH_PASSWORD;

const { app, addImageToDb, addVideoToDb, readDb, writeDb } = await import('../app.js');

let server, base;

function resetDb() {
    writeDb({ images: [], videos: [], statistics: { total: 0, byModel: {}, videoTotal: 0, videoByModel: {} } });
}

before(async () => {
    resetDb();
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});

after(() => {
    if (server) server.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

// ==================== DB helpers against the REAL app.js code ====================
describe('Statistics persistence (real addImageToDb/addVideoToDb)', () => {
    it('persists image statistics to disk, not just memory', () => {
        resetDb();
        addImageToDb({ id: 'i1', model: 'dalle-3', url: 'http://x/1.png' });
        addImageToDb({ id: 'i2', model: 'dalle-3', url: 'http://x/2.png' });
        addImageToDb({ id: 'i3', model: 'gpt-image-1', url: 'http://x/3.png' });
        const db = readDb(); // re-read from disk
        assert.strictEqual(db.images.length, 3);
        assert.strictEqual(db.statistics.total, 3);
        assert.strictEqual(db.statistics.byModel['dalle-3'], 2);
        assert.strictEqual(db.statistics.byModel['gpt-image-1'], 1);
    });

    it('persists video statistics to disk', () => {
        resetDb();
        addVideoToDb({ id: 'v1', model: 'sora', url: 'http://x/1.mp4' });
        addVideoToDb({ id: 'v2', model: 'sora', url: 'http://x/2.mp4' });
        const db = readDb();
        assert.strictEqual(db.statistics.videoTotal, 2);
        assert.strictEqual(db.statistics.videoByModel['sora'], 2);
    });
});

// ==================== HTTP endpoints ====================
describe('GET /health', () => {
    it('returns healthy status with provider count', async () => {
        const res = await fetch(`${base}/health`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.status, 'healthy');
        assert.strictEqual(body.providers, 1);
    });
});

describe('GET /api/providers', () => {
    it('returns providers without grok2api-era fields', async () => {
        const res = await fetch(`${base}/api/providers`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.length, 1);
        assert.deepStrictEqual(body[0].models, ['model-a', 'model-b']);
        assert.ok(!('imageModels' in body[0]), 'imageModels should be removed');
        assert.ok(!('imageEditModels' in body[0]), 'imageEditModels should be removed');
        assert.ok(!('videoModels' in body[0]), 'videoModels should be removed');
    });
});

describe('POST /api/generate validation', () => {
    it('rejects missing provider (400)', async () => {
        const res = await fetch(`${base}/api/generate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'model-a', prompt: 'hi' })
        });
        assert.strictEqual(res.status, 400);
    });

    it('rejects unknown model (400)', async () => {
        const res = await fetch(`${base}/api/generate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'provider-1', model: 'no-such-model', prompt: 'hi' })
        });
        assert.strictEqual(res.status, 400);
    });
});

describe('POST /api/images/manual', () => {
    before(resetDb);

    it('rejects missing fields (400)', async () => {
        const res = await fetch(`${base}/api/images/manual`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://allowed.example.com/a.jpg' })
        });
        assert.strictEqual(res.status, 400);
    });

    it('rejects non-whitelisted domain (403)', async () => {
        const res = await fetch(`${base}/api/images/manual`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://evil.com/a.jpg', prompt: 'p' })
        });
        assert.strictEqual(res.status, 403);
    });

    it('accepts a whitelisted image and lists it', async () => {
        const res = await fetch(`${base}/api/images/manual`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://allowed.example.com/a.jpg', prompt: 'hello', model: 'm' })
        });
        assert.strictEqual(res.status, 200);
        const rec = await res.json();
        assert.strictEqual(rec.source, 'manual');
        const list = await (await fetch(`${base}/api/images`)).json();
        assert.ok(list.find(i => i.id === rec.id), 'manual image should appear in list');
    });
});

describe('Image hide/unhide/delete lifecycle', () => {
    let id;
    before(async () => {
        resetDb();
        const res = await fetch(`${base}/api/images/manual`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://allowed.example.com/b.jpg', prompt: 'x' })
        });
        id = (await res.json()).id;
    });

    it('hides the image', async () => {
        const res = await fetch(`${base}/api/images/${id}/hide`, { method: 'PATCH' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(readDb().images.find(i => i.id === id).hidden, true);
    });

    it('unhides the image', async () => {
        const res = await fetch(`${base}/api/images/${id}/unhide`, { method: 'PATCH' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(readDb().images.find(i => i.id === id).hidden, false);
    });

    it('deletes the image', async () => {
        const res = await fetch(`${base}/api/images/${id}`, { method: 'DELETE' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(readDb().images.find(i => i.id === id), undefined);
    });

    it('returns 404 for unknown id', async () => {
        const res = await fetch(`${base}/api/images/does-not-exist/hide`, { method: 'PATCH' });
        assert.strictEqual(res.status, 404);
    });
});

describe('SSRF proxy validation', () => {
    it('image proxy blocks non-whitelisted domain (403)', async () => {
        const res = await fetch(`${base}/api/proxy/image?url=${encodeURIComponent('https://evil.com/x.jpg')}`);
        assert.strictEqual(res.status, 403);
    });

    it('image proxy returns 400 on missing url', async () => {
        const res = await fetch(`${base}/api/proxy/image`);
        assert.strictEqual(res.status, 400);
    });

    it('video proxy blocks non-whitelisted domain (403)', async () => {
        const res = await fetch(`${base}/api/proxy/video?url=${encodeURIComponent('https://evil.com/x.mp4')}`);
        assert.strictEqual(res.status, 403);
    });
});
