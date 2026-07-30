const assert = require('assert');
const { selectMeaningfulMoments } = require('../dist/utils/meaningfulMoments');

function photo(id, day, extra = {}) {
  const timestamp = Date.UTC(2025, 0, day, extra.hour ?? 12, 0, 0);
  return {
    id,
    uri: `local-file:///C:/Photos/${id}.jpg`,
    filename: `${id}.jpg`,
    timestamp,
    width: extra.width ?? 3000,
    height: extra.height ?? 2000,
    fileSize: extra.fileSize ?? 2_000_000,
    isScreenshot: extra.isScreenshot ?? false,
    quality: {
      sharpness: extra.sharpness ?? 420,
      exposure: extra.exposure ?? 'normal',
      noise: extra.noise ?? 0.15,
      hasFace: extra.hasFace ?? false,
      faceScore: extra.faceScore ?? 0,
      compositionScore: extra.compositionScore ?? 0.65,
      timestamp,
    },
    tags: [],
    albumId: 'album',
    ...extra,
  };
}

const moments = selectMeaningfulMoments([
  photo('fixed-day-low', 1, { isScreenshot: true }),
  photo('ordinary-single', 8, { fileSize: 500_000, sharpness: 100 }),
  photo('trip-a', 20, { hour: 10, hasFace: true, faceScore: 0.8, favorite: true, locationKey: 'tokyo' }),
  photo('trip-b', 20, { hour: 11, hasFace: true, faceScore: 0.7, locationKey: 'tokyo' }),
  photo('trip-c', 20, { hour: 12, locationKey: 'tokyo' }),
  photo('duplicate-loser', 20, { hour: 13, duplicateGroupId: 'dup-1' }),
  photo('duplicate-loser-copy', 20, { hour: 13, duplicateGroupId: 'dup-1' }),
]);

assert.strictEqual(moments.length, 1);
assert.strictEqual(moments[0].month, '2025-01');
assert.ok(moments[0].photos.some((item) => item.id === 'trip-a'));
assert.ok(!moments[0].photos.some((item) => item.id === 'fixed-day-low'));
assert.ok(moments[0].score > 50);
assert.ok(moments[0].whySelected.length > 0);
assert.ok(moments[0].dateRange.includes('2025-01-20'));

const sparse = selectMeaningfulMoments([
  photo('bad-screenshot', 2, { isScreenshot: true }),
  photo('tiny', 3, { width: 120, height: 120 }),
]);
assert.deepStrictEqual(sparse, []);

const mixedMonths = selectMeaningfulMoments([
  ...Array.from({ length: 8 }, (_, index) =>
    photo(`feb-screenshot-${index}`, 34 + index, {
      isScreenshot: true,
      duplicateGroupId: 'feb-bad',
      sharpness: 30,
      width: 400,
      height: 300,
    })
  ),
  photo('march-dense-a', 75, { hour: 9, favorite: true, keep: true, hasFace: true, faceScore: 0.9, locationKey: 'family-trip' }),
  photo('march-dense-b', 75, { hour: 10, hasFace: true, faceScore: 0.8, locationKey: 'family-trip' }),
  photo('march-dense-c', 75, { hour: 11, hasFace: true, faceScore: 0.7, locationKey: 'family-trip' }),
]);
assert.ok(!mixedMonths.some((moment) => moment.month === '2025-02'));
const march = mixedMonths.find((moment) => moment.month === '2025-03');
assert.ok(march, 'dense high-quality March photos should be selected');
assert.ok(march.photos.some((item) => item.id === 'march-dense-a'));
assert.ok(march.whySelected.some((reason) => reason.includes('保留') || reason.includes('收藏')));

const fallbackTime = selectMeaningfulMoments([
  photo('fallback-created-a', 1, {
    timestamp: Date.UTC(2020, 5, 1),
    createdAt: Date.UTC(2025, 6, 4, 12),
    capturedAt: undefined,
    favorite: true,
  }),
  photo('fallback-created-b', 1, {
    timestamp: Date.UTC(2020, 5, 1),
    createdAt: Date.UTC(2025, 6, 4, 13),
    capturedAt: undefined,
  }),
]);
assert.strictEqual(fallbackTime[0].month, '2025-07');
assert.ok(fallbackTime[0].dateRange.includes('2025-07-04'));
assert.ok(fallbackTime[0].whySelected.length > 0);

console.log('meaningfulMoments tests passed');
