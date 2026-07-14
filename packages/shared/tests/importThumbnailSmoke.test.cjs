const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  let active = 0;
  let peak = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      active += 1;
      peak = Math.max(peak, active);
      try {
        await worker(item);
      } finally {
        active -= 1;
      }
    }
  });
  await Promise.all(workers);
  return peak;
}

function signature(file) {
  return `${path.resolve(file.path)}|${file.size}|${file.mtime}`;
}

async function simulateImport(files, previousSignatures = new Set()) {
  const seen = new Set(previousSignatures);
  const summary = { processed: 0, succeeded: 0, skipped: 0, failed: 0, errors: [] };
  const peak = await runWithConcurrency(files, 6, async (file) => {
    await Promise.resolve();
    try {
      if (file.fail) {
        throw new Error(file.fail);
      }
      const key = signature(file);
      if (seen.has(key)) {
        summary.skipped += 1;
      } else {
        seen.add(key);
        summary.succeeded += 1;
      }
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ path: file.path, reason: err.message });
    } finally {
      summary.processed += 1;
    }
  });
  return { summary, peak, signatures: seen };
}

function thumbnailCacheKey(filePath, sourceSize, mtimeMs, thumbnailSize) {
  return crypto.createHash('sha1')
    .update(JSON.stringify({
      normalizedPath: path.resolve(filePath),
      mtimeMs,
      size: sourceSize,
      thumbnailSize,
    }))
    .digest('hex');
}

(async () => {
  const files = Array.from({ length: 1000 }, (_, index) => ({
    path: `C:/Photos/导入 ${index}/image ${index}.jpg`,
    size: 1000 + index,
    mtime: 1700000000000 + index,
  }));

  const first = await simulateImport([
    ...files,
    { path: 'C:/Photos/corrupt.jpg', size: 1, mtime: 1, fail: 'corrupt image' },
    { path: 'C:/Photos/offline-placeholder.jpg', size: 0, mtime: 2, fail: 'cloud file is not available locally' },
  ]);
  assert.strictEqual(first.peak, 6);
  assert.strictEqual(first.summary.succeeded, 1000);
  assert.strictEqual(first.summary.failed, 2);
  assert.strictEqual(first.summary.processed, 1002);
  assert.ok(first.summary.errors.some((item) => item.reason.includes('corrupt')));

  const second = await simulateImport(files, first.signatures);
  assert.strictEqual(second.summary.succeeded, 0);
  assert.strictEqual(second.summary.skipped, 1000);

  assert.strictEqual(
    thumbnailCacheKey('C:/Photos/a.jpg', 123, 456, 200),
    thumbnailCacheKey('C:/Photos/a.jpg', 123, 456, 200),
  );
  assert.notStrictEqual(
    thumbnailCacheKey('C:/Photos/a.jpg', 123, 456, 200),
    thumbnailCacheKey('C:/Photos/a.jpg', 124, 456, 200),
  );
  assert.notStrictEqual(
    thumbnailCacheKey('C:/Photos/a.jpg', 123, 456, 200),
    thumbnailCacheKey('C:/Photos/a.jpg', 123, 456, 320),
  );

  console.log('import/thumbnail smoke tests passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
