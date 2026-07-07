import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import morgan from 'morgan';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// True only when run directly (node app.js); false when imported by tests
const isMainModule = process.argv[1] === __filename;

const app = express();
// Behind a reverse proxy (nginx/Cloudflare): trust the first hop so req.ip is the
// real client IP for rate limiting. Override with TRUST_PROXY (0 = direct exposure).
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
const PORT = process.env.PORT || 8787;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
// Signed token stored in the auth cookie instead of the plaintext password.
// Deterministic (keyed by the password) so 30-day sessions survive restarts,
// while the password itself is never written to a cookie.
const AUTH_TOKEN = AUTH_PASSWORD
    ? crypto.createHmac('sha256', AUTH_PASSWORD).update('ai-studio-auth-v1').digest('hex')
    : null;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'db.json');

// Constant-time string comparison (guards against timing attacks; safe on unequal lengths)
function timingSafeEqualStr(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Image proxy whitelist (comma-separated domains)
const IMAGE_PROXY_WHITELIST = (process.env.IMAGE_PROXY_WHITELIST || '').split(',').map(d => d.trim()).filter(Boolean);

// Video proxy uses same whitelist as image proxy
const VIDEO_PROXY_WHITELIST = IMAGE_PROXY_WHITELIST;

// Helper: does a hostname point at a private / loopback / link-local target?
// Used to block SSRF to internal services (cloud metadata, localhost, LAN) even
// when no whitelist is configured. Matches on IP literals; a DNS name that
// resolves to a private IP is out of scope here (redirect re-validation and an
// explicit whitelist are the other layers).
function isPrivateHost(hostname) {
    let h = (hostname || '').toLowerCase();
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // strip IPv6 brackets
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1) — recurse on the embedded v4 literal
    const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateHost(mapped[1]);
    // IPv6 loopback / unspecified / link-local (fe80::/10) / unique-local (fc00::/7)
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    // IPv4 literals
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
        const a = Number(m[1]), b = Number(m[2]);
        if (a === 0 || a === 127 || a === 10) return true;        // this-host, loopback, private
        if (a === 169 && b === 254) return true;                  // link-local (cloud metadata)
        if (a === 172 && b >= 16 && b <= 31) return true;         // private
        if (a === 192 && b === 168) return true;                  // private
    }
    return false;
}

// Helper: validate URL against whitelist (returns true if allowed, false if blocked).
// An explicit whitelist entry always wins (lets an operator opt a private host
// back in). With an empty whitelist, everything is allowed EXCEPT private /
// loopback / link-local targets, which are always blocked.
function isUrlAllowed(urlString, whitelist) {
    let parsed;
    try {
        parsed = new URL(urlString);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (whitelist.length > 0) return whitelist.includes(parsed.hostname);
    return !isPrivateHost(parsed.hostname);
}

// Fetch that enforces the SSRF policy on every hop: redirects are followed
// manually so each new target is re-checked against isUrlAllowed. Throws an
// error tagged `code: 'SSRF_BLOCKED'` when a target (initial or redirected) is
// not allowed, so callers can map it to 403.
async function safeFetch(urlString, whitelist, options = {}) {
    const MAX_HOPS = 5;
    let current = urlString;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
        if (!isUrlAllowed(current, whitelist)) {
            const err = new Error(`Blocked by SSRF policy: ${current}`);
            err.code = 'SSRF_BLOCKED';
            throw err;
        }
        const res = await fetch(current, { ...options, redirect: 'manual' });
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
            current = new URL(location, current).toString();
            continue;
        }
        return res;
    }
    const err = new Error('Too many redirects');
    err.code = 'SSRF_BLOCKED';
    throw err;
}

// Image MIME types constant
const IMAGE_MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== Provider Configuration ====================

function parseModels(str) {
    return (str || '').split(',').map(m => m.trim()).filter(Boolean);
}

function loadProviders() {
    const providers = [];
    for (let i = 1; i <= 10; i++) {
        const name = process.env[`PROVIDER_${i}_NAME`];
        const type = process.env[`PROVIDER_${i}_TYPE`];
        const baseUrl = process.env[`PROVIDER_${i}_BASE_URL`];
        const apiKey = process.env[`PROVIDER_${i}_API_KEY`];

        if (!name || !type || !baseUrl || !apiKey) continue;

        const validTypes = ['openai', 'openai-compatible', 'gemini'];
        if (!validTypes.includes(type)) {
            console.warn(`⚠️ Provider ${i} has invalid type: ${type}. Skipping.`);
            continue;
        }

        const models = parseModels(process.env[`PROVIDER_${i}_MODELS`]);
        if (models.length === 0) continue;
        providers.push({
            id: `provider-${i}`, name, type,
            baseUrl: baseUrl.replace(/\/$/, ''), apiKey,
            models
        });
    }
    return providers;
}

const PROVIDERS = loadProviders();

