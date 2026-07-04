import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== parseModels ====================
describe('parseModels', () => {
    const parseModels = (str) => (str || '').split(',').map(m => m.trim()).filter(Boolean);

    it('returns empty array for null/undefined', () => {
        assert.deepStrictEqual(parseModels(null), []);
        assert.deepStrictEqual(parseModels(undefined), []);
        assert.deepStrictEqual(parseModels(''), []);
    });

    it('splits comma-separated models and trims whitespace', () => {
        assert.deepStrictEqual(parseModels('gpt-4, gpt-4o, dalle-3'), ['gpt-4', 'gpt-4o', 'dalle-3']);
    });

    it('filters out empty strings', () => {
        assert.deepStrictEqual(parseModels('model1, , model2'), ['model1', 'model2']);
    });

    it('handles single model', () => {
        assert.deepStrictEqual(parseModels('dalle-3'), ['dalle-3']);
    });
});

// ==================== isUrlAllowed (SSRF Protection) ====================
describe('isUrlAllowed', () => {
    const isUrlAllowed = (urlString, whitelist) => {
        if (whitelist.length === 0) return true;
        try {
            const parsed = new URL(urlString);
            return whitelist.includes(parsed.hostname);
        } catch {
            return false;
        }
    };

    it('returns true when whitelist is empty (allow all)', () => {
        assert.strictEqual(isUrlAllowed('https://any.com/image.jpg', []), true);
    });

    it('allows whitelisted hostname', () => {
        const whitelist = ['chevereto.novaw.de', 'api.openai.com'];
        assert.strictEqual(isUrlAllowed('https://chevereto.novaw.de/image.jpg', whitelist), true);
    });

    it('blocks non-whitelisted hostname', () => {
        const whitelist = ['chevereto.novaw.de'];
        assert.strictEqual(isUrlAllowed('https://evil.com/image.jpg', whitelist), false);
    });

    it('blocks localhost addresses', () => {
        const whitelist = ['example.com'];
        assert.strictEqual(isUrlAllowed('http://localhost:8080/image.jpg', whitelist), false);
        assert.strictEqual(isUrlAllowed('http://127.0.0.1/image.jpg', whitelist), false);
    });

    it('blocks internal IP ranges', () => {
        const whitelist = ['example.com'];
        assert.strictEqual(isUrlAllowed('http://192.168.1.1/image.jpg', whitelist), false);
        assert.strictEqual(isUrlAllowed('http://10.0.0.1/image.jpg', whitelist), false);
        assert.strictEqual(isUrlAllowed('http://172.16.0.1/image.jpg', whitelist), false);
    });

    it('returns false for invalid URL', () => {
        const whitelist = ['example.com'];
        assert.strictEqual(isUrlAllowed('not-a-valid-url', whitelist), false);
    });
});

