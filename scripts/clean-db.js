import fs from 'fs';

const inputFile = './data/migrated_source.json';
const outputFile = './data/db.json';

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// IDs to delete
const idsToDelete = [
    'gen-1774601208299-2hqw2dcoa',  // 原始链接不可访问
    'gen-1774598997266-q8yh4orza',  // 原始链接不可访问
    'gen-1774598340296-qnyd0y5ik',  // 原始链接不可访问
    'gen-1774598250311-r70q1wqxd',  // 原始链接不可访问
    'video-gen-1774601641576-3f5ln4oxi'  // 视频原始链接不可访问
];

// 1. Clean images - remove lskyUrl and filter out invalid records
data.images = data.images
    .filter(img => !idsToDelete.includes(img.id))
    .map(img => {
        const { lskyUrl, ...rest } = img;
        return rest;
    });

// 2. Clean videos - filter out invalid records and fix sourceImageUrl
data.videos = data.videos
    .filter(vid => !idsToDelete.includes(vid.id))
    .map(vid => {
        // Fix invalid sourceImageUrl
        if (vid.id === 'video-i2v-1774597370499-z1pxj5gpf') {
            vid.sourceImageUrl = null;
        }
        return vid;
    });

// 3. Update statistics
data.statistics.total = data.images.length;
data.statistics.byModel = {};
data.images.forEach(img => {
    data.statistics.byModel[img.model] = (data.statistics.byModel[img.model] || 0) + 1;
});

data.statistics.videoTotal = data.videos.length;
data.statistics.videoByModel = {};
data.videos.forEach(vid => {
    data.statistics.videoByModel[vid.model] = (data.statistics.videoByModel[vid.model] || 0) + 1;
});

fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

console.log('✅ Database cleaned successfully!');
console.log(`   Images: ${data.images.length}`);
console.log(`   Videos: ${data.videos.length}`);
console.log(`   Output: ${outputFile}`);
