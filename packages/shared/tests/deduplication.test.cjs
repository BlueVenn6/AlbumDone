const assert = require('assert');
const {
  getSafeRejectedPhotoIds,
  groupSimilarPhotos,
  selectDedupeSignatureCandidates,
} = require('../dist/utils/deduplication');
const { computeVisualHashSignature, hammingDistance } = require('../dist/utils/imageQuality');

function photo(id, extra = {}) {
  const timestamp = extra.timestamp ?? Date.UTC(2025, 0, 1, 12, 0, 0);
  return {
    id,
    uri: `local-file:///C:/Photos/${id}.jpg`,
    filename: extra.filename ?? `${id}.jpg`,
    timestamp,
    width: extra.width ?? 4032,
    height: extra.height ?? 3024,
    fileSize: extra.fileSize ?? 3_000_000,
    isScreenshot: false,
    tags: [],
    albumId: 'C:/Photos',
    ...extra,
  };
}

function visualHashFromPattern(pattern) {
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const [red, green, blue] = pattern(x, y);
      const offset = (y * 32 + x) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
  }
  return computeVisualHashSignature(pixels, 32, 32);
}

assert.strictEqual(hammingDistance(0n, 0n), 0);
assert.strictEqual(hammingDistance(0n, 0xffffffffffffffffn), 64);
assert.strictEqual(hammingDistance(0xaaaaaaaaaaaaaaaan, 0x5555555555555555n), 64);
assert.strictEqual(hammingDistance(0n, (1n << 96n) - 1n), 96);

{
  const groups = groupSimilarPhotos([
    photo('copy-a', { filename: 'IMG_2000.JPG', contentHash: 'same-content', fileSize: 3_100_000 }),
    photo('copy-b', { filename: 'IMG_2000 copy.JPG', contentHash: 'same-content', fileSize: 3_100_000 }),
  ]);

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].confidence, 'high');
  assert.strictEqual(groups[0].rejectedPhotoIds.length, 1);
  assert.deepStrictEqual(getSafeRejectedPhotoIds(groups[0]), groups[0].rejectedPhotoIds);
}

{
  const originalHash = visualHashFromPattern((x, y) => [
    20 + x * 3,
    30 + y * 2,
    40 + ((x + y) % 12),
  ]);
  const reencodedHash = visualHashFromPattern((x, y) => [
    21 + x * 3,
    31 + y * 2,
    41 + ((x + y) % 12),
  ]);
  const groups = groupSimilarPhotos([
    photo('visual-copy-original', {
      filename: 'R0020147.JPG',
      visualHash: originalHash,
      width: 0,
      height: 0,
      timestamp: Date.UTC(2015, 10, 9, 3, 59, 44),
      fileSize: 6_553_600,
    }),
    photo('visual-copy-export', {
      filename: 'Professional_photograph_sample_2_seo.jpg',
      visualHash: reencodedHash,
      width: 0,
      height: 0,
      timestamp: Date.UTC(2026, 1, 3, 10, 28, 9),
      fileSize: 3_897_980,
    }),
  ]);

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].confidence, 'high');
  assert.strictEqual(groups[0].rejectedPhotoIds.length, 1);
}

{
  const burstHash = visualHashFromPattern((x, y) => [80 + x, 60 + y, 40 + x + y]);
  const groups = groupSimilarPhotos([
    photo('burst-safe-a', {
      filename: 'R0022001.JPG',
      visualHash: burstHash,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('burst-safe-b', {
      filename: 'R0022002.JPG',
      visualHash: burstHash,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 20),
    }),
  ]);

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].confidence, 'possible');
  assert.deepStrictEqual(groups[0].rejectedPhotoIds, []);
}

