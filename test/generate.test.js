import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'generate-test-db.json');

// --- Stub upstream provider server (mimics OpenAI / compatible / Gemini) ---
const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url.endsWith('/images/generations')) {
            res.end(JSON.stringify({ data: [{ url: 'http://stub.local/openai.png' }] }));
        } else if (req.url.endsWith('/chat/completions')) {
            res.end(JSON.stringify({ choices: [{ message: { content: 'Here you go: ![img](http://stub.local/compat.png)' } }] }));
        } else if (req.url.includes(':generateContent')) {
            res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } }] }));
        } else {
            res.statusCode = 404;
            res.end('{}');
        }
    });
});
await new Promise(resolve => stub.listen(0, resolve));
const stubPort = stub.address().port;

// Point three providers (one per type) at the stub — set BEFORE importing app.js.
process.env.DB_FILE = TEST_DB;
delete process.env.AUTH_PASSWORD;
process.env.PROVIDER_1_NAME = 'StubOpenAI';
process.env.PROVIDER_1_TYPE = 'openai';
process.env.PROVIDER_1_BASE_URL = `http://localhost:${stubPort}/v1`;
process.env.PROVIDER_1_API_KEY = 'k1';
process.env.PROVIDER_1_MODELS = 'm-openai';
process.env.PROVIDER_2_NAME = 'StubCompat';
process.env.PROVIDER_2_TYPE = 'openai-compatible';
process.env.PROVIDER_2_BASE_URL = `http://localhost:${stubPort}/v1`;
process.env.PROVIDER_2_API_KEY = 'k2';
process.env.PROVIDER_2_MODELS = 'm-compat';
process.env.PROVIDER_3_NAME = 'StubGemini';
process.env.PROVIDER_3_TYPE = 'gemini';
process.env.PROVIDER_3_BASE_URL = `http://localhost:${stubPort}/v1beta`;
process.env.PROVIDER_3_API_KEY = 'k3';
process.env.PROVIDER_3_MODELS = 'm-gemini';

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

function generate(provider, model) {
    return fetch(`${base}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, prompt: 'a cat' })
    });
}

describe('POST /api/generate happy path (stubbed upstreams)', () => {
    it('openai adapter returns the image url', async () => {
        const res = await generate('provider-1', 'm-openai');
        assert.strictEqual(res.status, 200);
        const rec = await res.json();
        assert.strictEqual(rec.url, 'http://stub.local/openai.png');
        assert.strictEqual(rec.model, 'm-openai');
    });

    it('openai-compatible adapter extracts the markdown image url', async () => {
        const res = await generate('provider-2', 'm-compat');
        assert.strictEqual(res.status, 200);
        const rec = await res.json();
        assert.strictEqual(rec.url, 'http://stub.local/compat.png');
    });

    it('gemini adapter returns the inline base64 image', async () => {
        const res = await generate('provider-3', 'm-gemini');
        assert.strictEqual(res.status, 200);
        const rec = await res.json();
        assert.ok(rec.url.startsWith('data:image/png;base64,'), 'expected a data: URL');
    });

    it('persists generated images and statistics', async () => {
        const db = readDb();
        assert.ok(db.images.length >= 3, 'expected >= 3 images persisted');
        assert.ok(db.statistics.total >= 3, 'expected statistics.total >= 3');
    });
});
