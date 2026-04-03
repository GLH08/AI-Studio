// ==================== Elements ====================
const $ = id => document.getElementById(id);
const generateBtn = $('generateBtn'), addManualBtn = $('addManualBtn'), addVideoBtn = $('addVideoBtn');
const previewArea = $('preview-area'), emptyState = $('empty-state'), loading = $('loading');
const galleryGrid = $('gallery-grid'), collectionGallery = $('collection-gallery'), videoGallery = $('video-gallery');

let providersData = [];
let currentMode = 'text-to-image';

// ==================== Navigation ====================
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const view = $(`${tab}-view`);
    if (view) { view.classList.remove('hidden'); view.classList.add('animate-fade-in'); }
    if (tab === 'gallery') loadGallery();
    else if (tab === 'collection') loadCollection();
    else if (tab === 'video') loadVideos();
}

// ==================== Provider & Model Loading ====================
async function loadProviders() {
    try {
        const res = await fetch('/api/providers');
        if (res.status === 401) { location.href = '/login.html'; return; }
        providersData = await res.json();
        const sel = $('provider');
        sel.innerHTML = providersData.length
            ? providersData.map(p => `<option value="${p.id}">${escapeHtml(p.name)} [${p.type}]</option>`).join('')
            : '<option value="">No providers configured</option>';
        onProviderChange();
    } catch (e) {
        console.error('Failed to load providers:', e);
    }
}

function onProviderChange() {
    const provider = getSelectedProvider();
    const isGrok = provider?.type === 'grok2api';

    // Show/hide mode tabs
    $('mode-tabs').classList.toggle('hidden', !isGrok);

    // Build mode tab visibility based on available models
    if (isGrok) {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            const mode = btn.dataset.mode;
            let show = false;
            if (mode === 'text-to-image') show = (provider.imageModels?.length > 0);
            else if (mode === 'image-edit') show = (provider.imageEditModels?.length > 0);
            else if (mode === 'text-to-video' || mode === 'image-to-video') show = (provider.videoModels?.length > 0);
            btn.classList.toggle('hidden', !show);
        });
        // Default to first available mode
        const visibleModes = [...document.querySelectorAll('.mode-btn:not(.hidden)')];
        if (visibleModes.length > 0 && !visibleModes.find(b => b.dataset.mode === currentMode)) {
            setMode(visibleModes[0].dataset.mode);
        } else {
            setMode(currentMode);
        }
    } else {
        currentMode = 'text-to-image';
        updateModels();
        updateControls();
    }
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('bg-gradient-to-r', btn.dataset.mode === mode);
        btn.classList.toggle('from-aurora-purple', btn.dataset.mode === mode);
        btn.classList.toggle('to-aurora-pink', btn.dataset.mode === mode);
        btn.classList.toggle('text-white', btn.dataset.mode === mode);
        btn.classList.toggle('text-zinc-400', btn.dataset.mode !== mode);
    });
    updateModels();
    updateControls();
}

document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

function getSelectedProvider() {
    const id = $('provider').value;
    return providersData.find(p => p.id === id);
}

function updateModels() {
    const provider = getSelectedProvider();
    const sel = $('model');
    if (!provider) { sel.innerHTML = '<option value="">—</option>'; return; }

    let models = provider.models;
    if (provider.type === 'grok2api') {
        if (currentMode === 'text-to-image') models = provider.imageModels || [];
        else if (currentMode === 'image-edit') models = provider.imageEditModels || [];
        else models = provider.videoModels || [];
    }
    sel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
}