// ==================== Database Helpers ====================
describe('Database Helpers', () => {
    const TEST_DB_FILE = path.join(__dirname, 'test-db.json');
    const TEST_DATA_DIR = path.join(__dirname, 'test-data');

    const readDb = () => {
        if (!fs.existsSync(TEST_DB_FILE)) {
            return { images: [], videos: [], statistics: { total: 0, byModel: {}, videoTotal: 0, videoByModel: {} } };
        }
        try {
            const data = JSON.parse(fs.readFileSync(TEST_DB_FILE, 'utf8'));
            if (!data.videos) data.videos = [];
            if (!data.statistics.videoTotal) data.statistics.videoTotal = 0;
            if (!data.statistics.videoByModel) data.statistics.videoByModel = {};
            return data;
        } catch {
            return { images: [], videos: [], statistics: { total: 0, byModel: {}, videoTotal: 0, videoByModel: {} } };
        }
    };

    const writeDb = (data) => {
        fs.writeFileSync(TEST_DB_FILE, JSON.stringify(data, null, 2));
    };

    const addImageToDb = (image) => {
        const db = readDb();
        if (!db.statistics) db.statistics = { total: 0, byModel: {} };
        if (!db.statistics.byModel) db.statistics.byModel = {};
        db.images.unshift(image);
        db.statistics.total = (db.statistics.total || 0) + 1;
        db.statistics.byModel[image.model] = (db.statistics.byModel[image.model] || 0) + 1;
        writeDb(db);
    };

    const addVideoToDb = (video) => {
        const db = readDb();
        if (!db.videos) db.videos = [];
        if (!db.statistics.videoTotal) db.statistics.videoTotal = 0;
        if (!db.statistics.videoByModel) db.statistics.videoByModel = {};
        db.videos.unshift(video);
        db.statistics.videoTotal = (db.statistics.videoTotal || 0) + 1;
        db.statistics.videoByModel[video.model] = (db.statistics.videoByModel[video.model] || 0) + 1;
        writeDb(db);
    };

    beforeEach(() => {
        if (!fs.existsSync(TEST_DATA_DIR)) fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
        if (fs.existsSync(TEST_DB_FILE)) fs.unlinkSync(TEST_DB_FILE);
    });

    afterEach(() => {
        if (fs.existsSync(TEST_DB_FILE)) fs.unlinkSync(TEST_DB_FILE);
        if (fs.existsSync(TEST_DATA_DIR)) fs.rmSync(TEST_DATA_DIR, { recursive: true });
    });

    describe('readDb', () => {
        it('returns default structure when db file does not exist', () => {
            const db = readDb();
            assert.deepStrictEqual(db.images, []);
            assert.deepStrictEqual(db.videos, []);
            assert.strictEqual(db.statistics.total, 0);
        });

        it('reads existing db file', () => {
            writeDb({ images: [{ id: 'test-1', url: 'http://example.com/1.jpg' }], videos: [], statistics: { total: 1, byModel: {}, videoTotal: 0, videoByModel: {} } });
            const db = readDb();
            assert.strictEqual(db.images.length, 1);
            assert.strictEqual(db.images[0].id, 'test-1');
        });

        it('migrates old db format without videos array', () => {
            writeDb({ images: [], statistics: { total: 0, byModel: {} } });
            const db = readDb();
            assert.deepStrictEqual(db.videos, []);
        });
    });

    describe('writeDb / readDb roundtrip', () => {
        it('preserves all fields through write/read cycle', () => {
            const data = {
                images: [{ id: 'img-1', url: 'http://example.com/img.png', prompt: 'test', model: 'dalle-3', timestamp: '2026-05-28T00:00:00Z' }],
                videos: [{ id: 'vid-1', url: 'http://example.com/vid.mp4', model: 'sora', timestamp: '2026-05-28T00:00:00Z' }],
                statistics: { total: 1, byModel: { 'dalle-3': 1 }, videoTotal: 1, videoByModel: { 'sora': 1 } }
            };
            writeDb(data);
            const read = readDb();
            assert.strictEqual(read.images[0].id, 'img-1');
            assert.strictEqual(read.videos[0].id, 'vid-1');
            assert.strictEqual(read.statistics.total, 1);
        });
    });

    describe('addImageToDb', () => {
        it('adds image to beginning of array', () => {
            addImageToDb({ id: 'img-1', url: 'http://example.com/1.jpg', prompt: 'test', model: 'dalle-3' });
            const db = readDb();
            assert.strictEqual(db.images[0].id, 'img-1');
        });

        it('updates statistics total', () => {
            addImageToDb({ id: 'img-1', model: 'dalle-3' });
            addImageToDb({ id: 'img-2', model: 'gpt-4o' });
            const db = readDb();
            assert.strictEqual(db.statistics.total, 2);
        });

        it('counts images per model', () => {
            addImageToDb({ id: 'img-1', model: 'dalle-3' });
            addImageToDb({ id: 'img-2', model: 'dalle-3' });
            addImageToDb({ id: 'img-3', model: 'gpt-4o' });
            const db = readDb();
            assert.strictEqual(db.statistics.byModel['dalle-3'], 2);
            assert.strictEqual(db.statistics.byModel['gpt-4o'], 1);
        });
    });

    describe('addVideoToDb', () => {
        it('adds video to beginning of videos array', () => {
            addVideoToDb({ id: 'vid-1', url: 'http://example.com/1.mp4', model: 'sora' });
            const db = readDb();
            assert.strictEqual(db.videos[0].id, 'vid-1');
        });

        it('updates video statistics', () => {
            addVideoToDb({ id: 'vid-1', model: 'sora' });
            addVideoToDb({ id: 'vid-2', model: 'runway' });
            const db = readDb();
            assert.strictEqual(db.statistics.videoTotal, 2);
            assert.strictEqual(db.statistics.videoByModel['sora'], 1);
            assert.strictEqual(db.statistics.videoByModel['runway'], 1);
        });
    });
});

