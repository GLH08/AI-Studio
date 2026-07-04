// ==================== Elements ====================
const $ = id => document.getElementById(id);
const generateBtn = $('generateBtn'), addManualBtn = $('addManualBtn'), addVideoBtn = $('addVideoBtn');
const previewArea = $('preview-area'), emptyState = $('empty-state'), loading = $('loading');
const galleryGrid = $('gallery-grid'), collectionGallery = $('collection-gallery'), videoGallery = $('video-gallery');

let providersData = [];

// ==================== Image Proxy Helper ====================
function getImageProxyUrl(url) {
    if (!url) return '';
    // If already a proxy URL or data URI, use as-is
    if (url.startsWith('/api/proxy/') || url.startsWith('data:')) return url;
    // Otherwise wrap with image proxy
    return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}

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
    updateModels();
    updateControls();
}

function getSelectedProvider() {
    const id = $('provider').value;
    return providersData.find(p => p.id === id);
}

function updateModels() {
    const provider = getSelectedProvider();
    const sel = $('model');
    if (!provider) { sel.innerHTML = '<option value="">—</option>'; return; }
    sel.innerHTML = provider.models.map(m => `<option value="${m}">${m}</option>`).join('');
}

function updateControls() {
    const provider = getSelectedProvider();
    const type = provider?.type || '';
    const isOpenAI = type === 'openai';

    // OpenAI standard controls
    $('control-size').classList.toggle('hidden', !isOpenAI);
    $('control-quality').classList.toggle('hidden', !isOpenAI);
    $('control-style').classList.toggle('hidden', !isOpenAI);
}

$('provider').addEventListener('change', onProviderChange);
$('model').addEventListener('change', updateControls);