function updateControls() {
    const provider = getSelectedProvider();
    const type = provider?.type || '';
    const isGrok = type === 'grok2api';
    const isOpenAI = type === 'openai';
    const isImageMode = currentMode === 'text-to-image' || currentMode === 'image-edit';
    const isVideoMode = currentMode === 'text-to-video' || currentMode === 'image-to-video';
    const needsSourceImage = currentMode === 'image-edit' || currentMode === 'image-to-video';

    // OpenAI standard controls
    $('control-size').classList.toggle('hidden', !isOpenAI);
    $('control-quality').classList.toggle('hidden', !isOpenAI);
    $('control-style').classList.toggle('hidden', !isOpenAI);

    // Grok2API image controls
    $('control-grok-size').classList.toggle('hidden', !(isGrok && isImageMode));
    $('control-grok-n').classList.toggle('hidden', !(isGrok && isImageMode));

    // Grok2API video controls
    $('control-video-ratio').classList.toggle('hidden', !(isGrok && isVideoMode));
    $('control-video-duration').classList.toggle('hidden', !(isGrok && isVideoMode));
    $('control-video-resolution').classList.toggle('hidden', !(isGrok && isVideoMode));
    $('control-video-preset').classList.toggle('hidden', !(isGrok && isVideoMode));

    // Source image
    $('control-source-image').classList.toggle('hidden', !(isGrok && needsSourceImage));
}

$('provider').addEventListener('change', onProviderChange);
$('model').addEventListener('change', updateControls);

// Video duration slider
// video duration event listener removed as it is now a select

// ==================== Generate ====================
generateBtn.addEventListener('click', async () => {
    const provider = $('provider').value, model = $('model').value, prompt = $('prompt').value.trim();
    if (!provider) { alert('Please select a provider'); return; }
    if (!model) { alert('Please select a model'); return; }
    if (!prompt) { alert('Please enter a prompt'); return; }

    const providerObj = getSelectedProvider();
    const isGrok = providerObj?.type === 'grok2api';
    const needsSourceImage = currentMode === 'image-edit' || currentMode === 'image-to-video';

    if (isGrok && needsSourceImage) {
        const srcUrl = $('source-image-url').value.trim();
        if (!srcUrl) { alert('Please enter a source image URL'); return; }
    }

    generateBtn.disabled = true;
    loading.classList.remove('hidden');
    emptyState.classList.add('hidden');
    previewArea.querySelector('.result-card')?.remove();

    try {
        const payload = { provider, model, prompt, mode: isGrok ? currentMode : 'text-to-image' };

        if (isGrok) {
            const isImageMode = currentMode === 'text-to-image' || currentMode === 'image-edit';
            const isVideoMode = currentMode === 'text-to-video' || currentMode === 'image-to-video';

            if (isImageMode) {
                payload.imageConfig = { size: $('grok-size').value, n: parseInt($('grok-n').value) };
            }
            if (isVideoMode) {
                payload.videoConfig = {
                    aspect_ratio: $('video-ratio').value,
                    video_length: parseInt($('video-duration').value),
                    resolution_name: $('video-resolution').value,
                    preset: $('video-preset').value
                };
            }
            if (needsSourceImage) {
                payload.sourceImageUrl = $('source-image-url').value.trim();
            }
        } else {
            const size = $('size').value; if (size) payload.size = size;
            const quality = $('quality').value; if (quality) payload.quality = quality;
            const style = $('style').value; if (style) payload.style = style;
        }

        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            if (res.status === 401) { location.href = '/login.html'; return; }
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                const e = await res.json();
                throw new Error(e.error || `Request failed: ${res.status}`);
            }
            throw new Error(`Server error: ${res.status}`);
        }

        const data = await res.json();

        // Handle multi-result (n > 1)
        if (data.results) {
            data.results.forEach(r => renderPreview(r));
        } else {
            renderPreview(data);
        }

        // Reload relevant gallery
        const isVideoResult = currentMode === 'text-to-video' || currentMode === 'image-to-video';
        if (isVideoResult) loadVideos();
        else loadGallery();

    } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
        emptyState.classList.remove('hidden');
    } finally {
        generateBtn.disabled = false;
        loading.classList.add('hidden');
    }
});