{
  const sharedHash = visualHashFromPattern((x, y) => [
    20 + x * 3,
    30 + y * 2,
    40 + ((x + y) % 12),
  ]);
  const groups = groupSimilarPhotos([
    photo('connected-high-a', {
      filename: 'R0020147.JPG',
      visualHash: sharedHash,
      timestamp: Date.UTC(2015, 10, 9, 3, 59, 44),
      fileSize: 6_500_000,
    }),
    photo('connected-high-b', {
      filename: 'Professional_photograph_sample_2_seo.jpg',
      visualHash: sharedHash,
      timestamp: Date.UTC(2026, 1, 3, 10, 28, 9),
      fileSize: 3_800_000,
    }),
    photo('connected-review-best', {
      filename: 'Screenshot 2026-02-03.png',
      visualHash: sharedHash,
      timestamp: Date.UTC(2026, 1, 3, 10, 29, 0),
      fileSize: 9_000_000,
      isScreenshot: true,
    }),
  ]);

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].selectedPhotoId, 'connected-review-best');
  assert.strictEqual(groups[0].confidence, 'possible');
  assert.strictEqual(groups[0].reason, 'possible-duplicate');
  assert.deepStrictEqual(groups[0].rejectedPhotoIds, []);
}

{
  const largeLibrary = Array.from({ length: 1000 }, (_, index) => photo(`candidate-${index}`, {
    filename: `IMG_${String(index).padStart(4, '0')}.JPG`,
    fileSize: 2_000_000 + index,
    width: 4032,
    height: 3024,
  }));
  const candidates = selectDedupeSignatureCandidates(largeLibrary);
  assert.strictEqual(candidates.content.length, 0);
  assert.strictEqual(candidates.visual.length, 1000);

  const renamedCopyCandidates = selectDedupeSignatureCandidates([
    photo('renamed-copy-a', { filename: 'IMG_2000.JPG', fileSize: 2_000_000 }),
    photo('renamed-copy-b', { filename: 'IMG_2000 copy 2.JPG', fileSize: 1_750_000 }),
  ]);
  assert.deepStrictEqual(
    new Set(renamedCopyCandidates.visual.map((candidate) => candidate.id)),
    new Set(['renamed-copy-a', 'renamed-copy-b']),
  );

  const sameSizeLibrary = Array.from({ length: 702 }, (_, index) => photo(`exact-candidate-${index}`, {
    fileSize: 4_000_000,
    width: 0,
    height: 0,
  }));
  const sameSizeCandidates = selectDedupeSignatureCandidates(sameSizeLibrary);
  assert.strictEqual(sameSizeCandidates.content.length, 702);
}

{
  const photos = [
    photo('legacy-a', { contentHash: 'exact-a' }),
    photo('legacy-b', { contentHash: 'exact-b' }),
  ];
  assert.deepStrictEqual(getSafeRejectedPhotoIds({
    id: 'legacy-possible',
    photos,
    selectedPhotoId: 'legacy-a',
    confidence: 'possible',
    reason: 'legacy',
  }), []);
  assert.deepStrictEqual(getSafeRejectedPhotoIds({
    id: 'legacy-high-mismatch',
    photos,
    selectedPhotoId: 'legacy-a',
    confidence: 'high',
    reason: 'legacy',
  }), []);
  assert.deepStrictEqual(getSafeRejectedPhotoIds({
    id: 'manual-review',
    photos,
    selectedPhotoId: 'legacy-a',
    rejectedPhotoIds: ['legacy-b', 'outside-id', 'legacy-b'],
    confidence: 'possible',
    reason: 'manual-selection',
  }), ['legacy-b']);
}