// ==================== Generate ====================
generateBtn.addEventListener('click', async () => {
    const provider = $('provider').value, model = $('model').value, prompt = $('prompt').value.trim();
    if (!provider) { alert('Please select a provider'); return; }
    if (!model) { alert('Please select a model'); return; }
    if (!prompt) { alert('Please enter a prompt'); return; }

    generateBtn.disabled = true;
    loading.classList.remove('hidden');
    emptyState.classList.add('hidden');
    previewArea.querySelector('.result-card')?.remove();

    try {
        const payload = { provider, model, prompt, mode: 'text-to-image' };
        const size = $('size').value; if (size) payload.size = size;
        const quality = $('quality').value; if (quality) payload.quality = quality;
        const style = $('style').value; if (style) payload.style = style;

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

        loadGallery();

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
    const url = data.url;
    const isVideo = data.type === 'text-to-video' || data.type === 'image-to-video' || /\.(mp4|webm)(\?|$)/i.test(url);
    const imageSrc = getImageProxyUrl(url);
    const card = document.createElement('div');
    card.className = 'result-card glass-card w-full h-full flex flex-col animate-fade-in';

    // For videos: if URL is already a proxy URL, use it directly; otherwise wrap with proxy
    const videoSrc = isVideo ? (url.startsWith('/api/proxy') ? url : `/api/proxy/video?url=${encodeURIComponent(url)}`) : url;
    const mediaHtml = isVideo
        ? `<video controls autoplay class="max-w-full max-h-[400px] rounded-xl" style="box-shadow: var(--shadow-glass);" src="${videoSrc}"></video>`
        : `<img src="${imageSrc}" alt="Generated" class="max-w-full max-h-[400px] object-contain rounded-xl cursor-pointer" style="box-shadow: var(--shadow-glass);">`;

    // "Open" should link to original URL, not proxy
    card.innerHTML = `
        <div class="flex-1 flex items-center justify-center p-6" style="background: var(--bg-primary);">
            ${mediaHtml}
        </div>
        <div class="p-5 space-y-3" style="border-top: 1px solid var(--glass-border);">
            <div class="flex flex-wrap gap-2">
                <span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(139,92,246,0.2); color: #8B5CF6;">${escapeHtml(data.model)}</span>
                ${data.provider ? `<span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(6,182,212,0.2); color: #06B6D4;">${escapeHtml(data.provider)}</span>` : ''}
                ${isVideo ? '<span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(236,72,153,0.2); color: #EC4899;">Video</span>' : ''}
            </div>
            <p class="text-sm line-clamp-2" style="color: var(--text-secondary);">${escapeHtml(data.prompt)}</p>
            <div class="flex gap-2">
                <button class="copy-btn action-btn flex-1 h-10 text-sm cursor-pointer flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>Copy
                </button>
                <a href="${url}" target="_blank" class="action-btn flex-1 h-10 text-sm flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>Open
                </a>
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
    galleryGrid.innerHTML = '<div class="col-span-full flex justify-center py-20"><div class="spinner w-10 h-10 animate-spin"></div></div>';
    try {
        const res = await fetch('/api/images');
        if (res.status === 401) { location.href = '/login.html'; return; }
        const images = (await res.json()).filter(i => i.source !== 'manual');
        galleryGrid.innerHTML = images.length ? '' : '<p class="col-span-full text-center py-20" style="color: var(--text-tertiary);">No images yet</p>';
        images.forEach(img => renderCard(img, galleryGrid, 'image'));
    } catch { galleryGrid.innerHTML = '<p class="col-span-full text-center py-20" style="color: #EF4444;">Failed to load</p>'; }
}

async function loadCollection() {
    collectionGallery.innerHTML = '<div class="col-span-full flex justify-center py-20"><div class="spinner w-10 h-10 animate-spin"></div></div>';
    try {
        const res = await fetch('/api/images');
        if (res.status === 401) { location.href = '/login.html'; return; }
        const images = (await res.json()).filter(i => i.source === 'manual');
        collectionGallery.innerHTML = images.length ? '' : '<p class="col-span-full text-center py-20" style="color: var(--text-tertiary);">No collection yet</p>';
        images.forEach(img => renderCard(img, collectionGallery, 'image'));
    } catch { collectionGallery.innerHTML = '<p class="col-span-full text-center py-20" style="color: #EF4444;">Failed to load</p>'; }
}

async function loadVideos() {
    videoGallery.innerHTML = '<div class="col-span-full flex justify-center py-20"><div class="spinner w-10 h-10 animate-spin"></div></div>';
    try {
        const res = await fetch('/api/videos');
        if (res.status === 401) { location.href = '/login.html'; return; }
        const videos = await res.json();
        videoGallery.innerHTML = videos.length ? '' : '<p class="col-span-full text-center py-20" style="color: var(--text-tertiary);">No videos yet</p>';
        videos.forEach(v => renderCard(v, videoGallery, 'video'));
    } catch { videoGallery.innerHTML = '<p class="col-span-full text-center py-20" style="color: #EF4444;">Failed to load</p>'; }
}

// ==================== Unified Card Renderer ====================
function renderCard(data, container, type) {
    const url = data.url;
    const date = new Date(data.timestamp);
    const isHidden = data.hidden;
    const hasImageExt = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);
    const hasVideoExt = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    const isVideo = hasVideoExt || (type === 'video' && !hasImageExt);
    const typeLabel = data.type === 'text-to-video' ? 'T2V' : data.type === 'image-to-video' ? 'I2V' : '';

    const card = document.createElement('div');
    card.className = `group glass-card cursor-pointer animate-fade-in ${isHidden ? 'card-hidden' : ''}`;
    card.id = `card-${data.id}`;

    const videoSrc = isVideo ? (url.startsWith('/api/proxy') ? url : `/api/proxy/video?url=${encodeURIComponent(url)}`) : url;
    const imageSrc = getImageProxyUrl(url);
    const mediaHtml = isVideo
        ? `<div class="relative card-image" style="background: #000;">${typeLabel ? `<span class="absolute top-3 left-3 z-10 px-2 py-1 text-[10px] font-bold rounded" style="background: linear-gradient(135deg, #007AFF 0%, #BF5AF2 100%); color: white;">${typeLabel}</span>` : ''}<video controls preload="metadata" class="w-full aspect-video object-contain" src="${videoSrc}"></video></div>`
        : `<div class="aspect-square overflow-hidden relative" style="background: var(--bg-primary);"><img src="${imageSrc}" alt="Image" loading="lazy" class="card-image w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"><div class="card-hidden-badge hidden absolute inset-0 items-center justify-center" style="background: rgba(0,0,0,0.6);"><span class="px-3 py-1.5 rounded-lg text-xs" style="color: var(--text-secondary);">Hidden</span></div></div>`;

    // Source image info for generated media (I2V or Image-Edit)
    const sourceImageHtml = (data.sourceImageUrl)
        ? `<div class="flex items-center gap-1.5 mt-1"><span class="text-[10px]" style="color: var(--text-tertiary);">Source:</span><a href="${escapeHtml(data.sourceImageUrl)}" target="_blank" class="source-link text-[10px] truncate max-w-[180px] inline-block" style="color: #06B6D4;" title="${escapeHtml(data.sourceImageUrl)}">${escapeHtml(data.sourceImageUrl.split('/').pop().substring(0, 30))}</a></div>`
        : '';

    card.innerHTML = `
        ${mediaHtml}
        <div class="p-4 space-y-3">
            <div class="flex flex-wrap gap-1.5">
                <span class="px-2 py-0.5 text-[10px] font-medium rounded" style="background: rgba(139,92,246,0.2); color: #8B5CF6;">${escapeHtml(data.model || 'Unknown')}</span>
                ${data.provider ? `<span class="px-2 py-0.5 text-[10px] font-medium rounded" style="background: rgba(6,182,212,0.2); color: #06B6D4;">${escapeHtml(data.provider)}</span>` : ''}
                ${data.aspectRatio ? `<span class="px-2 py-0.5 text-[10px] font-medium rounded" style="background: var(--glass-bg); color: var(--text-secondary);">${escapeHtml(data.aspectRatio)}</span>` : ''}
            </div>
            ${data.prompt ? `<p class="text-xs line-clamp-2" style="color: var(--text-tertiary);">${escapeHtml(data.prompt)}</p>` : ''}
            ${sourceImageHtml}
            <div class="flex items-center justify-between pt-2" style="border-top: 1px solid var(--glass-border);">
                <span class="text-[10px]" style="color: var(--text-tertiary);">${date.toLocaleDateString('zh-CN')}</span>
                <div class="flex gap-1">
                    ${data.prompt ? '<button class="copy-btn action-btn w-8 h-8 flex items-center justify-center cursor-pointer" title="Copy Prompt"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>' : ''}
                    <a href="${url}" target="_blank" class="open-btn action-btn w-8 h-8 flex items-center justify-center" title="Open in New Tab"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg></a>
                    <button class="hide-btn action-btn w-8 h-8 flex items-center justify-center cursor-pointer" title="${isHidden ? 'Unhide' : 'Hide'}"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${isHidden ? '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>' : '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>'}</svg></button>
                    <button class="delete-btn action-btn w-8 h-8 flex items-center justify-center cursor-pointer" title="Delete" style="--glass-bg: rgba(239,68,68,0.1);"><svg class="w-4 h-4" style="color: #EF4444;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
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
async function toggleHide(id, currentlyHidden, type, _cardEl) {
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
    } catch { alert('Error toggling visibility'); }
}

// ==================== Lightbox ====================
function openLightbox(data) {
    const lb = $('lightbox');
    const mediaContainer = $('lightbox-media');
    const url = data.displayUrl || data.url;

    const videoSrc = data.isVideo ? (url.startsWith('/api/proxy') ? url : `/api/proxy/video?url=${encodeURIComponent(url)}`) : null;
    const imageSrc = data.isVideo ? null : getImageProxyUrl(url);
    if (data.isVideo) {
        mediaContainer.innerHTML = `<video controls autoplay class="max-w-full max-h-[70vh] rounded-t-2xl"><source src="${videoSrc}" type="video/mp4"></video>`;
    } else {
        mediaContainer.innerHTML = `<img src="${imageSrc}" alt="Preview" class="max-w-full max-h-[70vh] object-contain rounded-t-2xl">`;
    }

    const tagsHtml = `
        <span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(139,92,246,0.2); color: #8B5CF6;">${escapeHtml(data.model || 'Unknown')}</span>
        ${data.provider ? `<span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(6,182,212,0.2); color: #06B6D4;">${escapeHtml(data.provider)}</span>` : ''}
        ${data.aspectRatio ? `<span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${escapeHtml(data.aspectRatio)}</span>` : ''}
        ${data.size ? `<span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${escapeHtml(data.size)}</span>` : ''}
        ${data.type ? `<span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(236,72,153,0.2); color: #EC4899;">${escapeHtml(data.type)}</span>` : ''}
        <span class="px-3 py-1 text-xs font-medium rounded-full" style="background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6);">${new Date(data.timestamp).toLocaleString('zh-CN')}</span>
    `;
    $('lightbox-tags').innerHTML = tagsHtml;

    $('lightbox-prompt').textContent = data.prompt || '(no prompt)';
    // "Open Original" should link to the original URL, not the proxy
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
        toast.className = 'toast fixed bottom-6 right-6 px-5 py-3 shadow-lg z-[60] animate-fade-in flex items-center gap-2';
        toast.innerHTML = '<svg class="w-4 h-4" style="color: #10B981;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Copied!</span>';
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
        } catch {
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
    } catch { alert('Error'); }
}

async function deleteVideo(id) {
    if (!confirm('Delete this video?')) return;
    try {
        const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
        if (res.ok) loadVideos();
    } catch { alert('Error'); }
}

// ==================== Init ====================
loadProviders();