function getProvider(providerId) {
    return PROVIDERS.find(p => p.id === providerId);
}

// ==================== Middleware ====================

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ['\'self\''],
            styleSrc: ['\'self\'', '\'unsafe-inline\''],
            scriptSrc: ['\'self\'', '\'unsafe-inline\''],
            imgSrc: ['\'self\'', 'data:', 'https:', 'http:'],
            connectSrc: ['\'self\'', 'https:', 'http:'],
            fontSrc: ['\'self\''],
            objectSrc: ['\'none\''],
            mediaSrc: ['\'self\'', 'https:', 'http:'],
            frameSrc: ['\'self\'']
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Rate Limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 500,
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
// Skip rate limiting for video proxy endpoint (it streams large files)
app.use('/api/proxy/video', (req, res, next) => next());
app.use('/api/', limiter);

// Stricter limiter for login to slow brute-force attempts
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 10,
    message: { error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Public static assets (CSS/fonts) — served before auth so the login page is styled
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Authentication Middleware
app.use((req, res, next) => {
    if (!AUTH_PASSWORD) return next();

    if (req.path === '/login.html' || req.path === '/api/login' || req.path === '/favicon.ico') {
        return next();
    }

    if (timingSafeEqualStr(req.cookies.auth, AUTH_TOKEN)) {
        return next();
    }

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    res.redirect('/login.html');
});

// Static files
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(__dirname));

