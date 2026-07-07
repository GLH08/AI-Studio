import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'ssrf-test-db.json');

// A whitelist that opts 127.0.0.1 back in — so the redirect test can start from a
// local stub, then prove the redirect TARGET (metadata IP) is still blocked.
process.env.DB_FILE = TEST_DB;
process.env.IMAGE_PROXY_WHITELIST = '127.0.0.1';
delete process.env.AUTH_PASSWORD;

const { app, isUrlAllowed, isPrivateHost } = await import('../app.js');

describe('isPrivateHost', () => {
    for (const h of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', 'localhost', '::1']) {
        it(`flags ${h} as private`, () => assert.strictEqual(isPrivateHost(h), true));
    }
    for (const h of ['8.8.8.8', 'example.com', '172.32.0.1', 'chevereto.novaw.de']) {
        it(`treats ${h} as public`, () => assert.strictEqual(isPrivateHost(h), false));
    }
});

describe('isUrlAllowed blocks private targets even with an empty whitelist', () => {
    it('blocks the cloud-metadata IP', () => assert.strictEqual(isUrlAllowed('http://169.254.169.254/latest/meta-data/', []), false));
    it('blocks localhost', () => assert.strictEqual(isUrlAllowed('http://localhost:6379/', []), false));
    it('blocks 127.0.0.1', () => assert.strictEqual(isUrlAllowed('http://127.0.0.1/x', []), false));
    it('allows a public host', () => assert.strictEqual(isUrlAllowed('https://example.com/a.jpg', []), true));
    it('rejects a non-http(s) scheme', () => assert.strictEqual(isUrlAllowed('file:///etc/passwd', []), false));
    it('lets an explicit whitelist entry opt a private host back in', () => assert.strictEqual(isUrlAllowed('http://127.0.0.1/x', ['127.0.0.1']), true));
});

describe('image proxy re-validates redirects (SSRF)', () => {
    let stub, stubBase, server, base;
    before(async () => {
        // Whitelisted local host that always 302-redirects to the metadata IP.
        stub = http.createServer((req, res) => {
            res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
            res.end();
        });
        await new Promise(r => stub.listen(0, '127.0.0.1', r));
        stubBase = `http://127.0.0.1:${stub.address().port}`;
        await new Promise(r => { server = app.listen(0, r); });
        base = `http://localhost:${server.address().port}`;
    });
    after(() => {
        if (server) server.close();
        if (stub) stub.close();
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    });

    it('blocks a whitelisted host that redirects to an internal IP (403)', async () => {
        const target = `${stubBase}/redirect.jpg`;
        const res = await fetch(`${base}/api/proxy/image?url=${encodeURIComponent(target)}`);
        assert.strictEqual(res.status, 403);
    });
});
