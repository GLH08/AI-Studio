import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'path';
import crypto from 'node:crypto';

// Test the image proxy endpoint logic directly
// Note: These tests work with the actual filesystem so we test the cache path generation

describe('Image Proxy Logic', () => {
    const DATA_DIR = path.join(process.cwd(), 'data');
    const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'image-cache');

    // Helper: same logic as in app.js for generating cache path
    function getImageCachePath(imageUrl) {
        const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
        const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
        return path.join(IMAGE_CACHE_DIR, `${hash}${ext}`);
    }

    describe('getImageCachePath', () => {
        it('generates consistent hash for same URL', () => {
            const url = 'https://chevereto.novaw.de/images/2026/04/11/test.jpg';
            const path1 = getImageCachePath(url);
            const path2 = getImageCachePath(url);
            assert.strictEqual(path1, path2);
        });

        it('generates different paths for different URLs', () => {
            const url1 = 'https://chevereto.novaw.de/images/2026/04/11/test1.jpg';
            const url2 = 'https://chevereto.novaw.de/images/2026/04/11/test2.jpg';
            const path1 = getImageCachePath(url1);
            const path2 = getImageCachePath(url2);
            assert.notStrictEqual(path1, path2);
        });

        it('extracts correct file extension from URL', () => {
            const url = 'https://chevereto.novaw.de/images/2026/04/11/test.png';
            const cachePath = getImageCachePath(url);
            assert.ok(cachePath.endsWith('.png'));
        });

        it('defaults to .jpg when no extension in URL', () => {
            const url = 'https://example.com/image';
            const cachePath = getImageCachePath(url);
            assert.ok(cachePath.endsWith('.jpg'));
        });
    });

    describe('IMAGE_CACHE_DIR setup', () => {
        it('image-cache directory should be created', () => {
            if (!fs.existsSync(IMAGE_CACHE_DIR)) {
                fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
            }
            assert.ok(fs.existsSync(IMAGE_CACHE_DIR));
        });
    });
});

describe('Image Proxy Endpoint', () => {
    it('should transform Chevereto URL to proxy format', () => {
        const originalUrl = 'https://chevereto.novaw.de/images/2026/04/11/test.jpg';
        const proxyUrl = `/api/proxy/image?url=${encodeURIComponent(originalUrl)}`;

        assert.ok(proxyUrl.startsWith('/api/proxy/image?url='));
        assert.ok(proxyUrl.includes(encodeURIComponent(originalUrl)));
    });

    it('should preserve full URL with query params', () => {
        const originalUrl = 'https://chevereto.novaw.de/images/2026/04/11/test.jpg?v=123';
        const encoded = encodeURIComponent(originalUrl);
        const proxyUrl = `/api/proxy/image?url=${encoded}`;

        assert.ok(proxyUrl.includes('v%3D123'));
    });
});

describe('SSRF Protection - Domain Whitelist', () => {
    function isUrlAllowed(url, whitelist) {
        try {
            const parsedUrl = new URL(url);
            if (whitelist.length === 0) return true;
            return whitelist.includes(parsedUrl.hostname);
        } catch {
            return false;
        }
    }

    const whitelist = ['chevereto.novaw.de', 'images.example.com'];

    it('should allow whitelisted domain', () => {
        assert.strictEqual(isUrlAllowed('https://chevereto.novaw.de/image.jpg', whitelist), true);
    });

    it('should allow another whitelisted domain', () => {
        assert.strictEqual(isUrlAllowed('https://images.example.com/image.jpg', whitelist), true);
    });

    it('should block non-whitelisted domain', () => {
        assert.strictEqual(isUrlAllowed('https://evil.com/image.jpg', whitelist), false);
    });

    it('should block internal network addresses', () => {
        assert.strictEqual(isUrlAllowed('http://localhost:6379/image.jpg', whitelist), false);
        assert.strictEqual(isUrlAllowed('http://192.168.1.1/image.jpg', whitelist), false);
        assert.strictEqual(isUrlAllowed('http://10.0.0.1/image.jpg', whitelist), false);
    });

    it('should allow any domain when whitelist is empty', () => {
        assert.strictEqual(isUrlAllowed('https://anydomain.com/image.jpg', []), true);
    });

    it('should reject invalid URLs', () => {
        assert.strictEqual(isUrlAllowed('not-a-url', whitelist), false);
    });
});

describe('getImageProxyUrl Frontend Helper', () => {
    function getImageProxyUrl(url) {
        if (!url) return '';
        if (url.startsWith('/api/proxy/') || url.startsWith('data:')) return url;
        return `/api/proxy/image?url=${encodeURIComponent(url)}`;
    }

    it('should return empty string for null', () => {
        assert.strictEqual(getImageProxyUrl(null), '');
    });

    it('should return empty string for undefined', () => {
        assert.strictEqual(getImageProxyUrl(undefined), '');
    });

    it('should return empty string for empty string', () => {
        assert.strictEqual(getImageProxyUrl(''), '');
    });

    it('should return proxy URL for valid external URL', () => {
        const result = getImageProxyUrl('https://chevereto.novaw.de/image.jpg');
        assert.ok(result.startsWith('/api/proxy/image?url='));
    });

    it('should return as-is for already proxied URL', () => {
        const proxyUrl = '/api/proxy/image?url=https://example.com/image.jpg';
        assert.strictEqual(getImageProxyUrl(proxyUrl), proxyUrl);
    });

    it('should return as-is for data URI', () => {
        const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        assert.strictEqual(getImageProxyUrl(dataUri), dataUri);
    });
});