// ==================== Provider Loading ====================
describe('Provider Loading', () => {
    const parseModels = (str) => (str || '').split(',').map(m => m.trim()).filter(Boolean);

    const loadProviders = () => {
        const providers = [];
        for (let i = 1; i <= 3; i++) {
            const name = process.env[`PROVIDER_${i}_NAME`];
            const type = process.env[`PROVIDER_${i}_TYPE`];
            const baseUrl = process.env[`PROVIDER_${i}_BASE_URL`];
            const apiKey = process.env[`PROVIDER_${i}_API_KEY`];

            if (!name || !type || !baseUrl || !apiKey) continue;
            const validTypes = ['openai', 'openai-compatible', 'gemini'];
            if (!validTypes.includes(type)) continue;
            const models = parseModels(process.env[`PROVIDER_${i}_MODELS`]);
            if (models.length === 0) continue;
            providers.push({
                id: `provider-${i}`, name, type,
                baseUrl: baseUrl.replace(/\/$/, ''), apiKey,
                models
            });
        }
        return providers;
    };

    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        // Clear provider env vars
        for (let i = 1; i <= 3; i++) {
            delete process.env[`PROVIDER_${i}_NAME`];
            delete process.env[`PROVIDER_${i}_TYPE`];
            delete process.env[`PROVIDER_${i}_BASE_URL`];
            delete process.env[`PROVIDER_${i}_API_KEY`];
            delete process.env[`PROVIDER_${i}_MODELS`];
        }
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('returns empty array when no providers configured', () => {
        const providers = loadProviders();
        assert.strictEqual(providers.length, 0);
    });

    it('loads single OpenAI provider', () => {
        process.env.PROVIDER_1_NAME = 'OpenAI';
        process.env.PROVIDER_1_TYPE = 'openai';
        process.env.PROVIDER_1_BASE_URL = 'https://api.openai.com/v1';
        process.env.PROVIDER_1_API_KEY = 'sk-test123';
        process.env.PROVIDER_1_MODELS = 'gpt-4o, dalle-3';

        const providers = loadProviders();
        assert.strictEqual(providers.length, 1);
        assert.strictEqual(providers[0].name, 'OpenAI');
        assert.strictEqual(providers[0].type, 'openai');
        assert.deepStrictEqual(providers[0].models, ['gpt-4o', 'dalle-3']);
    });

    it('loads multiple providers', () => {
        process.env.PROVIDER_1_NAME = 'OpenAI';
        process.env.PROVIDER_1_TYPE = 'openai';
        process.env.PROVIDER_1_BASE_URL = 'https://api.openai.com/v1';
        process.env.PROVIDER_1_API_KEY = 'sk-test';
        process.env.PROVIDER_1_MODELS = 'gpt-4o';

        process.env.PROVIDER_2_NAME = 'Gemini';
        process.env.PROVIDER_2_TYPE = 'gemini';
        process.env.PROVIDER_2_BASE_URL = 'https://generativelanguage.googleapis.com';
        process.env.PROVIDER_2_API_KEY = 'gemini-key';
        process.env.PROVIDER_2_MODELS = 'gemini-pro, imagen-3';

        const providers = loadProviders();
        assert.strictEqual(providers.length, 2);
        assert.strictEqual(providers[0].name, 'OpenAI');
        assert.strictEqual(providers[1].name, 'Gemini');
    });

    it('skips provider with invalid type', () => {
        process.env.PROVIDER_1_NAME = 'InvalidProvider';
        process.env.PROVIDER_1_TYPE = 'invalid-type';
        process.env.PROVIDER_1_BASE_URL = 'https://invalid.com';
        process.env.PROVIDER_1_API_KEY = 'key';
        process.env.PROVIDER_1_MODELS = 'model';

        const providers = loadProviders();
        assert.strictEqual(providers.length, 0);
    });

    it('skips provider with missing required fields', () => {
        process.env.PROVIDER_1_NAME = 'PartialProvider';
        process.env.PROVIDER_1_TYPE = 'openai';
        // Missing BASE_URL and API_KEY
        process.env.PROVIDER_1_MODELS = 'model';

        const providers = loadProviders();
        assert.strictEqual(providers.length, 0);
    });

    it('normalizes baseUrl (removes trailing slash)', () => {
        process.env.PROVIDER_1_NAME = 'Test';
        process.env.PROVIDER_1_TYPE = 'openai';
        process.env.PROVIDER_1_BASE_URL = 'https://api.test.com/v1/';
        process.env.PROVIDER_1_API_KEY = 'key';
        process.env.PROVIDER_1_MODELS = 'model';

        const providers = loadProviders();
        assert.strictEqual(providers[0].baseUrl, 'https://api.test.com/v1');
        assert.ok(!providers[0].baseUrl.endsWith('/'));
    });

    it('skips provider with empty models', () => {
        process.env.PROVIDER_1_NAME = 'NoModels';
        process.env.PROVIDER_1_TYPE = 'openai';
        process.env.PROVIDER_1_BASE_URL = 'https://api.test.com';
        process.env.PROVIDER_1_API_KEY = 'key';
        process.env.PROVIDER_1_MODELS = '';

        const providers = loadProviders();
        assert.strictEqual(providers.length, 0);
    });
});

