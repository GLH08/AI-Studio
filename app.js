import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
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

const app = express();
const PORT = process.env.PORT || 8787;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

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

        const validTypes = ['openai', 'openai-compatible', 'gemini', 'grok2api'];
        if (!validTypes.includes(type)) {
            console.warn(`⚠️ Provider ${i} has invalid type: ${type}. Skipping.`);
            continue;
        }

        if (type === 'grok2api') {
            const imageModels = parseModels(process.env[`PROVIDER_${i}_IMAGE_MODELS`]);
            const imageEditModels = parseModels(process.env[`PROVIDER_${i}_IMAGE_EDIT_MODELS`]);
            const videoModels = parseModels(process.env[`PROVIDER_${i}_VIDEO_MODELS`]);
            const allModels = [...imageModels, ...imageEditModels, ...videoModels];
            if (allModels.length === 0) continue;
            providers.push({
                id: `provider-${i}`, name, type,
                baseUrl: baseUrl.replace(/\/$/, ''), apiKey,
                models: allModels, imageModels, imageEditModels, videoModels
            });
        } else {
            const models = parseModels(process.env[`PROVIDER_${i}_MODELS`]);
            if (models.length === 0) continue;
            providers.push({
                id: `provider-${i}`, name, type,
                baseUrl: baseUrl.replace(/\/$/, ''), apiKey,
                models, imageModels: models, imageEditModels: [], videoModels: []
            });
        }
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
            scriptSrc: ['\'self\'', '\'unsafe-inline\'', '\'unsafe-eval\''],
            imgSrc: ['\'self\'', 'data:', 'https:', 'http:'],
            connectSrc: ['\'self\'', 'https:', 'http:'],
            fontSrc: ['\'self\'', 'https:', 'http:'],
            objectSrc: ['\'none\''],
            mediaSrc: ['\'self\'', 'https:', 'http:'],
            frameSrc: ['\'self\'']
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX_REQUESTS || 500,
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
// Skip rate limiting for video proxy endpoint (it streams large files)
app.use('/api/proxy/video', (req, res, next) => next());
app.use('/api/', limiter);