function renderPreview(data) {
    const url = data.lskyUrl || data.url;
    const isVideo = data.type === 'text-to-video' || data.type === 'image-to-video' || /\.(mp4|webm)(\?|$)/i.test(url);
    const card = document.createElement('div');
    card.className = 'result-card w-full h-full flex flex-col animate-fade-in';

    const videoSrc = isVideo ? `/api/proxy/video?url=${encodeURIComponent(url)}` : url;
    const mediaHtml = isVideo
        ? `<video controls autoplay class="max-w-full max-h-[400px] rounded-xl shadow-2xl" src="${videoSrc}"></video>`
        : `<img src="${url}" alt="Generated" class="max-w-full max-h-[400px] object-contain rounded-xl shadow-2xl cursor-pointer">`;

    card.innerHTML = `
        <div class="flex-1 flex items-center justify-center p-4 bg-dark-900/50">
            ${mediaHtml}
        </div>
        <div class="p-4 border-t border-white/5 space-y-3">
            <div class="flex flex-wrap gap-2">
                <span class="px-3 py-1 text-xs font-medium bg-aurora-purple/20 text-aurora-purple rounded-full">${escapeHtml(data.model)}</span>
                ${data.provider ? `<span class="px-3 py-1 text-xs font-medium bg-aurora-cyan/20 text-aurora-cyan rounded-full">${escapeHtml(data.provider)}</span>` : ''}
                ${isVideo ? '<span class="px-3 py-1 text-xs font-medium bg-aurora-pink/20 text-aurora-pink rounded-full">Video</span>' : ''}
            </div>
            <p class="text-sm text-zinc-400 line-clamp-2">${escapeHtml(data.prompt)}</p>
            <div class="flex gap-2">
                <button class="copy-btn flex-1 h-10 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm cursor-pointer transition-colors">Copy Prompt</button>
                <a href="${url}" target="_blank" class="flex-1 h-10 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm flex items-center justify-center transition-colors">Open</a>
            </div>
        </div>
    `;
    if (!isVideo) {
        card.querySelector('img').addEventListener('click', () => openLightbox({ ...data, displayUrl: url }));
    }
    card.querySelector('.copy-btn').addEventListener('click', () => copyToClipboard(data.prompt));
    previewArea.appendChild(card);
}

// ==================== Manual Collection ====================
addManualBtn.addEventListener('click', async () => {
    const url = $('manual-url').value.trim(), prompt = $('manual-prompt').value.trim();
    const model = $('manual-model').value.trim(), aspectRatio = $('manual-aspect').value;
    if (!url || !prompt) { alert('Please enter URL and prompt'); return; }
    addManualBtn.disabled = true;
    try {
        const res = await fetch('/api/images/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, prompt, model, aspectRatio }) });
        if (!res.ok) { if (res.status === 401) { location.href = '/login.html'; return; } throw new Error((await res.json()).error); }
        $('manual-url').value = ''; $('manual-prompt').value = ''; $('manual-model').value = ''; $('manual-aspect').value = '';
        loadCollection(); alert('Added!');
    } catch (e) { alert('Error: ' + e.message); }
    finally { addManualBtn.disabled = false; }
});

// ==================== Video ====================
addVideoBtn.addEventListener('click', async () => {
    const type = $('video-type').value, url = $('video-url').value.trim();
    const sourceImageUrl = $('video-source-image').value.trim(), prompt = $('video-prompt').value.trim();
    const model = $('video-model').value.trim(), aspectRatio = $('video-aspect').value;
    if (!url) { alert('Please enter video URL'); return; }
    if (type === 'text-to-video' && !prompt) { alert('Please enter prompt'); return; }
    if (type === 'image-to-video' && !sourceImageUrl) { alert('Please enter source image'); return; }
    addVideoBtn.disabled = true;
    try {
        const endpoint = type === 'text-to-video' ? '/api/videos/text-to-video' : '/api/videos/image-to-video';
        const payload = type === 'text-to-video' ? { url, prompt, model, aspectRatio } : { url, sourceImageUrl, prompt, model, aspectRatio };
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) { if (res.status === 401) { location.href = '/login.html'; return; } throw new Error((await res.json()).error); }
        $('video-url').value = ''; $('video-source-image').value = ''; $('video-prompt').value = ''; $('video-model').value = ''; $('video-aspect').value = '';
        loadVideos(); alert('Added!');
    } catch (e) { alert('Error: ' + e.message); }
    finally { addVideoBtn.disabled = false; }
});

