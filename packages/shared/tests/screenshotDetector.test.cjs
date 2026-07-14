const assert = require('assert');
const {
  detectScreenshotCandidate,
  filterScreenshots,
  filterNonScreenshots,
} = require('../dist/utils/screenshotDetector');

function photo(id, extra = {}) {
  return {
    id,
    uri: `content://media/external/images/media/${id}`,
    filename: `${id}.jpg`,
    timestamp: Date.UTC(2025, 0, 1),
    width: 4032,
    height: 3024,
    fileSize: 3_000_000,
    isScreenshot: false,
    tags: [],
    albumId: 'Camera',
    ...extra,
  };
}

{
  const result = detectScreenshotCandidate({
    filename: '532901.png',
    width: 1170,
    height: 2532,
    fileSize: 900_000,
    extension: 'png',
    albumId: 'Screenshots',
    uri: 'content://media/external/images/media/532901',
  });

  assert.strictEqual(result.isScreenshot, true);
  assert.ok(result.confidence >= 0.65);
}

{
  const result = detectScreenshotCandidate({
    filename: 'IMG_5329.JPG',
    width: 4032,
    height: 3024,
    fileSize: 3_900_000,
    extension: 'jpg',
    albumId: 'Camera',
  });

  assert.strictEqual(result.isScreenshot, false);
}

{
  const photos = [
    photo('camera-photo'),
    photo('android-screenshot', {
      filename: '880012.png',
      width: 1170,
      height: 2532,
      fileSize: 850_000,
      extension: 'png',
      albumId: 'Screenshots',
    }),
  ];

  assert.strictEqual(filterScreenshots(photos).length, 1);
  assert.strictEqual(filterNonScreenshots(photos).length, 1);
}

{
  const result = detectScreenshotCandidate({
    filename: '1000123456.png',
    width: 1240,
    height: 2772,
    fileSize: 1_200_000,
    extension: 'png',
    albumId: 'Camera/Screenshots',
    tags: ['PhotoScreenshot'],
  });

  assert.strictEqual(result.isScreenshot, true);
  assert.ok(result.reasons.includes('path') || result.reasons.includes('tag'));
}

console.log('screenshot detector tests passed');
