import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'apilimit-test-db.json');

// Drive the GLOBAL /api limiter off env (R3). Set BEFORE importing app.js.
process.env.DB_FILE = TEST_DB;
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX_REQUESTS = '3';
delete process.env.AUTH_PASSWORD;

const { app } = await import('../app.js');

let server, base;

before(async () => {
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});

after(() => {
    if (server) server.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe('Global API rate limiting honors RATE_LIMIT_MAX_REQUESTS', () => {
    it('returns 429 once the configured max is exceeded', async () => {
        const codes = [];
        for (let i = 0; i < 4; i++) {
            const res = await fetch(`${base}/api/providers`);
            codes.push(res.status);
        }
        assert.strictEqual(codes[0], 200);
        assert.strictEqual(codes[3], 429, `expected the 4th request to be limited, got ${codes.join(',')}`);
    });
});