// Login Route
app.post('/api/login', loginLimiter, (req, res) => {
    const { password } = req.body;
    if (password === AUTH_PASSWORD) {
        res.cookie('auth', AUTH_TOKEN, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// ==================== Database Helpers ====================

// In-memory cache of the DB. Loaded once on first access; every writeDb keeps it
// in lock-step with disk (write-through). Reads serve from memory so list/stats/
// mutation endpoints never re-parse the whole file per request.
let dbCache = null;

function emptyDb() {
    return { images: [], videos: [], statistics: { total: 0, byModel: {}, videoTotal: 0, videoByModel: {} } };
}

// Parse + normalize the on-disk DB. Missing file → fresh empty DB. A corrupt /
// unreadable existing file THROWS (callers must not silently overwrite real data
// with an empty DB — that was a data-loss bug). Back-fills newer fields so older
// DB files keep working, guarding against a missing `statistics` object.
function loadDb() {
    if (!fs.existsSync(DB_FILE)) return emptyDb();
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!Array.isArray(data.images)) data.images = [];
    if (!Array.isArray(data.videos)) data.videos = [];
    if (!data.statistics || typeof data.statistics !== 'object') data.statistics = {};
    const s = data.statistics;
    if (typeof s.total !== 'number') s.total = data.images.length;
    if (!s.byModel || typeof s.byModel !== 'object') s.byModel = {};
    if (typeof s.videoTotal !== 'number') s.videoTotal = data.videos.length;
    if (!s.videoByModel || typeof s.videoByModel !== 'object') s.videoByModel = {};
    return data;
}

function readDb() {
    if (dbCache) return dbCache;
    try {
        dbCache = loadDb();
    } catch (error) {
        // Corrupt/unreadable existing file: fail loud instead of returning an
        // empty DB that a subsequent write would persist over real records.
        console.error('❌ Failed to read database (refusing to overwrite existing data):', error.message);
        throw error;
    }
    return dbCache;
}

function writeDb(data) {
    // Atomic write: serialize to a temp file, then rename over the target so an
    // interrupted write can never leave a half-written / corrupt db.json.
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
    dbCache = data; // keep the in-memory cache in lock-step with disk
}

// Test hook: drop the in-memory cache so the next readDb re-reads from disk.
function __resetDbCache() {
    dbCache = null;
}

// Shared CRUD handler factories for images & videos (identical logic, different
// collection). `collection` is 'images' or 'videos'; `label` shapes the 404 message.
function makeDeleteHandler(collection, label) {
    return (req, res) => {
        const db = readDb();
        const arr = db[collection] || [];
        const before = arr.length;
        db[collection] = arr.filter(item => item.id !== req.params.id);
        if (db[collection].length === before) {
            return res.status(404).json({ error: `${label} not found` });
        }
        writeDb(db);
        res.json({ success: true });
    };
}

function makeHideHandler(collection, label, hidden) {
    return (req, res) => {
        const db = readDb();
        const item = (db[collection] || []).find(i => i.id === req.params.id);
        if (!item) {
            return res.status(404).json({ error: `${label} not found` });
        }
        item.hidden = hidden;
        writeDb(db);
        res.json({ success: true });
    };
}

function addImageToDb(image) {
    try {
        const db = readDb();
        if (!db.statistics) {
            db.statistics = { total: 0, byModel: {} };
        }
        if (!db.statistics.byModel) {
            db.statistics.byModel = {};
        }

        db.images.unshift(image);
        db.statistics.total = (db.statistics.total || 0) + 1;
        db.statistics.byModel[image.model] = (db.statistics.byModel[image.model] || 0) + 1;
        writeDb(db);
        console.log(`✅ Image saved to database: ${image.model} (Total: ${db.statistics.total})`);
    } catch (error) {
        console.error('❌ Failed to save image to database:', error);
    }
}

function addVideoToDb(video) {
    try {
        const db = readDb();
        if (!db.videos) db.videos = [];
        if (!db.statistics.videoTotal) db.statistics.videoTotal = 0;
        if (!db.statistics.videoByModel) db.statistics.videoByModel = {};

        db.videos.unshift(video);
        db.statistics.videoTotal = (db.statistics.videoTotal || 0) + 1;
        db.statistics.videoByModel[video.model] = (db.statistics.videoByModel[video.model] || 0) + 1;
        writeDb(db);
        console.log(`✅ Video saved to database: ${video.model} (Total: ${db.statistics.videoTotal})`);
    } catch (error) {
        console.error('❌ Failed to save video to database:', error);
    }
}

// ==================== API Adapters ====================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Build the upstream request body from { model, prompt, n, params }.
 * `params` (arbitrary caller-supplied object) is passed through verbatim so any
 * provider-specific field (aspect_ratio, resolution, duration, response_format…)
 * reaches the upstream — nothing is hardcoded per channel. Top-level model/prompt
 * stay authoritative (params can never override routing). n is included only for
 * image generation (videos take no n).
 */
function buildMediaBody({ model, prompt, n, params }, includeN) {
    const extra = (params && typeof params === 'object' && !Array.isArray(params)) ? { ...params } : {};
    delete extra.model;
    delete extra.prompt;
    const body = { ...extra, model, prompt };
    if (includeN) {
        const topN = Number.isInteger(n) && n > 0 ? n : null;
        const extraN = Number.isInteger(extra.n) && extra.n > 0 ? extra.n : null;
        body.n = topN || extraN || 1;
    } else {
        delete body.n;
    }
    return body;
}

/**
 * Standard OpenAI Images API
 * POST /v1/images/generations
 */
async function callOpenAI(provider, params) {
    const url = `${provider.baseUrl}/images/generations`;
    const body = buildMediaBody(params, true);

    console.log(`[OpenAI] Calling ${url} with model ${params.model}`);
    console.log('[OpenAI] Request body:', JSON.stringify(body));

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const result = await response.json();

    if (!result.data || result.data.length === 0) {
        throw new Error('OpenAI returned no images');
    }

    const images = result.data.map(item => {
        if (item.url) return item.url;
        if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
        return null;
    }).filter(Boolean);

    if (images.length === 0) {
        throw new Error('No valid image URLs in OpenAI response');
    }

    return { url: images[0], allUrls: images };
}

/**
 * OpenAI-Compatible (Reverse Proxy) via Chat Completions
 * POST /v1/chat/completions
 * Extracts image URLs from markdown in the response
 */
async function callOpenAICompatible(provider, params) {
    const url = `${provider.baseUrl}/chat/completions`;
    const body = {
        model: params.model,
        messages: [
            {
                role: 'user',
                content: params.prompt
            }
        ],
        max_tokens: 4096,
        stream: false,
    };

    console.log(`[OpenAI-Compatible] Calling ${url} with model ${params.model}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI-Compatible API error ${response.status}: ${text}`);
    }

    // Check if response is SSE streaming (text/event-stream) or JSON
    const contentType = response.headers.get('content-type') || '';
    let content = '';

    if (contentType.includes('text/event-stream')) {
        // Parse SSE streaming response
        const text = await response.text();
        const lines = text.split('\n');
        let fullContent = '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') break;
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content ||
                                  parsed.choices?.[0]?.message?.content || '';
                    fullContent += delta;
                } catch {
                    // Skip unparseable lines
                }
            }
        }
        content = fullContent;
    } else {
        // Standard JSON response
        const result = await response.json();
        content = result.choices?.[0]?.message?.content || '';
    }

    if (!content) {
        throw new Error('No content in chat completion response');
    }

    console.log(`[OpenAI-Compatible] Response content length: ${content.length}`);

    // Extract image URLs from markdown: ![...](url) or direct URLs
    const markdownRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
    const urlRegex = /(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg)(?:\?[^\s"'<>]*)?)/gi;

    const images = [];
    let match;

    // First try markdown image syntax
    while ((match = markdownRegex.exec(content)) !== null) {
        images.push(match[1]);
    }

    // If no markdown images found, try direct URLs with image extensions
    if (images.length === 0) {
        while ((match = urlRegex.exec(content)) !== null) {
            images.push(match[0]);
        }
    }

    if (images.length === 0) {
        throw new Error('No image URLs found in chat response. Raw content: ' + content.substring(0, 500));
    }

    return { url: images[0], allUrls: images, rawContent: content };
}

/**
 * Google Gemini API
 * POST /models/{model}:generateContent
 */
async function callGemini(provider, params) {
    const url = `${provider.baseUrl}/models/${params.model}:generateContent?key=${provider.apiKey}`;
    const body = {
        contents: [
            {
                parts: [
                    { text: params.prompt }
                ]
            }
        ],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE']
        }
    };

    console.log(`[Gemini] Calling ${url}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${text}`);
    }

    const result = await response.json();

    // Extract images from Gemini response
    const candidates = result.candidates;
    if (!candidates || candidates.length === 0) {
        throw new Error('No candidates in Gemini response');
    }

    const parts = candidates[0].content?.parts;
    if (!parts || parts.length === 0) {
        throw new Error('No parts in Gemini response');
    }

    const images = [];
    let textContent = '';

    for (const part of parts) {
        if (part.inlineData) {
            // Base64 image data
            const mimeType = part.inlineData.mimeType || 'image/png';
            images.push(`data:${mimeType};base64,${part.inlineData.data}`);
        }
        if (part.text) {
            textContent += part.text;
            // Also try to extract URLs from text
            const urlRegex = /(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s"'<>]*)?)/gi;
            let match;
            while ((match = urlRegex.exec(part.text)) !== null) {
                images.push(match[0]);
            }
        }
    }

    if (images.length === 0) {
        throw new Error('No images found in Gemini response. Text: ' + textContent.substring(0, 500));
    }

    return { url: images[0], allUrls: images, rawContent: textContent };
}

