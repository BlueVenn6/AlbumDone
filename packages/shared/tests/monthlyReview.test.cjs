const assert = require('assert');
const { selectMonthlyReviewPhotos } = require('../dist/utils/monthlyReview');

function photo(id, month, day, extra = {}) {
  const timestamp = Date.UTC(2025, month, day, extra.hour ?? 12, extra.minute ?? 0, 0);
  return {
    id,
    uri: `local-file:///C:/Photos/${id}.jpg`,
    filename: `${id}.jpg`,
    timestamp,
    capturedAt: extra.capturedAt === undefined ? timestamp : extra.capturedAt,
    createdAt: extra.createdAt,
    width: extra.width ?? 3000,
    height: extra.height ?? 2000,
    fileSize: extra.fileSize ?? 2_400_000,
    isScreenshot: extra.isScreenshot ?? false,
    tags: extra.tags ?? [],
    albumId: 'album',
    quality: extra.noQuality ? undefined : {
      sharpness: extra.sharpness ?? 420,
      exposure: extra.exposure ?? 'normal',
      noise: extra.noise ?? 0.15,
      hasFace: extra.hasFace ?? false,
      faceScore: extra.faceScore ?? 0,
      compositionScore: extra.compositionScore ?? 0.68,
      timestamp,
    },
    ...extra,
  };
}

const selections = selectMonthlyReviewPhotos([
  photo('jan-dup-low', 0, 6, {
    hour: 10,
    duplicateGroupId: 'jan-burst',
    sharpness: 90,
    fileSize: 500_000,
  }),
  photo('jan-dup-best', 0, 6, {
    hour: 10,
    duplicateGroupId: 'jan-burst',
    favorite: true,
    hasFace: true,
    faceScore: 0.8,
    fileSize: 3_500_000,
  }),
  photo('feb-screenshot', 1, 2, {
    filename: 'Screenshot_2025-02-02.png',
    isScreenshot: true,
    width: 1170,
    height: 2532,
    fileSize: 450_000,
    sharpness: 80,
  }),
  photo('mar-ordinary', 2, 8, {
    fileSize: 1_000_000,
    sharpness: 180,
  }),
  photo('mar-trip', 2, 13, {
    favorite: true,
    locationKey: 'kyoto',
    tags: ['travel', 'people'],
    hasFace: true,
    faceScore: 0.9,
    fileSize: 4_000_000,
  }),
  ...Array.from({ length: 14 }, (_, index) =>
    photo(`apr-burst-${index}`, 3, 18, {
      hour: 9,
      minute: index,
      duplicateGroupId: 'apr-burst',
      fileSize: 1_000_000 + index,
      sharpness: 180 + index,
    })
  ),
  photo('apr-burst-best', 3, 18, {
    hour: 9,
    minute: 2,
    duplicateGroupId: 'apr-burst',
    keep: true,
    locationKey: 'event-hall',
    hasFace: true,
    faceScore: 0.7,
    fileSize: 3_000_000,
  }),
  photo('jun-missing-metadata', 5, 1, {
    capturedAt: undefined,
    createdAt: undefined,
    timestamp: Date.UTC(2025, 5, 1, 12),
    width: 0,
    height: 0,
    fileSize: 0,
    noQuality: true,
  }),
], {
  mode: 'calendar',
  year: 2025,
  months: 12,
});

assert.strictEqual(selections.length, 12);
assert.strictEqual(selections[0].selectedPhoto.id, 'jan-dup-best');
assert.strictEqual(selections[0].excludedCandidates.some((item) => item.photoId === 'jan-dup-low'), true);
assert.strictEqual(selections[1].selectedPhoto.id, 'feb-screenshot');
assert.strictEqual(selections[1].confidence, 'low');
assert.ok(selections[1].reasons.some((reason) => reason.includes('低置信度')));
assert.strictEqual(selections[2].selectedPhoto.id, 'mar-trip');
assert.ok(selections[2].reasons.some((reason) => reason.includes('地点') || reason.includes('旅行')));
assert.strictEqual(selections[3].selectedPhoto.id, 'apr-burst-best');
assert.ok(selections[3].excludedCandidates.length >= 14);
assert.strictEqual(selections[4].selectedPhoto, null);
assert.strictEqual(selections[4].confidence, 'empty');
assert.strictEqual(selections[5].selectedPhoto.id, 'jun-missing-metadata');
assert.ok(selections[5].reasons.length > 0);

const outOfRange = selectMonthlyReviewPhotos([
  photo('old-photo', 11, 31, {
    timestamp: Date.UTC(2024, 11, 31),
    capturedAt: Date.UTC(2024, 11, 31),
  }),
], {
  mode: 'calendar',
  year: 2025,
});
assert.strictEqual(outOfRange.every((selection) => selection.selectedPhoto === null), true);

const noLowConfidence = selectMonthlyReviewPhotos([
  photo('tiny-receipt', 6, 1, {
    filename: 'receipt.jpg',
    width: 100,
    height: 100,
    fileSize: 20_000,
    noQuality: true,
  }),
], {
  mode: 'calendar',
  year: 2025,
  allowLowConfidence: false,
});
assert.strictEqual(noLowConfidence[6].selectedPhoto, null);

const strictPhotoOnly = selectMonthlyReviewPhotos([
  photo('screenshot-only', 7, 1, {
    filename: '532901.png',
    width: 1170,
    height: 2532,
    fileSize: 900_000,
    extension: 'png',
    albumId: 'Screenshots',
  }),
  photo('receipt-only', 8, 1, {
    filename: 'receipt_2025.jpg',
    width: 1200,
    height: 1600,
    fileSize: 400_000,
    noQuality: true,
  }),
], {
  mode: 'calendar',
  year: 2025,
  excludeLowValueImages: true,
});
assert.strictEqual(strictPhotoOnly[7].selectedPhoto, null);
assert.strictEqual(strictPhotoOnly[8].selectedPhoto, null);

console.log('monthlyReview tests passed');