// ==================== Load Functions ====================
async function loadGallery() {
    galleryGrid.innerHTML = '<div class="col-span-full flex justify-center py-20"><div class="w-10 h-10 rounded-full border-2 border-aurora-purple/20 border-t-aurora-purple animate-spin"></div></div>';
    try {
        const res = await fetch('/api/images');
        if (res.status === 401) { location.href = '/login.html'; return; }
        const images = (await res.json()).filter(i => i.source !== 'manual');
        galleryGrid.innerHTML = images.length ? '' : '<p class="col-span-full text-center text-zinc-500 py-20">No images yet</p>';
        images.forEach(img => renderCard(img, galleryGrid, 'image'));
    } catch (e) { galleryGrid.innerHTML = '<p class="col-span-full text-center text-red-400 py-20">Failed to load</p>'; }
}

async function loadCollection() {
    collectionGallery.innerHTML = '<div class="col-span-full flex justify-center py-20"><div class="w-10 h-10 rounded-full border-2 border-aurora-purple/20 border-t-aurora-purple animate-spin"></div></div>';
    try {
        const res = await fetch('/api/images');
        if (res.status === 401) { location.href = '/login.html'; return; }
        const images = (await res.json()).filter(i => i.source === 'manual');
        collectionGallery.innerHTML = images.length ? '' : '<p class="col-span-full text-center text-zinc-500 py-20">No collection yet</p>';
        images.forEach(img => renderCard(img, collectionGallery, 'image'));
    } catch (e) { collectionGallery.innerHTML = '<p class="col-span-full text-center text-red-400 py-20">Failed to load</p>'; }
}

async function loadVideos() {
    videoGallery.innerHTML = '<div class="col-span-full flex justify-center py-20"><div class="w-10 h-10 rounded-full border-2 border-aurora-purple/20 border-t-aurora-purple animate-spin"></div></div>';
    try {
        const res = await fetch('/api/videos');
        if (res.status === 401) { location.href = '/login.html'; return; }
        const videos = await res.json();
        videoGallery.innerHTML = videos.length ? '' : '<p class="col-span-full text-center text-zinc-500 py-20">No videos yet</p>';
        videos.forEach(v => renderCard(v, videoGallery, 'video'));
    } catch (e) { videoGallery.innerHTML = '<p class="col-span-full text-center text-red-400 py-20">Failed to load</p>'; }
}