{
  const groups = groupSimilarPhotos([
    photo('partial-a', { filename: 'IMG_2001.JPG', fingerprint: 'same-partial-signature' }),
    photo('partial-b', { filename: 'IMG_2001 copy.JPG', fingerprint: 'same-partial-signature' }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('android-copy-a', {
      uri: 'content://media/external/images/media/101',
      filename: '101.jpg',
      width: 4032,
      height: 3024,
      fileSize: 3_100_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('android-copy-b', {
      uri: 'content://media/external/images/media/202',
      filename: '202.jpg',
      width: 4032,
      height: 3024,
      fileSize: 3_102_000,
      timestamp: Date.UTC(2025, 0, 1, 18, 0, 0),
    }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('metadata-copy-a', {
      filename: 'IMG_2000.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_100_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('metadata-copy-b', {
      filename: 'IMG_2000 copy.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_102_000,
      timestamp: Date.UTC(2025, 0, 1, 18, 0, 0),
    }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('hash-a', {
      filename: 'DSC_0100.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      visualHash: '0000000000000000',
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('hash-b', {
      filename: 'DSC_0100 copy.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_020_000,
      visualHash: '0000000000000001',
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 3),
    }),
  ]);

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].confidence, 'possible');
  assert.deepStrictEqual(groups[0].rejectedPhotoIds, []);
}

{
  const groups = groupSimilarPhotos([
    photo('ray-a', {
      filename: 'IMG_1080.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('ray-b', {
      filename: 'IMG_1081.JPG',
      width: 4010,
      height: 3008,
      fileSize: 3_220_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 28),
    }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('same-dim-a', {
      filename: 'IMG_7000.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('same-dim-b', {
      filename: 'IMG_7001.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_220_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 1, 0),
    }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('near-identical-real-a', {
      filename: 'IMG_7100.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('near-identical-real-b', {
      filename: 'IMG_7101.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_004_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 20),
    }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('visual-a', {
      filename: 'DSC_0100.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      visualHash: '0000000000000000',
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('visual-b', {
      filename: 'DSC_0180.JPG',
      width: 4032,
      height: 3024,
      fileSize: 4_400_000,
      visualHash: '0000000000000001',
      timestamp: Date.UTC(2025, 0, 1, 13, 0, 0),
    }),
  ]);

  assert.strictEqual(groups.length, 0, 'legacy dHash alone cannot group unrelated filenames and times');
}

{
  const groups = groupSimilarPhotos([
    photo('visual-full-pass-a', {
      filename: 'ChatGPT Image 2026年6月26日 18_55_50.png',
      width: 1199,
      height: 1312,
      fileSize: 1_616_000,
      visualHash: '0000000000000000',
      timestamp: Date.UTC(2026, 5, 26, 18, 55, 50),
    }),
    photo('visual-full-pass-b', {
      filename: 'unrelated-download-name.png',
      width: 1199,
      height: 1312,
      fileSize: 2_100_000,
      visualHash: '0000000000000001',
      timestamp: Date.UTC(2026, 5, 20, 8, 0, 0),
    }),
  ]);

  assert.strictEqual(groups.length, 0, 'legacy dHash alone cannot bypass the normalized pixel check');
}

{
  const groups = groupSimilarPhotos([
    photo('weak-a', {
      filename: 'IMG_3000.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('weak-b', {
      filename: 'IMG_3001.JPG',
      width: 3900,
      height: 2925,
      fileSize: 3_730_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 8, 0),
    }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('r245', {
      filename: 'R0021245.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      visualHash: '0000000000000000',
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('r247', {
      filename: 'R0021247.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_120_000,
      visualHash: 'ffffffffffffffff',
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 18),
    }),
    photo('r250', {
      filename: 'R0021250.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_080_000,
      visualHash: '00ff00ff00ff00ff',
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 36),
    }),
    photo('r254', {
      filename: 'R0021254.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_220_000,
      visualHash: 'ff00ff00ff00ff00',
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 54),
    }),
    photo('r258', {
      filename: 'R0021258.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_180_000,
      visualHash: '0f0f0f0f0f0f0f0f',
      timestamp: Date.UTC(2025, 0, 1, 12, 1, 12),
    }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('missing-size-a', { filename: 'IMG_4000.JPG', width: 0, height: 0 }),
    photo('missing-size-b', { filename: 'IMG_4001.JPG', width: 0, height: 0 }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('fast-hash-a', {
      filename: 'ChatGPT Image 2026年6月29日 18_09_27.png',
      width: 0,
      height: 0,
      fileSize: 1_000_000,
      visualHash: '0000000000000000',
      timestamp: Date.UTC(2026, 5, 29, 18, 9, 27),
    }),
    photo('fast-hash-b', {
      filename: 'ChatGPT Image 2026年6月29日 18_11_21.png',
      width: 0,
      height: 0,
      fileSize: 1_020_000,
      visualHash: '0000000000000001',
      timestamp: Date.UTC(2026, 5, 29, 18, 11, 21),
    }),
  ]);

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].confidence, 'possible');
  assert.deepStrictEqual(groups[0].rejectedPhotoIds, []);
}

{
  const groups = groupSimilarPhotos([
    photo('near-a', {
      filename: 'IMG_6000.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    }),
    photo('near-b', {
      filename: 'IMG_6001.JPG',
      width: 3960,
      height: 2970,
      fileSize: 3_120_000,
      timestamp: Date.UTC(2025, 0, 1, 12, 4, 0),
    }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const groups = groupSimilarPhotos([
    photo('different-ratio-a', { filename: 'IMG_5000.JPG', width: 4032, height: 3024 }),
    photo('different-ratio-b', { filename: 'IMG_5001.JPG', width: 3024, height: 4032 }),
  ]);

  assert.strictEqual(groups.length, 0);
}

{
  const basePattern = (x, y) => {
    const value = 10 + x * 2 + (y < 16 ? 120 : 0);
    return [value, value, value];
  };
  const colorCastPattern = (x, y) => {
    const value = 10 + x * 2 + (y < 16 ? 120 : 0);
    return [Math.round(value * 0.9 + 15), Math.round(value * 0.6 + 25), Math.round(value * 0.3 + 45)];
  };
  const baseVisualHash = visualHashFromPattern(basePattern);
  const colorCastVisualHash = visualHashFromPattern(colorCastPattern);
  const groups = groupSimilarPhotos([
    photo('current-v2-base', {
      filename: 'R0021187.JPG',
      width: 4032,
      height: 3024,
      fileSize: 3_000_000,
      visualHash: baseVisualHash,
    }),
    photo('current-v2-color-cast', {
      filename: 'unrelated-name.JPG',
      width: 1600,
      height: 1200,
      fileSize: 1_100_000,
      visualHash: colorCastVisualHash,
    }),
  ]);

  assert.strictEqual(groups.length, 1, 'current v2 signatures must match after color normalization');
  assert.strictEqual(groups[0].confidence, 'possible');
  assert.deepStrictEqual(groups[0].rejectedPhotoIds, []);
}

{
  const halfPatternHash = visualHashFromPattern((x, y) => {
    const value = 10 + x * 2 + (y < 16 ? 120 : 0);
    return [value, value, value];
  });
  const stripePatternHash = visualHashFromPattern((x, y) => {
    const value = 10 + x * 2 + (Math.floor(y / 4) % 2 === 0 ? 120 : 0);
    return [value, value, value];
  });
  assert.strictEqual(
    halfPatternHash.split(':')[1],
    stripePatternHash.split(':')[1],
    'fixture must exercise a dHash collision',
  );
  const groups = groupSimilarPhotos([
    photo('current-v2-half', { visualHash: halfPatternHash }),
    photo('current-v2-stripes', { visualHash: stripePatternHash }),
  ]);

  assert.strictEqual(groups.length, 0, 'matching dHash values cannot bypass the structure verifier');
}

{
  const repeatedDigits = '9'.repeat(50_000);
  const startedAt = performance.now();
  const groups = groupSimilarPhotos([
    photo('long-sequence-a', { filename: `IMG_${repeatedDigits} trailing.JPG` }),
    photo('long-sequence-b', { filename: `IMG_${repeatedDigits} other.JPG` }),
  ]);

  assert.deepStrictEqual(groups, []);
  assert.ok(performance.now() - startedAt < 1_000, 'long filename parsing must remain linear');
}

console.log('deduplication tests passed');
