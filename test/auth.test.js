import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'auth-test-db.json');
const PASSWORD = 'super-secret-pw';

// Enable auth BEFORE importing app.js (read at load time).
process.env.DB_FILE = TEST_DB;
process.env.AUTH_PASSWORD = PASSWORD;

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

async function login(password) {
    return fetch(`${base}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
}

describe('Authentication (AUTH_PASSWORD enabled)', () => {
    it('blocks API requests without a cookie (401)', async () => {
        const res = await fetch(`${base}/api/images`);
        assert.strictEqual(res.status, 401);
    });

    it('rejects a wrong password (401)', async () => {
        const res = await login('wrong');
        assert.strictEqual(res.status, 401);
    });

    it('does NOT store the plaintext password in the cookie', async () => {
        const res = await login(PASSWORD);
        assert.strictEqual(res.status, 200);
        const setCookie = res.headers.get('set-cookie') || '';
        assert.ok(setCookie.includes('auth='), 'sets an auth cookie');
        assert.ok(!setCookie.includes(PASSWORD), 'cookie must not contain the plaintext password');
        assert.ok(/HttpOnly/i.test(setCookie), 'cookie is HttpOnly');
    });

    it('grants access with the signed cookie issued at login', async () => {
        const loginRes = await login(PASSWORD);
        const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0]; // auth=<token>
        const res = await fetch(`${base}/api/images`, { headers: { Cookie: cookie } });
        assert.strictEqual(res.status, 200);
    });

    it('rejects the legacy plaintext-password cookie (old scheme no longer valid)', async () => {
        const res = await fetch(`${base}/api/images`, { headers: { Cookie: `auth=${PASSWORD}` } });
        assert.strictEqual(res.status, 401);
    });

    it('serves /assets without auth (the login page needs its CSS/fonts)', async () => {
        const res = await fetch(`${base}/assets/tailwind.css`);
        assert.strictEqual(res.status, 200);
    });
});