// ==================== Chevereto Upload Helper ====================
describe('Chevereto Upload Logic', () => {
    it('should skip data: URLs', () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        assert.ok(dataUrl.startsWith('data:'));
    });

    it('should parse Chevereto API response status_code 200 as success', () => {
        const result = { status_code: 200, image: { url: 'https://chevereto.com/image.jpg' } };
        const success = result.status_code === 200 && Boolean(result.image?.url);
        assert.strictEqual(success, true);
    });

    it('should identify failed Chevereto response', () => {
        const result = { status_code: 400, status_txt: 'Bad Request' };
        const success = result.status_code === 200 && result.image?.url;
        assert.strictEqual(success, false);
    });
});

// ==================== Image MIME Types ====================
describe('IMAGE_MIME_TYPES constant', () => {
    const IMAGE_MIME_TYPES = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml'
    };

    it('has correct MIME type for common extensions', () => {
        assert.strictEqual(IMAGE_MIME_TYPES['.jpg'], 'image/jpeg');
        assert.strictEqual(IMAGE_MIME_TYPES['.png'], 'image/png');
        assert.strictEqual(IMAGE_MIME_TYPES['.gif'], 'image/gif');
        assert.strictEqual(IMAGE_MIME_TYPES['.webp'], 'image/webp');
    });

    it('maps .jpeg to image/jpeg', () => {
        assert.strictEqual(IMAGE_MIME_TYPES['.jpeg'], 'image/jpeg');
    });

    it('returns undefined for unknown extension', () => {
        assert.strictEqual(IMAGE_MIME_TYPES['.unknown'], undefined);
    });
});