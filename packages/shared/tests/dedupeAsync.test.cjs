const assert = require('assert');
const { performance } = require('perf_hooks');
const { groupSimilarPhotosAsync } = require('../dist/utils/deduplication');

function currentVisualHash(rowPattern, dHash = '0000000000000000') {
  let signature = '';
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      const value = rowPattern(x, y);
      signature += value.toString(16).padStart(2, '0').repeat(3);
    }
  }
  return `v2:${dHash}:${signature}`;
}

function photo(index, total) {
  return {
    id: `large-${total}-${index}`,
    uri: `local-file:///C:/Golden/IMG_${String(index).padStart(6, '0')}.jpg`,
    filename: `IMG_${String(index).padStart(6, '0')}.jpg`,
    timestamp: Date.UTC(2025, 0, 1, 12, 0, 0) + index * 3000,
    width: 4032,
    height: 3024,
    fileSize: 2_000_000 + index * 50_000,
    isScreenshot: false,
    tags: [],
    albumId: 'large',
  };
}

async function benchmark(size) {
  let eventLoopYielded = false;
  setTimeout(() => {
    eventLoopYielded = true;
  }, 0);
  const startedAt = performance.now();
  const groups = await groupSimilarPhotosAsync(
    Array.from({ length: size }, (_, index) => photo(index, size)),
    { yieldEvery: 100 },
  );
  const elapsedMs = performance.now() - startedAt;
  assert.strictEqual(eventLoopYielded, true, `${size} photos must yield to the event loop`);
  for (const group of groups) {
    assert.deepStrictEqual(group.rejectedPhotoIds, [], 'review-only large-library groups cannot auto-delete');
  }
  return elapsedMs;
}

async function main() {
  const results = {};
  for (const size of [1000, 3000, 5000]) {
    results[size] = await benchmark(size);
  }

  const baseHash = currentVisualHash((x, y) => 10 + x * 2 + (y < 12 ? 120 : 0));
  const shiftedColorHash = currentVisualHash((x, y) => {
    const sourceX = Math.max(0, x - 1);
    return Math.round((10 + sourceX * 2 + (y < 12 ? 120 : 0)) * 0.7 + 25);
  });
  let currentV2CandidateComparisons = 0;
  const currentV2Groups = await groupSimilarPhotosAsync([
    { ...photo(1, 2), visualHash: baseHash },
    {
      ...photo(2, 2),
      filename: 'renamed-and-resized.jpg',
      width: 1600,
      height: 1200,
      fileSize: 900_000,
      visualHash: shiftedColorHash,
    },
  ], {
    onProgress: ({ stage, total }) => {
      if (stage === 'visual') currentV2CandidateComparisons = Math.max(currentV2CandidateComparisons, total);
    },
  });
  assert.strictEqual(currentV2CandidateComparisons, 1, 'current v2 hashes must enter the bounded candidate index');
  assert.strictEqual(currentV2Groups.length, 1);
  assert.strictEqual(currentV2Groups[0].confidence, 'possible');
  assert.deepStrictEqual(currentV2Groups[0].rejectedPhotoIds, []);

  const sequenceHashes = [
    '5c186e5e5e536f6a',
    '2f6ed7df53564167',
    '481c2e5656dbf6de',
    '2e3e275f57d9f7d7',
    '151f7b6db94c37df',
    '172f3f7fd5973f1e',
    '37332f256f2e634b',
  ];
  const sequencePhotos = sequenceHashes.map((dHash, index) => ({
    ...photo(index, sequenceHashes.length),
    id: `jewelry-${index}`,
    filename: `R002${1359 + index}.JPG`,
    timestamp: Date.UTC(2024, 7, 1, 12, 16, 30) + index * 40_000,
    fileSize: 4_700_000 + index * 45_000,
    visualHash: currentVisualHash((x, y) => {
      const shiftedX = Math.max(0, Math.min(23, x + index - 3));
      return 30 + shiftedX * 4 + (y < 12 ? 90 : 0) + index;
    }, dHash),
  }));
  const sequenceGroups = await groupSimilarPhotosAsync(sequencePhotos);
  assert.strictEqual(sequenceGroups.length, 1, 'one shooting sequence must form one review group');
  assert.deepStrictEqual(
    new Set(sequenceGroups[0].photos.map((candidate) => candidate.id)),
    new Set(sequencePhotos.map((candidate) => candidate.id)),
  );
  assert.strictEqual(sequenceGroups[0].confidence, 'possible');
  assert.deepStrictEqual(sequenceGroups[0].rejectedPhotoIds, []);

  const abruptSceneGroups = await groupSimilarPhotosAsync([
    {
      ...photo(1, 2),
      filename: 'R0030001.JPG',
      visualHash: currentVisualHash((x, y) => 15 + x + y, '0000000000000000'),
    },
    {
      ...photo(2, 2),
      filename: 'R0030002.JPG',
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 20),
      visualHash: currentVisualHash((x, y) => 230 - x - y, '000000000000ffff'),
    },
  ]);
  assert.strictEqual(abruptSceneGroups.length, 0, 'adjacent filenames cannot merge a scene change');

  const distantSequenceGroups = await groupSimilarPhotosAsync([
    sequencePhotos[0],
    { ...sequencePhotos[1], timestamp: sequencePhotos[0].timestamp + 6 * 60 * 1000 },
  ]);
  assert.strictEqual(distantSequenceGroups.length, 0, 'the sequence review window must remain bounded');

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, delay, ...args) => {
    if ((Number(delay) || 0) === 0) {
      return { ref() {}, unref() {} };
    }
    return originalSetTimeout(callback, delay, ...args);
  };
  try {
    await Promise.race([
      groupSimilarPhotosAsync(
        Array.from({ length: 120 }, (_, index) => ({
          ...photo(index, 120),
          visualHash: `v2:${index.toString(16).padStart(16, '0')}:${'80'.repeat(48)}`,
        })),
        { yieldEvery: 50 },
      ),
      new Promise((_, reject) => originalSetTimeout(
        () => reject(new Error('dedupe yielding depends on throttled window timers')),
        5000,
      )),
    ]);
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  let cancelled = false;
  const visualPhotos = Array.from({ length: 600 }, (_, index) => ({
    ...photo(index, 600),
    visualHash: index.toString(16).padStart(16, '0'),
    fileSize: 2_000_000,
  }));
  setTimeout(() => {
    cancelled = true;
  }, 0);
  await assert.rejects(
    groupSimilarPhotosAsync(visualPhotos, {
      shouldCancel: () => cancelled,
      yieldEvery: 50,
    }),
    (error) => error instanceof Error && error.name === 'AbortError',
  );

  console.log(`async dedupe benchmark passed: ${JSON.stringify(results)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