/**
 * Video generation (async): POST /v1/videos/generations returns a request_id,
 * then poll GET /v1/videos/{request_id} until a video URL appears. The status
 * response is passed through verbatim by the gateway (shape is the upstream's),
 * so request-id and URL extraction are tolerant / field-agnostic.
 */
function extractRequestId(body) {
    if (!body || typeof body !== 'object') return null;
    for (const key of ['request_id', 'id']) {
        if (typeof body[key] === 'string' && body[key].trim()) return body[key].trim();
    }
    for (const parent of ['data', 'video']) {
        const p = body[parent];
        if (p && typeof p === 'object') {
            for (const key of ['request_id', 'id']) {
                if (typeof p[key] === 'string' && p[key].trim()) return p[key].trim();
            }
        }
    }
    return null;
}

function extractVideoUrl(body) {
    if (!body || typeof body !== 'object') return null;
    const fields = [body.url, body.video_url, body.video?.url, body.data?.url, body.data?.video_url];
    const urls = fields.filter(u => typeof u === 'string' && /^https?:\/\//.test(u));
    const mp4 = urls.find(u => /\.mp4(\?|$)/i.test(u));
    if (mp4) return mp4;
    // Fallback: scan the whole JSON for an mp4 URL
    const m = JSON.stringify(body).match(/https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?/i);
    if (m) return m[0];
    return urls[0] || null;
}

function videoStatusFailed(body) {
    const status = String(body?.status || body?.state || body?.data?.status || '').toLowerCase();
    return ['failed', 'error', 'canceled', 'cancelled'].includes(status);
}

async function callVideoGeneration(provider, params) {
    const genUrl = `${provider.baseUrl}/videos/generations`;
    const body = buildMediaBody(params, false);

    console.log(`[Video] Calling ${genUrl} with model ${params.model}`);
    console.log('[Video] Request body:', JSON.stringify(body));

    const genRes = await fetch(genUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!genRes.ok) {
        const text = await genRes.text();
        throw new Error(`Video generation error ${genRes.status}: ${text}`);
    }

    const genJson = await genRes.json();
    // Some responses may already carry the URL; otherwise poll by request_id.
    const immediate = extractVideoUrl(genJson);
    if (immediate) return { url: immediate, allUrls: [immediate] };

    const requestId = extractRequestId(genJson);
    if (!requestId) throw new Error('Video generation returned no request_id');

    const interval = Number(process.env.VIDEO_POLL_INTERVAL_MS) || 3000;
    const timeout = Number(process.env.VIDEO_POLL_TIMEOUT_MS) || 90000;
    const deadline = Date.now() + timeout;
    const statusUrl = `${provider.baseUrl}/videos/${encodeURIComponent(requestId)}`;

    while (Date.now() < deadline) {
        await sleep(interval);
        const pollRes = await fetch(statusUrl, {
            headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Accept': 'application/json' }
        });
        if (!pollRes.ok) continue; // transient upstream hiccup — keep polling until deadline
        const pollJson = await pollRes.json().catch(() => ({}));
        if (videoStatusFailed(pollJson)) throw new Error('Video generation failed upstream');
        const url = extractVideoUrl(pollJson);
        if (url) return { url, allUrls: [url] };
    }

    const err = new Error('Video generation timed out');
    err.code = 'VIDEO_TIMEOUT';
    err.requestId = requestId;
    throw err;
}

/**
 * Route to the correct adapter based on provider type
 */
async function callProvider(provider, params) {
    switch (provider.type) {
    case 'openai':
        return await callOpenAI(provider, params);
    case 'openai-compatible':
        return await callOpenAICompatible(provider, params);
    case 'gemini':
        return await callGemini(provider, params);
    default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
}

// ==================== Chevereto Upload Helper ====================

async function uploadToChevereto(fileUrl, isVideo = false, providerApiKey = null) {
    const cheveretoUrl = process.env.CHEVERETO_URL;
    const apiKey = process.env.CHEVERETO_API_KEY;
    const albumId = process.env.CHEVERETO_ALBUM_ID;

    if (!cheveretoUrl || !apiKey) {
        console.log('Chevereto not configured, skipping upload');
        return null;
    }

    // Skip data: URLs
    if (fileUrl.startsWith('data:')) {
        console.log('Skipping Chevereto upload for base64 data URL');
        return null;
    }

    try {
        console.log(`Downloading file from: ${fileUrl}`);
        const headers = {};
        // Pass provider API key for authentication when downloading from upstream
        if (providerApiKey) {
            headers['Authorization'] = `Bearer ${providerApiKey}`;
        }
        const response = await fetch(fileUrl, { headers });
        if (!response.ok) throw new Error(`Failed to download file. Status: ${response.status}`);

        const formData = new FormData();
        const filename = isVideo ? 'video.mp4' : 'image.png';
        const mimeType = isVideo ? 'video/mp4' : 'image/png';
        // Prefer streaming the download straight into the upload (no full-file
        // buffering) when the source advertises a length form-data can use for
        // the multipart Content-Length. Fall back to buffering otherwise.
        // form-data needs a Buffer/Stream/string here — a Web Blob throws "source.on is not a function".
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > 0) {
            formData.append('source', response.body, { filename, contentType: mimeType, knownLength: contentLength });
        } else {
            const buffer = Buffer.from(await response.arrayBuffer());
            formData.append('source', buffer, { filename, contentType: mimeType });
        }
        if (albumId) {
            formData.append('album_id', albumId);
        }

        const apiUrl = cheveretoUrl.replace(/\/$/, '') + '/api/1/upload';
        console.log(`Uploading to Chevereto: ${apiUrl}`);

        const uploadResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'X-API-Key': apiKey
            },
            body: formData
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Chevereto API returned status ${uploadResponse.status}: ${errorText}`);
        }

        const result = await uploadResponse.json();
        if (result.status_code === 200 && result.image?.url) {
            console.log('✅ Chevereto upload successful. New URL:', result.image.url);
            return result.image.url;
        } else {
            throw new Error(`Chevereto returned an error: ${result.status_txt || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Chevereto upload failed:', error.message);
        return null;
    }
}

// ==================== API Routes ====================

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '3.0.0',
        providers: PROVIDERS.length
    });
});

