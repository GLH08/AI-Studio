#!/usr/bin/env node

/**
 * Configuration Validation Script for AI Studio
 */

console.log('🔍 Validating configuration...\n');

const errors = [];
const warnings = [];

// Check providers
let providerCount = 0;
for (let i = 1; i <= 10; i++) {
    const name = process.env[`PROVIDER_${i}_NAME`];
    const type = process.env[`PROVIDER_${i}_TYPE`];
    const baseUrl = process.env[`PROVIDER_${i}_BASE_URL`];
    const apiKey = process.env[`PROVIDER_${i}_API_KEY`];

    if (!name && !type && !baseUrl && !apiKey) continue;

    if (!name || !type || !baseUrl || !apiKey) {
        errors.push(`❌ Provider ${i} is incomplete. Required: NAME, TYPE, BASE_URL, API_KEY`);
        continue;
    }

    const validTypes = ['openai', 'openai-compatible', 'gemini', 'grok2api'];
    if (!validTypes.includes(type)) {
        errors.push(`❌ Provider ${i} has invalid TYPE: "${type}". Valid: ${validTypes.join(', ')}`);
        continue;
    }

    if (type === 'grok2api') {
        const imgModels = process.env[`PROVIDER_${i}_IMAGE_MODELS`] || '';
        const editModels = process.env[`PROVIDER_${i}_IMAGE_EDIT_MODELS`] || '';
        const vidModels = process.env[`PROVIDER_${i}_VIDEO_MODELS`] || '';
        const allModels = [imgModels, editModels, vidModels].filter(Boolean).join(',');
        if (!allModels) {
            errors.push(`❌ Provider ${i} (grok2api) has no models. Set IMAGE_MODELS, IMAGE_EDIT_MODELS, or VIDEO_MODELS.`);
            continue;
        }
        providerCount++;
        console.log(`✅ Provider ${i}: ${name} [${type}] — Image: ${imgModels || '—'} | Edit: ${editModels || '—'} | Video: ${vidModels || '—'}`);
    } else {
        const models = process.env[`PROVIDER_${i}_MODELS`];
        if (!models) {
            errors.push(`❌ Provider ${i} is missing MODELS.`);
            continue;
        }
        providerCount++;
        console.log(`✅ Provider ${i}: ${name} [${type}] — Models: ${models}`);
    }
}

if (providerCount === 0) {
    warnings.push('⚠️  No providers configured. Set PROVIDER_N_* environment variables.');
} else {
    console.log(`\n✅ ${providerCount} provider(s) configured`);
}

// Check optional configurations
if (!process.env.AUTH_PASSWORD) {
    warnings.push('⚠️  AUTH_PASSWORD not set — web interface will be publicly accessible');
} else {
    console.log('✅ AUTH_PASSWORD is configured');
}

if (process.env.LSKY_URL && !process.env.LSKY_TOKEN) {
    warnings.push('⚠️  LSKY_URL set but LSKY_TOKEN missing — image hosting will not work');
} else if (process.env.LSKY_URL && process.env.LSKY_TOKEN) {
    console.log('✅ Lsky Pro is configured');
}

// Validate PORT
const port = parseInt(process.env.PORT || '8787', 10);
if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`❌ Invalid PORT: ${port} (must be 1-65535)`);
} else {
    console.log(`✅ PORT is valid: ${port}`);
}

// Check Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (majorVersion < 18) {
    errors.push(`❌ Node.js version ${nodeVersion} is not supported (requires >= 18.0.0)`);
} else {
    console.log(`✅ Node.js version is supported: ${nodeVersion}`);
}

// Summary
console.log('\n' + '='.repeat(50));
if (errors.length > 0) {
    console.log('\n❌ VALIDATION FAILED\n');
    errors.forEach(error => console.log(error));
    console.log('\nPlease fix these errors before starting the server.');
    process.exit(1);
}

if (warnings.length > 0) {
    console.log('\n⚠️  VALIDATION PASSED WITH WARNINGS\n');
    warnings.forEach(warning => console.log(warning));
    console.log('\n✅ Server can start, but review warnings for best results.');
} else {
    console.log('\n✅ VALIDATION PASSED — All checks successful!\n');
}

process.exit(0);