// ==================== Unified Card Renderer ====================
function renderCard(data, container, type) {
    const url = data.lskyUrl || data.url;
    const date = new Date(data.timestamp);
    const isHidden = data.hidden;
    const hasImageExt = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);
    const hasVideoExt = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    const isVideo = hasVideoExt || (type === 'video' && !hasImageExt);
    const typeLabel = data.type === 'text-to-video' ? 'T2V' : data.type === 'image-to-video' ? 'I2V' : '';

    const card = document.createElement('div');
    card.className = `group bg-dark-800/50 rounded-2xl border border-white/5 overflow-hidden card-hover cursor-pointer animate-fade-in ${isHidden ? 'card-hidden' : ''}`;
    card.id = `card-${data.id}`;

    const videoSrc = isVideo ? `/api/proxy/video?url=${encodeURIComponent(url)}` : url;
    const mediaHtml = isVideo
        ? `<div class="relative bg-black card-image">${typeLabel ? `<span class="absolute top-3 left-3 z-10 px-2 py-1 text-[10px] font-bold bg-gradient-to-r from-aurora-purple to-aurora-pink text-white rounded">${typeLabel}</span>` : ''}<video controls preload="metadata" class="w-full aspect-video object-contain" src="${videoSrc}"></video></div>`
        : `<div class="aspect-square overflow-hidden bg-dark-900 relative"><img src="${url}" alt="Image" loading="lazy" class="card-image w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"><div class="card-hidden-badge hidden absolute inset-0 items-center justify-center"><span class="px-3 py-1.5 bg-black/60 rounded-lg text-xs text-zinc-300">Hidden</span></div></div>`;

    // Source image info for generated media (I2V or Image-Edit)
    const sourceImageHtml = (data.sourceImageUrl) 
        ? `<div class="flex items-center gap-1.5 mt-1"><span class="text-[10px] text-zinc-500">Source:</span><a href="${escapeHtml(data.sourceImageUrl)}" target="_blank" class="source-link text-[10px] text-aurora-cyan hover:text-aurora-cyan/80 truncate max-w-[180px] inline-block" title="${escapeHtml(data.sourceImageUrl)}">${escapeHtml(data.sourceImageUrl.split('/').pop().substring(0, 30))}</a></div>`
        : '';

    card.innerHTML = `
        ${mediaHtml}
        <div class="p-4 space-y-3">
            <div class="flex flex-wrap gap-1.5">
                <span class="px-2 py-0.5 text-[10px] font-medium bg-aurora-purple/20 text-aurora-purple rounded">${escapeHtml(data.model || 'Unknown')}</span>
                ${data.provider ? `<span class="px-2 py-0.5 text-[10px] font-medium bg-aurora-cyan/20 text-aurora-cyan rounded">${escapeHtml(data.provider)}</span>` : ''}
                ${data.aspectRatio ? `<span class="px-2 py-0.5 text-[10px] font-medium bg-white/10 text-zinc-400 rounded">${escapeHtml(data.aspectRatio)}</span>` : ''}
            </div>
            ${data.prompt ? `<p class="text-xs text-zinc-500 line-clamp-2">${escapeHtml(data.prompt)}</p>` : ''}
            ${sourceImageHtml}
            <div class="flex items-center justify-between pt-2 border-t border-white/5">
                <span class="text-[10px] text-zinc-600">${date.toLocaleDateString('zh-CN')}</span>
                <div class="flex gap-1">
                    ${data.prompt ? `<button class="copy-btn w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer" title="Copy Prompt"><svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg></button>` : ''}
                    <a href="${url}" target="_blank" class="open-btn w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors" title="Open in New Tab"><svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg></a>
                    <button class="hide-btn w-8 h-8 rounded-lg ${isHidden ? 'bg-aurora-purple/20 hover:bg-aurora-purple/30' : 'bg-white/5 hover:bg-white/10'} flex items-center justify-center transition-colors cursor-pointer" title="${isHidden ? 'Unhide' : 'Hide'}"><svg class="w-4 h-4 ${isHidden ? 'text-aurora-purple' : 'text-zinc-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="${isHidden ? 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z' : 'M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88'}"/></svg></button>
                    <button class="delete-btn w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center transition-colors cursor-pointer" title="Delete"><svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg></button>
                </div>
            </div>
        </div>
    `;

    // Event listeners — all with stopPropagation to prevent card click
    const copyBtn = card.querySelector('.copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); copyToClipboard(data.prompt); });

    card.querySelector('.open-btn').addEventListener('click', (e) => { e.stopPropagation(); });

    const sourceLink = card.querySelector('.source-link');
    if (sourceLink) sourceLink.addEventListener('click', (e) => { e.stopPropagation(); });

    card.querySelector('.hide-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleHide(data.id, isHidden, type, card);
    });

    card.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (type === 'video') deleteVideo(data.id);
        else deleteImage(data.id);
    });

    // Click card to open lightbox
    card.addEventListener('click', () => {
        openLightbox({ ...data, displayUrl: url, isVideo: isVideo });
    });

    container.appendChild(card);
}

// ==================== Hide / Unhide ====================
async function toggleHide(id, currentlyHidden, type, cardEl) {
    const endpoint = type === 'video'
        ? `/api/videos/${id}/${currentlyHidden ? 'unhide' : 'hide'}`
        : `/api/images/${id}/${currentlyHidden ? 'unhide' : 'hide'}`;
    try {
        const res = await fetch(endpoint, { method: 'PATCH' });
        if (!res.ok) throw new Error('Failed');
        // Reload the relevant section
        if (type === 'video') loadVideos();
        else {
            loadGallery();
            loadCollection();
        }
    } catch (e) { alert('Error toggling visibility'); }
}