// Get available providers and models
app.get('/api/providers', (req, res) => {
    const providers = PROVIDERS.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        models: p.models
    }));
    res.json(providers);
});

// Generate Endpoint (text-to-image)
app.post('/api/generate', async (req, res) => {
    const { provider: providerId, model, prompt, n, params } = req.body;

    if (!providerId) return res.status(400).json({ error: 'Missing provider.' });
    const provider = getProvider(providerId);
    if (!provider) return res.status(400).json({ error: `Unknown provider: ${providerId}` });
    if (!model) return res.status(400).json({ error: 'Missing model.' });
    if (!provider.models.includes(model)) return res.status(400).json({ error: `Model "${model}" not available.` });
    if (!prompt) return res.status(400).json({ error: 'Missing prompt.' });

    try {
        console.log(`[Generate] provider=${provider.name} type=${provider.type} model=${model}`);

        const result = await callProvider(provider, { model, prompt, n, params });

        const allUrls = result.allUrls || [result.url];
        const timestamp = new Date().toISOString();

        // Upload all images to Chevereto in parallel (falls back to original URL on failure)
        const records = await Promise.all(allUrls.map(async (mediaUrl) => {
            let cheveretoUrl = null;
            try {
                cheveretoUrl = await uploadToChevereto(mediaUrl, false, provider.apiKey);
            } catch (e) {
                console.error('Chevereto upload failed', e);
            }
            const id = 'gen-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            return {
                id, url: cheveretoUrl || mediaUrl,
                prompt, model,
                provider: provider.name, providerType: provider.type,
                params: params || null,
                timestamp, hidden: false,
            };
        }));

        // Persist in original order (newest ends up first via unshift)
        records.forEach(addImageToDb);

        res.json(records.length === 1 ? records[0] : { results: records, count: records.length });

    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Video Generation Endpoint (text-to-video, async polling)
app.post('/api/generate/video', async (req, res) => {
    const { provider: providerId, model, prompt, params } = req.body;

    if (!providerId) return res.status(400).json({ error: 'Missing provider.' });
    const provider = getProvider(providerId);
    if (!provider) return res.status(400).json({ error: `Unknown provider: ${providerId}` });
    if (!model) return res.status(400).json({ error: 'Missing model.' });
    if (!provider.models.includes(model)) return res.status(400).json({ error: `Model "${model}" not available.` });
    if (!prompt) return res.status(400).json({ error: 'Missing prompt.' });

    try {
        console.log(`[GenerateVideo] provider=${provider.name} type=${provider.type} model=${model}`);

        const result = await callVideoGeneration(provider, { model, prompt, params });

        let cheveretoUrl = null;
        try {
            cheveretoUrl = await uploadToChevereto(result.url, true, provider.apiKey);
        } catch (e) {
            console.error('Chevereto video upload failed', e);
        }

        const record = {
            id: 'gen-vid-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            url: cheveretoUrl || result.url,
            prompt, model,
            provider: provider.name, providerType: provider.type,
            params: params || null,
            type: 'text-to-video', source: 'generated',
            timestamp: new Date().toISOString(), hidden: false,
        };

        addVideoToDb(record);
        res.json(record);

    } catch (error) {
        if (error.code === 'VIDEO_TIMEOUT') {
            return res.status(504).json({
                error: 'Video generation timed out. It may still be processing.',
                request_id: error.requestId
            });
        }
        console.error('Video generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Image Endpoints ====================

app.get('/api/images', (req, res) => {
    const db = readDb();
    const images = db.images || [];
    // Total exposed via header so clients can paginate without a body-shape change
    res.setHeader('X-Total-Count', images.length);
    // Optional pagination: ?limit & ?offset. Without limit, returns everything (back-compat).
    const limit = parseInt(req.query.limit, 10);
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json(Number.isInteger(limit) && limit >= 0 ? images.slice(offset, offset + limit) : images);
});

app.get('/api/images/stats', (req, res) => {
    const db = readDb();
    res.json(db.statistics || { total: 0, byModel: {} });
});

// Manual Image Collection
app.post('/api/images/manual', (req, res) => {
    const { url, prompt, model, aspectRatio } = req.body;

    if (!url || !prompt) {
        return res.status(400).json({ error: 'URL and prompt are required.' });
    }

    try {
        new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid URL format.' });
    }

    if (!isUrlAllowed(url, IMAGE_PROXY_WHITELIST)) {
        return res.status(403).json({ error: 'Domain not allowed. Please use a whitelisted domain.' });
    }

    const id = 'manual-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    const imageRecord = {
        id: id,
        url: url,
        prompt: prompt,
        model: model || 'Manual',
        aspectRatio: aspectRatio || 'Unknown',
        resolution: null,
        safety_tolerance: null,
        timestamp: new Date().toISOString(),
        hidden: false,
        source: 'manual'
    };

    addImageToDb(imageRecord);
    res.json(imageRecord);
});

app.delete('/api/images/:id', makeDeleteHandler('images', 'Image'));

app.patch('/api/images/:id/hide', makeHideHandler('images', 'Image', true));

app.patch('/api/images/:id/unhide', makeHideHandler('images', 'Image', false));

// ==================== Video Endpoints ====================

app.get('/api/videos', (req, res) => {
    const db = readDb();
    const videos = db.videos || [];
    res.setHeader('X-Total-Count', videos.length);
    const limit = parseInt(req.query.limit, 10);
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json(Number.isInteger(limit) && limit >= 0 ? videos.slice(offset, offset + limit) : videos);
});

app.get('/api/videos/stats', (req, res) => {
    const db = readDb();
    res.json({
        videoTotal: db.statistics.videoTotal || 0,
        videoByModel: db.statistics.videoByModel || {}
    });
});

app.post('/api/videos/text-to-video', (req, res) => {
    const { url, prompt, model, aspectRatio } = req.body;

    if (!url || !prompt) {
        return res.status(400).json({ error: 'Video URL and prompt are required.' });
    }

    try {
        new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid video URL format.' });
    }

    if (!isUrlAllowed(url, IMAGE_PROXY_WHITELIST)) {
        return res.status(403).json({ error: 'Domain not allowed. Please use a whitelisted domain.' });
    }

    const id = 'video-t2v-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    const videoRecord = {
        id: id,
        url: url,
        prompt: prompt,
        model: model || 'Unknown',
        aspectRatio: aspectRatio || 'Unknown',
        type: 'text-to-video',
        timestamp: new Date().toISOString(),
        hidden: false,
        source: 'manual'
    };

    addVideoToDb(videoRecord);
    res.json(videoRecord);
});

app.post('/api/videos/image-to-video', (req, res) => {
    const { url, sourceImageUrl, prompt, model, aspectRatio } = req.body;

    if (!url || !sourceImageUrl) {
        return res.status(400).json({ error: 'Video URL and source image URL are required.' });
    }

    try {
        new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid video URL format.' });
    }

    try {
        new URL(sourceImageUrl);
    } catch {
        return res.status(400).json({ error: 'Invalid source image URL format.' });
    }

    if (!isUrlAllowed(url, IMAGE_PROXY_WHITELIST) || !isUrlAllowed(sourceImageUrl, IMAGE_PROXY_WHITELIST)) {
        return res.status(403).json({ error: 'Domain not allowed. Please use a whitelisted domain.' });
    }

    const id = 'video-i2v-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    const videoRecord = {
        id: id,
        url: url,
        sourceImageUrl: sourceImageUrl,
        prompt: prompt || '',
        model: model || 'Unknown',
        aspectRatio: aspectRatio || 'Unknown',
        type: 'image-to-video',
        timestamp: new Date().toISOString(),
        hidden: false,
        source: 'manual'
    };

    addVideoToDb(videoRecord);
    res.json(videoRecord);
});

app.delete('/api/videos/:id', makeDeleteHandler('videos', 'Video'));

app.patch('/api/videos/:id/hide', makeHideHandler('videos', 'Video', true));

app.patch('/api/videos/:id/unhide', makeHideHandler('videos', 'Video', false));

// ==================== Video Proxy (CORS Fix + Caching) ====================

const VIDEO_CACHE_DIR = path.join(DATA_DIR, 'video-cache');
const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'image-cache');

// Ensure cache directories exist
if (!fs.existsSync(VIDEO_CACHE_DIR)) {
    fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true });
}
if (!fs.existsSync(IMAGE_CACHE_DIR)) {
    fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
}