// Authentication Middleware
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', 'default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:;');

    if (!AUTH_PASSWORD) return next();

    if (req.path === '/login.html' || req.path === '/api/login' || req.path === '/favicon.ico') {
        return next();
    }

    const authCookie = req.cookies.auth;
    if (authCookie === AUTH_PASSWORD) {
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
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === AUTH_PASSWORD) {
        res.cookie('auth', password, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// ==================== Database Helpers ====================

function readDb() {
    if (!fs.existsSync(DB_FILE)) {
        return { images: [], videos: [], statistics: { total: 0, byModel: {}, videoTotal: 0, videoByModel: {} } };
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (!data.videos) data.videos = [];
        if (!data.statistics.videoTotal) data.statistics.videoTotal = 0;
        if (!data.statistics.videoByModel) data.statistics.videoByModel = {};
        return data;
    } catch {
        return { images: [], videos: [], statistics: { total: 0, byModel: {}, videoTotal: 0, videoByModel: {} } };
    }
}

function writeDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
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

/**
 * Standard OpenAI Images API
 * POST /v1/images/generations
 */
async function callOpenAI(provider, params) {
    const url = `${provider.baseUrl}/images/generations`;
    const body = {
        model: params.model,
        prompt: params.prompt,
        n: params.n || 1,
    };

    if (params.size) body.size = params.size;
    if (params.quality) body.quality = params.quality;
    if (params.style) body.style = params.style;
    if (params.response_format) body.response_format = params.response_format;

    console.log(`[OpenAI] Calling ${url} with model ${params.model}`);

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
 * Grok2API v2 dedicated adapter
 * Supports: text-to-image, image-edit, text-to-video, image-to-video
 * Uses dedicated endpoints: /v1/images/generations, /v1/images/edits, /v1/videos
 */
async function callGrok2API(provider, params) {
    const mode = params.mode || 'text-to-image';
    const isVideo = mode === 'text-to-video' || mode === 'image-to-video';
    const isEdit = mode === 'image-edit';

    console.log(`[Grok2API] ${mode} → model=${params.model}`);

    if (isVideo) {
        return await callGrok2APIVideo(provider, params);
    } else if (isEdit) {
        return await callGrok2APIImageEdit(provider, params);
    } else {
        return await callGrok2APIImageGenerate(provider, params);
    }
}

/**
 * Image generation via /v1/images/generations
 */
async function callGrok2APIImageGenerate(provider, params) {
    const url = `${provider.baseUrl}/images/generations`;

    const body = {
        model: params.model,
        prompt: params.prompt,
        n: parseInt(params.imageConfig?.n) || 1,
        size: params.imageConfig?.size || '1024x1024',
        response_format: 'url'
    };

    console.log(`[Grok2API] Image Generate → ${url} model=${params.model}`);

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
        throw new Error(`Grok2API image error ${response.status}: ${text}`);
    }

    const result = await response.json();

    if (!result.data || result.data.length === 0) {
        throw new Error('No images returned from Grok2API');
    }

    const urls = result.data.map(item => item.url || item.b64_json);
    const rawContent = JSON.stringify(result);

    return { url: urls[0], allUrls: urls, rawContent, isVideo: false };
}

/**
 * Image edit via /v1/images/edits (multipart form-data)
 */
async function callGrok2APIImageEdit(provider, params) {
    const url = `${provider.baseUrl}/images/edits`;

    // Download source image and convert to base64
    let sourceImageData = null;
    if (params.sourceImageUrl) {
        try {
            const imgRes = await fetch(params.sourceImageUrl);
            const imgBuf = await imgRes.arrayBuffer();
            const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
            sourceImageData = {
                mimeType,
                base64: Buffer.from(imgBuf).toString('base64')
            };
        } catch (e) {
            console.error('[Grok2API] Failed to download source image:', e.message);
            throw new Error('Failed to download source image for editing');
        }
    } else {
        throw new Error('Image edit requires a source image');
    }

    const formData = new FormData();
    formData.append('model', params.model);
    formData.append('prompt', params.prompt);
    formData.append('image', Buffer.from(sourceImageData.base64, 'base64'), {
        filename: 'source.png',
        contentType: sourceImageData.mimeType
    });
    formData.append('n', parseInt(params.imageConfig?.n) || 1);
    formData.append('size', params.imageConfig?.size || '1024x1024');
    formData.append('response_format', 'url');

    console.log(`[Grok2API] Image Edit → ${url} model=${params.model}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${provider.apiKey}`
        },
        body: formData
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Grok2API image edit error ${response.status}: ${text}`);
    }

    const result = await response.json();

    if (!result.data || result.data.length === 0) {
        throw new Error('No images returned from Grok2API edit');
    }

    const urls = result.data.map(item => item.url || item.b64_json);
    const rawContent = JSON.stringify(result);

    return { url: urls[0], allUrls: urls, rawContent, isVideo: false };
}

/**
 * Video generation via /v1/videos (multipart form-data) + polling
 */
async function callGrok2APIVideo(provider, params) {
    const createUrl = `${provider.baseUrl}/videos`;
    const hasSourceImage = params.sourceImageUrl && params.mode === 'image-to-video';

    // Prepare source image for image-to-video
    let sourceImageBase64 = null;
    if (hasSourceImage && params.sourceImageUrl) {
        try {
            const imgRes = await fetch(params.sourceImageUrl);
            const imgBuf = await imgRes.arrayBuffer();
            const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
            sourceImageBase64 = {
                mimeType,
                data: Buffer.from(imgBuf).toString('base64')
            };
        } catch (e) {
            console.error('[Grok2API] Failed to download source image:', e.message);
            throw new Error('Failed to download source image for video generation');
        }
    }

    // Build form data for video creation
    const formData = new FormData();
    formData.append('model', params.model);
    formData.append('prompt', params.prompt);

    if (hasSourceImage && sourceImageBase64) {
        formData.append('image', Buffer.from(sourceImageBase64.data, 'base64'), {
            filename: 'source.png',
            contentType: sourceImageBase64.mimeType
        });
    }

    // Use 'seconds' instead of 'video_length' for grok2api v2
    formData.append('seconds', parseInt(params.videoConfig?.seconds) || 6);
    formData.append('size', params.videoConfig?.aspect_ratio || '720x1280');
    formData.append('resolution_name', params.videoConfig?.resolution_name || '720p');
    formData.append('preset', params.videoConfig?.preset || 'custom');

    console.log(`[Grok2API] Video Create → ${createUrl} model=${params.model}`);

    const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${provider.apiKey}`
        },
        body: formData
    });

    if (!createResponse.ok) {
        const text = await createResponse.text();
        throw new Error(`Grok2API video error ${createResponse.status}: ${text}`);
    }

    const job = await createResponse.json();

    if (!job.id) {
        throw new Error('No video job ID returned');
    }

    console.log(`[Grok2API] Video job created: ${job.id}, polling for completion...`);

    // Poll for video completion
    const videoUrl = await pollVideoCompletion(provider, job.id);

    return {
        url: videoUrl,
        allUrls: [videoUrl],
        rawContent: JSON.stringify(job),
        isVideo: true
    };
}

/**
 * Poll video job status until completed
 */
