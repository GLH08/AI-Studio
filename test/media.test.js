import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'media-test-db.json');

// --- Stub upstream: captures the image body and drives video polling behavior ---
let capturedImageBody = null;
let videoReady = true; // when false, /videos/{id} stays "pending" (drives timeout test)

const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url.endsWith('/images/generations')) {
            capturedImageBody = JSON.parse(body || '{}');
            res.end(JSON.stringify({ data: [{ url: 'http://stub.local/openai.png' }] }));
        } else if (req.url.endsWith('/videos/generations')) {
            res.end(JSON.stringify({ request_id: 'vid-123' }));
        } else if (req.url.includes('/videos/')) {
            res.end(videoReady
                ? JSON.stringify({ status: 'completed', url: 'http://stub.local/out.mp4' })
                : JSON.stringify({ status: 'pending' }));
        } else {
            res.statusCode = 404;
            res.end('{}');
        }
    });
});
await new Promise(resolve => stub.listen(0, resolve));
const stubPort = stub.address().port;

// Configure BEFORE importing app.js. Poll interval kept tiny so tests are fast.
process.env.DB_FILE = TEST_DB;
process.env.VIDEO_POLL_INTERVAL_MS = '20';
delete process.env.AUTH_PASSWORD;
process.env.PROVIDER_1_NAME = 'StubGrok';
process.env.PROVIDER_1_TYPE = 'openai';
process.env.PROVIDER_1_BASE_URL = `http://localhost:${stubPort}/v1`;
process.env.PROVIDER_1_API_KEY = 'k1';
process.env.PROVIDER_1_MODELS = 'grok-imagine-image-quality, grok-imagine-video';

const { app, readDb, writeDb } = await import('../app.js');

let server, base;

before(async () => {
    writeDb({ images: [], videos: [], statistics: { total: 0, byModel: {}, videoTotal: 0, videoByModel: {} } });
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});

after(() => {
    if (server) server.close();
    stub.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe('POST /api/generate params passthrough', () => {
    it('forwards arbitrary params (aspect_ratio, resolution) to the upstream body', async () => {
        capturedImageBody = null;
        const res = await fetch(`${base}/api/generate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'provider-1', model: 'grok-imagine-image-quality', prompt: 'a cat',
                params: { aspect_ratio: '16:9', resolution: '2k' }
            })
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(capturedImageBody.aspect_ratio, '16:9');
        assert.strictEqual(capturedImageBody.resolution, '2k');
        assert.strictEqual(capturedImageBody.model, 'grok-imagine-image-quality');
        assert.strictEqual(capturedImageBody.prompt, 'a cat');
    });

    it('never lets params override model/prompt routing', async () => {
        capturedImageBody = null;
        await fetch(`${base}/api/generate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'provider-1', model: 'grok-imagine-image-quality', prompt: 'real prompt',
                params: { model: 'evil', prompt: 'evil', aspect_ratio: '1:1' }
            })
        });
        assert.strictEqual(capturedImageBody.model, 'grok-imagine-image-quality');
        assert.strictEqual(capturedImageBody.prompt, 'real prompt');
    });
});

describe('POST /api/generate/video (async polling)', () => {
    it('generates a video via request_id + polling and persists it', async () => {
        videoReady = true;
        const res = await fetch(`${base}/api/generate/video`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'provider-1', model: 'grok-imagine-video', prompt: 'a blooming flower',
                params: { aspect_ratio: '16:9', resolution: '720p', duration: 10 }
            })
        });
        assert.strictEqual(res.status, 200);
        const rec = await res.json();
        assert.strictEqual(rec.url, 'http://stub.local/out.mp4');
        assert.strictEqual(rec.type, 'text-to-video');
        assert.strictEqual(rec.source, 'generated');
        const db = readDb();
        assert.ok(db.videos.find(v => v.id === rec.id), 'video should be persisted');
    });

    it('returns 504 with request_id when polling times out', async () => {
        videoReady = false;
        process.env.VIDEO_POLL_TIMEOUT_MS = '80'; // shorter than a couple of poll intervals
        const res = await fetch(`${base}/api/generate/video`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'provider-1', model: 'grok-imagine-video', prompt: 'slow' })
        });
        assert.strictEqual(res.status, 504);
        const body = await res.json();
        assert.strictEqual(body.request_id, 'vid-123');
        delete process.env.VIDEO_POLL_TIMEOUT_MS;
        videoReady = true;
    });

    it('validates provider/model/prompt like /api/generate', async () => {
        const res = await fetch(`${base}/api/generate/video`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'provider-1', model: 'no-such', prompt: 'x' })
        });
        assert.strictEqual(res.status, 400);
    });
});