const VIDEO_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Clean up old cached videos (async so it never blocks startup)
async function cleanVideoCache() {
    try {
        const now = Date.now();
        const files = await fs.promises.readdir(VIDEO_CACHE_DIR);
        let cleaned = 0;
        let cleanedBytes = 0;
        for (const file of files) {
            const filePath = path.join(VIDEO_CACHE_DIR, file);
            const stat = await fs.promises.stat(filePath);
            if (now - stat.mtimeMs > VIDEO_CACHE_MAX_AGE_MS) {
                cleanedBytes += stat.size;
                await fs.promises.unlink(filePath);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[Proxy] Cleaned ${cleaned} old cached videos (${(cleanedBytes / 1024 / 1024).toFixed(2)} MB)`);
        }
    } catch (err) {
        console.error('[Proxy] Video cache cleanup error:', err.message);
    }
}

// Simple URL-to-filename mapping (hash the URL for safe filename)
function getCachePath(videoUrl) {
    const hash = crypto.createHash('md5').update(videoUrl).digest('hex');
    return path.join(VIDEO_CACHE_DIR, `${hash}.mp4`);
}

function getImageCachePath(imageUrl) {
    const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
    const pathname = new URL(imageUrl).pathname;
    const ext = path.extname(pathname) || '.jpg';
    return path.join(IMAGE_CACHE_DIR, `${hash}${ext}`);
}

// Coalesced, SSRF-safe download-to-cache. Concurrent requests for the same cache
// path share one in-flight download; the file only appears (atomic tmp→rename)
// once fully written, so a cache hit is always a complete file — never a
// truncated one left by an aborted/errored stream. Throws on SSRF block
// (code 'SSRF_BLOCKED'), timeout (name 'AbortError'), or upstream error (.status).
const inflightDownloads = new Map();

function ensureCached(url, cachePath, whitelist) {
    if (fs.existsSync(cachePath)) return Promise.resolve();
    if (inflightDownloads.has(cachePath)) return inflightDownloads.get(cachePath);

    const task = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000); // 30s timeout
        const tmp = `${cachePath}.tmp`;
        try {
            const response = await safeFetch(url, whitelist, { signal: controller.signal });
            if (!response.ok) {
                const err = new Error(`Upstream responded ${response.status}`);
                err.status = response.status;
                throw err;
            }
            await new Promise((resolve, reject) => {
                const ws = fs.createWriteStream(tmp);
                response.body.on('error', reject);
                ws.on('error', reject);
                ws.on('finish', resolve);
                response.body.pipe(ws);
            });
            fs.renameSync(tmp, cachePath); // atomic — a cache hit is always complete
            console.log(`[Proxy] Cached: ${cachePath}`);
        } catch (error) {
            if (fs.existsSync(tmp)) {
                try { fs.unlinkSync(tmp); } catch { /* best-effort cleanup */ }
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    })();

    inflightDownloads.set(cachePath, task);
    return task.finally(() => inflightDownloads.delete(cachePath));
}

// Map a proxy fetch failure to the right HTTP status.
function sendProxyError(res, error, kind) {
    if (error.code === 'SSRF_BLOCKED') return res.status(403).json({ error: 'Domain not allowed' });
    if (error.name === 'AbortError') return res.status(504).json({ error: 'Fetch timeout' });
    if (error.status) return res.status(error.status).json({ error: `Failed to fetch ${kind}` });
    console.error(`[Proxy] ${kind} fetch error:`, error.message);
    return res.status(500).json({ error: error.message });
}

app.get('/api/proxy/video', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Validate URL format
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid url parameter' });
    }

    // SSRF protection: check hostname against whitelist
    if (!isUrlAllowed(url, VIDEO_PROXY_WHITELIST)) {
        console.warn(`[Proxy] Blocked video request to non-whitelisted domain: ${parsedUrl.hostname}`);
        return res.status(403).json({ error: 'Domain not allowed' });
    }

    const cachePath = getCachePath(url);

    // Download to cache (coalesced + SSRF-safe redirects) if not already present,
    // then serve the complete file. safeFetch inside re-validates every redirect.
    try {
        await ensureCached(url, cachePath, VIDEO_PROXY_WHITELIST);
    } catch (error) {
        return sendProxyError(res, error, 'video');
    }

    const stat = fs.statSync(cachePath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    fs.createReadStream(cachePath).pipe(res);
});

// ==================== Image Proxy (CORS Fix + Caching) ====================

const IMAGE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Clean up old cached images (async so it never blocks startup)
async function cleanImageCache() {
    try {
        const now = Date.now();
        const files = await fs.promises.readdir(IMAGE_CACHE_DIR);
        let cleaned = 0;
        let cleanedBytes = 0;
        for (const file of files) {
            const filePath = path.join(IMAGE_CACHE_DIR, file);
            const stat = await fs.promises.stat(filePath);
            if (now - stat.mtimeMs > IMAGE_CACHE_MAX_AGE_MS) {
                cleanedBytes += stat.size;
                await fs.promises.unlink(filePath);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[Proxy] Cleaned ${cleaned} old cached images (${(cleanedBytes / 1024 / 1024).toFixed(2)} MB)`);
        }
    } catch (err) {
        console.error('[Proxy] Cache cleanup error:', err.message);
    }
}