async function pollVideoCompletion(provider, videoId, maxAttempts = 60, intervalMs = 3000) {
    const statusUrl = `${provider.baseUrl}/videos/${videoId}`;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        console.log(`[Grok2API] Polling video status: ${videoId} (attempt ${attempt + 1}/${maxAttempts})`);

        const response = await fetch(statusUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`
            }
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Grok2API video status error ${response.status}: ${text}`);
        }

        const job = await response.json();

        if (job.status === 'completed') {
            // Get video content URL
            const contentUrl = `${provider.baseUrl}/videos/${videoId}/content`;
            console.log(`[Grok2API] Video completed: ${videoId}, content URL: ${contentUrl}`);
            return contentUrl;
        }

        if (job.status === 'failed') {
            throw new Error(`Video generation failed: ${job.error?.message || 'Unknown error'}`);
        }

        if (job.status === 'in_progress' || job.status === 'queued') {
            console.log(`[Grok2API] Video ${job.status}, progress: ${job.progress || 0}%`);
            await sleep(intervalMs);
            continue;
        }

        // Unknown status, wait and retry
        console.log(`[Grok2API] Unknown video status: ${job.status}, retrying...`);
        await sleep(intervalMs);
    }

    throw new Error(`Video generation timeout after ${maxAttempts} attempts`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    case 'grok2api':
        return await callGrok2API(provider, params);
    default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
}

// ==================== Chevereto Upload Helper ====================

