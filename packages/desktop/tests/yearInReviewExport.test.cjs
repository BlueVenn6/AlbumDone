const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { prepareYearReview, exportYearReview, generateYearInReview } = require('../dist/main/yearInReview');
const { replaceReviewPhoto, SUPPORTED_LOCALES } = require('@photo-manager/shared');
const now = new Date(2026, 6, 25, 12);
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'albumdone-review-'));
  try {
    const photos = ['#e12626', '#176bd4'].map((color, index) => {
      const canvas = createCanvas(960, 640); const ctx = canvas.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, 960, 640);
      const uri = path.join(dir, `photo-${index}.jpg`);
      fs.writeFileSync(uri, canvas.toBuffer('image/jpeg'));
      return { uri, filename: path.basename(uri), timestamp: new Date(2026, 5, 10 + index).getTime(),
        width: 960, height: 640, fileSize: 100000, isScreenshot: false };
    });
    const months = await prepareYearReview(photos, 'rolling', 'en', now);
    assert.equal(months.length, 12);
    const june = months.find(m => m.photo);
    assert(june); assert.equal(june.candidates.length, 2);
    assert.equal(months.filter(m => !m.photo).length, 11);
    assert.equal(months[0].monthId, 2025 * 12 + 7);
    assert.equal(months[11].monthId, 2026 * 12 + 6);
    const before = await exportYearReview(months, dir, 'en');
    const alternative = june.candidates.find(p => p.id !== june.photo.id);
    const replacement = replaceReviewPhoto(months, june.monthId, alternative.id);
    const changed = await exportYearReview(replacement, dir, 'en');
    assert.notDeepEqual(fs.readFileSync(before.outputPath), fs.readFileSync(changed.outputPath), 'Export must preserve a changed photo');
    assert.equal(replacement.find(m => m.monthId === june.monthId).photo.id, alternative.id);
    for (const locale of Object.keys(SUPPORTED_LOCALES)) {
      const localized = await prepareYearReview(photos, 'rolling', locale, now);
      const result = await exportYearReview(localized, dir, locale);
      const image = await loadImage(result.outputPath);
      assert.deepEqual([image.width, image.height], [1536, 1164]);
      assert.equal(result.monthsCovered, 1);
      assert.equal(result.emptyMonths.length, 11);
      const canvas = createCanvas(image.width, image.height); const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixel = ctx.getImageData(150, 200, 1, 1).data;
      assert(Math.min(...pixel.slice(0, 3)) > 100, `${locale}: blank month must contain a light card`);
    }
    assert.equal((await prepareYearReview(photos, 'previousYear', 'en', now)).filter(m => m.photo).length, 0);
    await assert.rejects(generateYearInReview([], dir, 'rolling', 'en', now));
    const invalid = months.map(m => ({ ...m })); invalid[1].monthId = invalid[0].monthId;
    await assert.rejects(exportYearReview(invalid, dir, 'en'), /consecutive/);
    const missing = months.map(m => m.photo ? { ...m, photo: { ...m.photo, uri: path.join(dir, 'missing.jpg') } } : m);
    await assert.rejects(exportYearReview(missing, dir, 'en'), /ENOENT/, 'Unreadable selected photos must fail export');
    const wrongMonth = months.map(m => m.photo ? { ...m, photo: { ...m.photo, timestamp: new Date(2026, 0, 1).getTime() } } : m);
    await assert.rejects(exportYearReview(wrongMonth, dir, 'en'), /outside/);
    console.log('Desktop exact-choice export, month boundaries, failures and all 15 languages passed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