app.get('/api/proxy/image', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Validate URL format
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid url parameter' });
    }

    // SSRF protection: check hostname against whitelist
    if (!isUrlAllowed(url, IMAGE_PROXY_WHITELIST)) {
        console.warn(`[Proxy] Blocked request to non-whitelisted domain: ${parsedUrl.hostname}`);
        return res.status(403).json({ error: 'Domain not allowed' });
    }

    const cachePath = getImageCachePath(url);

    // Download to cache (coalesced + SSRF-safe redirects) if not already present,
    // then serve the complete file.
    try {
        await ensureCached(url, cachePath, IMAGE_PROXY_WHITELIST);
    } catch (error) {
        return sendProxyError(res, error, 'image');
    }

    const stat = fs.statSync(cachePath);
    const ext = path.extname(cachePath).toLowerCase();
    res.setHeader('Content-Type', IMAGE_MIME_TYPES[ext] || 'image/jpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    fs.createReadStream(cachePath).pipe(res);
});

// ==================== Server Startup ====================

function onListening() {
    console.log('==============================================');
    console.log('🚀 AI Studio v3.0.0');
    console.log('==============================================');
    console.log(`📍 Server running on http://localhost:${PORT}`);
    console.log(`🔐 Authentication: ${AUTH_PASSWORD ? '✅ Enabled' : '⚠️ Disabled'}`);
    console.log(`☁️  Chevereto: ${process.env.CHEVERETO_URL ? '✅ Configured' : '⚠️ Disabled'}`);
    console.log('==============================================');
    if (PROVIDERS.length === 0) {
        console.log('⚠️  No providers configured! Set PROVIDER_N_* environment variables.');
    } else {
        console.log(`🤖 Configured Providers (${PROVIDERS.length}):`);
        PROVIDERS.forEach(p => {
            console.log(`   • ${p.name} [${p.type}]`);
            console.log(`     Models: ${p.models.join(', ')}`);
        });
    }
    console.log('==============================================');
    console.log('📖 API Endpoints:');
    console.log('   • GET  /health - Health check');
    console.log('   • GET  /api/providers - List providers & models');
    console.log('   • POST /api/generate - Generate image');
    console.log('   • GET  /api/images - List images');
    console.log('   • GET  /api/images/stats - Statistics');
    console.log('   • POST /api/images/manual - Add manual image');
    console.log('   • GET  /api/videos - List videos');
    console.log('==============================================');

    // Background cache cleanup (async — never blocks startup)
    cleanVideoCache();
    cleanImageCache();
}

if (isMainModule) {
    app.listen(PORT, onListening);
}

export {
    app,
    readDb,
    writeDb,
    addImageToDb,
    addVideoToDb,
    loadProviders,
    parseModels,
    isUrlAllowed,
    isPrivateHost,
    __resetDbCache
};
