const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { groupSimilarPhotosAsync, useCullingStore, selectMonthlyReviewPhotos } = require('@photo-manager/shared');

(async () => {
  const size = Number(process.argv[2] || 1000);
  assert([100, 1000, 3000, 5000].includes(size), 'Supported fixture sizes: 100, 1000, 3000, 5000');
  const photos = Array.from({ length: size }, (_, index) => ({
    id: `photo-${index}`, uri: `local-file:///C:/synthetic/${index}.jpg`, filename: `photo-${index}.jpg`,
    timestamp: new Date(2026, Math.floor(index / 2) % 12, 10).getTime(),
    width: 4000, height: 3000, fileSize: 2000000 + Math.floor(index / 2),
    contentHash: String(Math.floor(index / 2)).padStart(64, '0'),
    isScreenshot: false, tags: [], albumId: 'synthetic',
  }));
  let yielded = false; setTimeout(() => { yielded = true; }, 0);
  const started = performance.now();
  const groups = await groupSimilarPhotosAsync(photos, { yieldEvery: 100, initialSelection: 'keep-best' });
  const dedupMs = performance.now() - started;
  assert(yielded, 'Duplicate analysis must yield to the event loop');
  assert.equal(groups.length, size / 2);
  for (const group of groups) assert.equal(new Set(group.photos.map(photo => photo.contentHash)).size, 1);
  const items = photos.map(photo => ({ photo, decision: 'pending' }));
  useCullingStore.setState({ items, allItems: items, currentIndex: 0, history: [], isComplete: false });
  const cullingStart = performance.now();
  for (const photo of photos.slice(0, 100)) useCullingStore.getState().decide(photo.id, 'keep');
  const culling100Ms = performance.now() - cullingStart;
  assert.equal(useCullingStore.getState().getKeptPhotos().length, 100);
  useCullingStore.getState().undoLast();
  assert.equal(useCullingStore.getState().getKeptPhotos().length, 99);
  const yearStart = performance.now();
  const months = selectMonthlyReviewPhotos(photos, { year: 2026, months: 12, now: new Date(2026, 11, 31), allowLowConfidence: true });
  const yearMs = performance.now() - yearStart;
  assert.equal(months.length, 12);
  for (const month of months) if (month.selectedPhoto) assert.equal(new Date(month.selectedPhoto.timestamp).getMonth(), month.slotIndex);
  assert(dedupMs < 30000 && culling100Ms < 10000 && yearMs < 30000, 'Synthetic core operations exceeded the regression budget');
  const report = { size, dedupMs, culling100Ms, yearMs, memory: process.memoryUsage(), runtime: process.version,
    scope: 'Synthetic shared-core CPU benchmark; disk scanning and packaged UI are tested separately.' };
  const destination = path.resolve(process.argv[3] || `test-results/performance-${size}.json`);
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch(error => { console.error(error); process.exitCode = 1; });
