import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'ratelimit-test-db.json');

// Enable auth + a low login limit BEFORE importing app.js.
process.env.DB_FILE = TEST_DB;
process.env.AUTH_PASSWORD = 'pw';
process.env.LOGIN_RATE_LIMIT_MAX = '2';

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

describe('Login rate limiting', () => {
    it('returns 429 after exceeding LOGIN_RATE_LIMIT_MAX attempts', async () => {
        const attempt = () => fetch(`${base}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'wrong' })
        });
        const r1 = await attempt(); // allowed (invalid password)
        const r2 = await attempt(); // allowed (invalid password)
        const r3 = await attempt(); // blocked by the limiter
        assert.strictEqual(r1.status, 401);
        assert.strictEqual(r2.status, 401);
        assert.strictEqual(r3.status, 429);
    });
});
