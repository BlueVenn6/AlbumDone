const assert = require('node:assert');

const { registerYearInReviewIpc } = require('../dist/main/yearInReviewIpc.js');

async function main() {
  let channel = null;
  let handler = null;
  let generationCall = null;
  registerYearInReviewIpc({
    safeHandle: (registeredChannel, registeredHandler) => {
      channel = registeredChannel;
      handler = registeredHandler;
    },
    maxScanPhotos: 3,
    assertImagePath: (value) => {
      if (value === 'invalid') throw new Error('invalid path');
      return value;
    },
    assertString: (value, name) => {
      assert.strictEqual(typeof value, 'string', `${name} must be a string`);
      return value;
    },
    toLocalFileUri: (value) => `local-file:///${value}`,
    getOutputRoot: () => 'test-output',
    getPreferredLocale: async () => 'zh-Hans',
    generateYearInReview: async (...args) => {
      generationCall = args;
      return { outputPath: 'test-output/review.jpg' };
    },
  });

  assert.strictEqual(channel, 'yearInReview:generate');
  assert.strictEqual(typeof handler, 'function');
  const result = await handler(null, [{
    uri: 'photo.jpg',
    filename: 'photo.jpg',
    timestamp: 12.4,
    width: 10.6,
    height: -5,
    fileSize: 20.2,
    thumbnailUri: 'invalid',
  }], 'calendar');
  assert.deepStrictEqual(result, { outputPath: 'test-output/review.jpg' });
  assert.deepStrictEqual(generationCall, [[{
    uri: 'local-file:///photo.jpg',
    filename: 'photo.jpg',
    isScreenshot: false,
    timestamp: 12.4,
    width: 11,
    height: 0,
    fileSize: 20,
  }], 'test-output', 'calendar', 'zh-Hans']);

  await assert.rejects(() => handler(null, [], 'rolling'), /requires 1-3 photos/);
  await assert.rejects(
    () => handler(null, new Array(4).fill({ uri: 'photo.jpg', filename: 'photo.jpg' })),
    /requires 1-3 photos/,
  );
  process.stdout.write('year in review IPC contract tests passed\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
