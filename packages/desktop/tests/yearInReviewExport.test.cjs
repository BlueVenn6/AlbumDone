const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { generateYearInReview } = require('../dist/main/yearInReview');

const fixtureDir = path.resolve(__dirname, '../../shared/tests/fixtures/dedupe-golden');
const fixtureNames = [
  'base-scene.png',
  'base-scene-q94.jpg',
  'base-scene-q68.jpg',
  'burst-a.png',
  'screenshot-text-a.png',
  'person-pose-a.png',
  'different-document.png',
];

function inputPhoto(index, month, overridePath) {
  const filePath = overridePath ?? path.join(fixtureDir, fixtureNames[index % fixtureNames.length]);
  return {
    uri: filePath,
    filename: path.basename(filePath),
    timestamp: new Date(2026, month, (index % 20) + 1, 12, 0, 0).getTime(),
    width: 960,
    height: 640,
    fileSize: 100000 + index,
    isScreenshot: false,
  };
}

async function dimensions(filePath) {
  const image = await loadImage(filePath);
  return { width: image.width, height: image.height };
}

async function assertPlaceholderNotBlack(filePath, monthIndexes, columns = 4) {
  const image = await loadImage(filePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  for (const monthIndex of monthIndexes) {
    const column = monthIndex % columns;
    const row = Math.floor(monthIndex / columns);
    const pixel = context.getImageData(column * 400 + 200, 40 + row * 400 + 200, 1, 1).data;
    assert(
      Math.max(pixel[0], pixel[1], pixel[2]) > 35,
      `month ${monthIndex + 1} placeholder must not be an empty black tile`,
    );
  }
}

async function main() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'albumdone-yir-test-'));
  try {
    for (const count of [1, 2, 4]) {
      const result = await generateYearInReview(
        Array.from({ length: count }, (_, index) => inputPhoto(index, index % 2)),
        outputDir,
        'calendar',
        'zh-Hans',
      );
      assert(result.outputPath);
      assert.deepStrictEqual(await dimensions(result.outputPath), {
        width: 900,
        height: 80 + count * 900,
      });
      assert.strictEqual(result.moments.length, count);
    }

    const sparseMonths = [0, 0, 1, 1, 3, 6];
    const calendar = await generateYearInReview(
      sparseMonths.map((month, index) => inputPhoto(index, month)),
      outputDir,
      'calendar',
      'en',
    );
    assert(calendar.outputPath);
    assert.deepStrictEqual(await dimensions(calendar.outputPath), { width: 400, height: 2840 });
    assert.strictEqual(calendar.monthsCovered, 7);
    assert.deepStrictEqual(calendar.emptyMonths.length, 3);
    assert.strictEqual(calendar.moments.length, 4);
    assert(calendar.moments.every((moment) =>
      moment.whySelected.every((reason) => !/[\u3400-\u9fff]/u.test(reason))));
    assert(!calendar.moments.some((moment) => ['2026-03', '2026-05', '2026-06'].includes(moment.month)));
    await assertPlaceholderNotBlack(calendar.outputPath, [2, 4, 5], 1);

    const unreadable = await generateYearInReview(
      Array.from({ length: 6 }, (_, index) => inputPhoto(
        index,
        index,
        path.join(outputDir, `missing-${index}.jpg`),
      )),
      outputDir,
      'calendar',
      'zh-Hans',
    );
    assert(unreadable.outputPath);
    await assertPlaceholderNotBlack(unreadable.outputPath, Array.from({ length: 7 }, (_, index) => index), 1);

    const denseMonth = await generateYearInReview(
      Array.from({ length: 80 }, (_, index) => inputPhoto(index, 4)),
      outputDir,
      'calendar',
      'en',
    );
    assert(denseMonth.outputPath);
    assert.deepStrictEqual(await dimensions(denseMonth.outputPath), { width: 400, height: 2840 });

    const empty = await generateYearInReview([], outputDir, 'calendar', 'en');
    assert.strictEqual(empty.outputPath, '');
    console.log('desktop year review export/pixel tests passed');
  } finally {
    if (outputDir.startsWith(os.tmpdir())) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
