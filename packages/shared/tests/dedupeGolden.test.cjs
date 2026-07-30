const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { groupSimilarPhotos } = require('../dist/utils/deduplication');
const { computeVisualHashSignature } = require('../dist/utils/imageQuality');

const fixtureDir = path.join(__dirname, 'fixtures', 'dedupe-golden');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8'));

async function readFixture(entry) {
  const filePath = path.join(fixtureDir, entry.file);
  const buffer = fs.readFileSync(filePath);
  const image = await loadImage(buffer);
  const canvas = createCanvas(32, 32);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, 32, 32);
  const pixels = context.getImageData(0, 0, 32, 32).data;
  const visualHash = computeVisualHashSignature(
    new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    32,
    32,
  );

  return {
    id: entry.id,
    uri: `local-file:///golden/${entry.file}`,
    filename: entry.file,
    timestamp: Date.UTC(2025, 0, 1, 12, 0, 0) + entry.timestampOffsetMs,
    width: image.width,
    height: image.height,
    fileSize: buffer.length,
    contentHash: crypto.createHash('sha256').update(buffer).digest('hex'),
    visualHash,
    isScreenshot: entry.family.startsWith('screenshot'),
    tags: [],
    albumId: 'golden',
    fixtureFamily: entry.family,
  };
}

async function main() {
  const photos = await Promise.all(manifest.cases.map(readFixture));
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const groups = groupSimilarPhotos(photos);

  const highGroups = groups.filter((group) => group.confidence === 'high');
  assert.strictEqual(highGroups.length, 1, 'only the byte-identical fixture group may be high confidence');
  assert.deepStrictEqual(
    new Set(highGroups[0].photos.map((photo) => photo.id)),
    new Set(manifest.exactContentGroups[0]),
  );
  assert.strictEqual(highGroups[0].rejectedPhotoIds.length, 2);

  for (const group of groups) {
    for (const rejectedId of group.rejectedPhotoIds) {
      const selected = byId.get(group.selectedPhotoId);
      const rejected = byId.get(rejectedId);
      assert(selected && rejected, 'selected and rejected fixture records must exist');
      assert.strictEqual(
        selected.contentHash,
        rejected.contentHash,
        `non-identical fixture ${rejectedId} was selected for automatic deletion`,
      );
    }
  }

  for (const family of manifest.neverAutoDeleteFamilies) {
    const familyIds = new Set(photos.filter((photo) => photo.fixtureFamily === family).map((photo) => photo.id));
    for (const group of groups) {
      const rejected = group.rejectedPhotoIds.filter((photoId) => familyIds.has(photoId));
      assert.deepStrictEqual(rejected, [], `${family} fixtures must never be auto-selected for deletion`);
    }
  }

  console.log(`dedupe golden image tests passed (${photos.length} real image files, ${groups.length} review groups)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