// ==================== Lightbox ====================
function openLightbox(data) {
    const lb = $('lightbox');
    const mediaContainer = $('lightbox-media');
    const url = data.displayUrl || data.lskyUrl || data.url;

    if (data.isVideo) {
        const videoSrc = `/api/proxy/video?url=${encodeURIComponent(url)}`;
        mediaContainer.innerHTML = `<video controls autoplay class="max-w-full max-h-[70vh] rounded-t-2xl"><source src="${videoSrc}" type="video/mp4"></video>`;
    } else {
        mediaContainer.innerHTML = `<img src="${url}" alt="Preview" class="max-w-full max-h-[70vh] object-contain rounded-t-2xl">`;
    }

    let tagsHtml = `
        <span class="px-3 py-1 text-xs font-medium bg-aurora-purple/20 text-aurora-purple rounded-full">${escapeHtml(data.model || 'Unknown')}</span>
        ${data.provider ? `<span class="px-3 py-1 text-xs font-medium bg-aurora-cyan/20 text-aurora-cyan rounded-full">${escapeHtml(data.provider)}</span>` : ''}
        ${data.aspectRatio ? `<span class="px-3 py-1 text-xs font-medium bg-white/10 text-zinc-300 rounded-full">${escapeHtml(data.aspectRatio)}</span>` : ''}
        ${data.size ? `<span class="px-3 py-1 text-xs font-medium bg-white/10 text-zinc-300 rounded-full">${escapeHtml(data.size)}</span>` : ''}
        ${data.type ? `<span class="px-3 py-1 text-xs font-medium bg-aurora-pink/20 text-aurora-pink rounded-full">${escapeHtml(data.type)}</span>` : ''}
        <span class="px-3 py-1 text-xs font-medium bg-white/10 text-zinc-300 rounded-full">${new Date(data.timestamp).toLocaleString('zh-CN')}</span>
    `;
    $('lightbox-tags').innerHTML = tagsHtml;

    $('lightbox-prompt').textContent = data.prompt || '(no prompt)';
    $('lightbox-open').href = url;

    // Show source image link for I2V videos
    let sourceHtml = '';
    if (data.sourceImageUrl) {
        sourceHtml = `<div class="mt-3"><label class="text-xs text-zinc-500 uppercase tracking-wider">Source Image</label><div class="mt-1"><a href="${escapeHtml(data.sourceImageUrl)}" target="_blank" class="text-sm text-aurora-cyan hover:underline break-all">${escapeHtml(data.sourceImageUrl)}</a></div></div>`;
    }
    // Insert after prompt
    const existingSource = $('lightbox').querySelector('.lightbox-source');
    if (existingSource) existingSource.remove();
    if (sourceHtml) {
        const div = document.createElement('div');
        div.className = 'lightbox-source';
        div.innerHTML = sourceHtml;
        $('lightbox-prompt').parentElement.after(div);
    }

    lb.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    $('lightbox').classList.add('hidden');
    document.body.style.overflow = '';
}

$('lightbox-overlay').addEventListener('click', closeLightbox);
$('lightbox-close').addEventListener('click', closeLightbox);
$('lightbox-copy').addEventListener('click', () => {
    copyToClipboard($('lightbox-prompt').textContent);
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
});

// ==================== Utilities ====================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyToClipboard(text) {
    function showToast() {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-4 right-4 bg-aurora-purple text-white px-4 py-2 rounded-lg shadow-lg z-[60] animate-fade-in';
        toast.textContent = 'Copied!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 1500);
    }

    // Try modern clipboard API first, fall back to execCommand for HTTP sites
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(showToast).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }

    function fallbackCopy(t) {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showToast();
        } catch (e) {
            alert('Copy failed');
        }
        document.body.removeChild(ta);
    }
}

async function deleteImage(id) {
    if (!confirm('Delete this image?')) return;
    try {
        const res = await fetch(`/api/images/${id}`, { method: 'DELETE' });
        if (res.ok) { loadGallery(); loadCollection(); }
    } catch (e) { alert('Error'); }
}

async function deleteVideo(id) {
    if (!confirm('Delete this video?')) return;
    try {
        const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
        if (res.ok) loadVideos();
    } catch (e) { alert('Error'); }
}

// ==================== Init ====================
loadProviders();