async function uploadToChevereto(fileUrl, isVideo = false) {
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
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`Failed to download file. Status: ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const formData = new FormData();
        const filename = isVideo ? 'video.mp4' : 'image.png';
        const mimeType = isVideo ? 'video/mp4' : 'image/png';
        formData.append('source', new Blob([buffer], { type: mimeType }), filename);
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
        models: p.models,
        imageModels: p.imageModels || p.models,
        imageEditModels: p.imageEditModels || [],
        videoModels: p.videoModels || []
    }));
    res.json(providers);
});

// Generate Endpoint (image / image-edit / video)
app.post('/api/generate', async (req, res) => {
    const {
        provider: providerId, model, prompt, mode,
        size, quality, style, n,
        sourceImageUrl, imageConfig, videoConfig
    } = req.body;

    if (!providerId) return res.status(400).json({ error: 'Missing provider.' });
    const provider = getProvider(providerId);
    if (!provider) return res.status(400).json({ error: `Unknown provider: ${providerId}` });
    if (!model) return res.status(400).json({ error: 'Missing model.' });
    if (!provider.models.includes(model)) return res.status(400).json({ error: `Model "${model}" not available.` });
    if (!prompt) return res.status(400).json({ error: 'Missing prompt.' });

    const genMode = mode || 'text-to-image';

    try {
        console.log(`[Generate] provider=${provider.name} type=${provider.type} model=${model} mode=${genMode}`);

        const result = await callProvider(provider, {
            model, prompt, mode: genMode,
            size, quality, style, n: n || 1,
            sourceImageUrl, imageConfig, videoConfig
        });

        const isVideoResult = result.isVideo || genMode === 'text-to-video' || genMode === 'image-to-video';
        const allUrls = result.allUrls || [result.url];
        const timestamp = new Date().toISOString();
        const records = [];

        for (const mediaUrl of allUrls) {
            // Upload to Chevereto
            let cheveretoUrl = null;
            try {
                cheveretoUrl = await uploadToChevereto(mediaUrl, isVideoResult);
            } catch (e) {
                console.error('Chevereto upload failed', e);
            }

            const id = (isVideoResult ? 'video-gen-' : 'gen-') + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

            if (isVideoResult) {
                const videoRecord = {
                    id, url: cheveretoUrl || mediaUrl, prompt, model,
                    provider: provider.name, providerType: provider.type,
                    sourceImageUrl: sourceImageUrl || null,
                    aspectRatio: videoConfig?.aspect_ratio || null,
                    type: sourceImageUrl ? 'image-to-video' : 'text-to-video',
                    timestamp, hidden: false, source: 'generated'
                };
                addVideoToDb(videoRecord);
                records.push(videoRecord);
            } else {
                const imageRecord = {
                    id, url: cheveretoUrl || mediaUrl,
                    prompt, model,
                    provider: provider.name, providerType: provider.type,
                    size: imageConfig?.size || size || null,
                    quality: quality || null, style: style || null,
                    timestamp, hidden: false,
                };
                addImageToDb(imageRecord);
                records.push(imageRecord);
            }
        }

        res.json(records.length === 1 ? records[0] : { results: records, count: records.length });

    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Image Endpoints ====================

app.get('/api/images', (req, res) => {
    const db = readDb();
    // Return all images (including hidden) — frontend handles display
    res.json(db.images);
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

app.delete('/api/images/:id', (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const initialLength = db.images.length;
    db.images = db.images.filter(img => img.id !== id);
    if (db.images.length === initialLength) {
        return res.status(404).json({ error: 'Image not found' });
    }
    writeDb(db);
    res.json({ success: true });
});

app.patch('/api/images/:id/hide', (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const image = db.images.find(img => img.id === id);
    if (!image) {
        return res.status(404).json({ error: 'Image not found' });
    }
    image.hidden = true;
    writeDb(db);
    res.json({ success: true });
});

app.patch('/api/images/:id/unhide', (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const image = db.images.find(img => img.id === id);
    if (!image) {
        return res.status(404).json({ error: 'Image not found' });
    }
    image.hidden = false;
    writeDb(db);
    res.json({ success: true });
});

// ==================== Video Endpoints ====================

app.get('/api/videos', (req, res) => {
    const db = readDb();
    // Return all videos (including hidden) — frontend handles display
    res.json(db.videos || []);
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

app.delete('/api/videos/:id', (req, res) => {
    const { id } = req.params;
    const db = readDb();
    if (!db.videos) {
        return res.status(404).json({ error: 'Video not found' });
    }
    const initialLength = db.videos.length;
    db.videos = db.videos.filter(v => v.id !== id);
    if (db.videos.length === initialLength) {
        return res.status(404).json({ error: 'Video not found' });
    }
    writeDb(db);
    res.json({ success: true });
});

app.patch('/api/videos/:id/hide', (req, res) => {
    const { id } = req.params;
    const db = readDb();
    if (!db.videos) {
        return res.status(404).json({ error: 'Video not found' });
    }
    const video = db.videos.find(v => v.id === id);
    if (!video) {
        return res.status(404).json({ error: 'Video not found' });
    }
    video.hidden = true;
    writeDb(db);
    res.json({ success: true });
});

app.patch('/api/videos/:id/unhide', (req, res) => {
    const { id } = req.params;
    const db = readDb();
    if (!db.videos) {
        return res.status(404).json({ error: 'Video not found' });
    }
    const video = db.videos.find(v => v.id === id);
    if (!video) {
        return res.status(404).json({ error: 'Video not found' });
    }
    video.hidden = false;
    writeDb(db);
    res.json({ success: true });
});

// ==================== Video Proxy (CORS Fix + Caching) ====================

const VIDEO_CACHE_DIR = path.join(DATA_DIR, 'video-cache');

// Ensure video cache directory exists
if (!fs.existsSync(VIDEO_CACHE_DIR)) {
    fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true });
}

// Simple URL-to-filename mapping (hash the URL for safe filename)
function getCachePath(videoUrl) {
    const hash = crypto.createHash('md5').update(videoUrl).digest('hex');
    return path.join(VIDEO_CACHE_DIR, `${hash}.mp4`);
}

app.get('/api/proxy/video', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    const cachePath = getCachePath(url);

    // Check if video is already cached locally
    if (fs.existsSync(cachePath)) {
        console.log(`[Proxy] Serving from cache: ${cachePath}`);
        const stat = fs.statSync(cachePath);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        fs.createReadStream(cachePath).pipe(res);
        return;
    }

    // Fetch from remote and cache simultaneously
    try {
        console.log(`[Proxy] Fetching and caching video: ${url}`);

        const videoResponse = await fetch(url);

        if (!videoResponse.ok) {
            return res.status(videoResponse.status).json({ error: 'Failed to fetch video' });
        }

        // Stream to client AND save to cache
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', videoResponse.headers.get('content-length') || '');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Pipe to both response and file system
        const fileWriteStream = fs.createWriteStream(cachePath);
        videoResponse.body.pipe(res);
        videoResponse.body.pipe(fileWriteStream);

        videoResponse.body.on('end', () => {
            console.log(`[Proxy] Video cached: ${cachePath}`);
        });

        videoResponse.body.on('error', (err) => {
            console.error('[Proxy] Cache write error:', err);
            // Clean up partial file
            if (fs.existsSync(cachePath)) {
                fs.unlinkSync(cachePath);
            }
        });

    } catch (error) {
        console.error('[Proxy] Video fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Image Upload ====================

app.post('/api/upload', async (req, res) => {
    try {
        const { imageData } = req.body;

        if (!imageData) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const filename = `upload-${Date.now()}.png`;
        const mockUrl = `data:image/png;base64,${base64Data}`;

        res.json({ url: mockUrl, filename });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Server Startup ====================

app.listen(PORT, () => {
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
            if (p.type === 'grok2api') {
                if (p.imageModels.length) console.log(`     Image: ${p.imageModels.join(', ')}`);
                if (p.imageEditModels.length) console.log(`     Edit:  ${p.imageEditModels.join(', ')}`);
                if (p.videoModels.length) console.log(`     Video: ${p.videoModels.join(', ')}`);
            } else {
                console.log(`     Models: ${p.models.join(', ')}`);
            }
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
});
