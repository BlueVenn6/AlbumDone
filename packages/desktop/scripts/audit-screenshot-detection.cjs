const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { detectScreenshotCandidate } = require('../../shared/dist/utils/screenshotDetector.js');

const databasePath = path.resolve(process.argv[2] || '');
const albumPath = path.resolve(process.argv[3] || '');
if (!databasePath || !albumPath) {
  throw new Error('Usage: electron audit-screenshot-detection.cjs <database> <album-path>');
}

const database = new Database(databasePath, { readonly: true });
const rows = database.prepare(`
  SELECT file_path, filename, extension, width, height, file_size,
         is_screenshot, screenshot_confidence, screenshot_reasons
  FROM photo_index
  WHERE album_id = ?
`).all(albumPath);
database.close();

const results = rows.map((row) => ({
  row,
  detected: detectScreenshotCandidate({
    filename: row.filename,
    filePath: row.file_path,
    albumId: albumPath,
    width: row.width,
    height: row.height,
    fileSize: row.file_size,
    extension: row.extension,
  }),
}));
const staleFalseNegatives = results.filter(({ row, detected }) =>
  row.is_screenshot !== 1 && detected.isScreenshot);
const staleFalsePositives = results.filter(({ row, detected }) =>
  row.is_screenshot === 1 && !detected.isScreenshot);
const borderlineCandidates = results.filter(({ detected }) =>
  !detected.isScreenshot
  && detected.confidence >= 0.25
  && detected.reasons.some((reason) => ['dimensions', 'screen-ratio', 'screen-size', 'screen-format'].includes(reason)));
const zeroDimensionRows = rows.filter((row) => row.width <= 0 || row.height <= 0);
const exactScreenFormatCandidates = results.filter(({ row, detected }) =>
  !detected.isScreenshot
  && detected.reasons.includes('dimensions')
  && ['.png', '.webp'].includes(String(row.extension).toLowerCase()));
const screenshotDirectories = new Map();
for (const row of rows.filter((item) => item.is_screenshot === 1)) {
  const relativeDirectory = path.dirname(path.relative(albumPath, row.file_path));
  screenshotDirectories.set(relativeDirectory, (screenshotDirectories.get(relativeDirectory) || 0) + 1);
}

function samples(items) {
  return items.slice(0, 8).map(({ row, detected }) => ({
    filePath: path.relative(albumPath, row.file_path),
    dimensions: `${row.width}x${row.height}`,
    fileSize: row.file_size,
    oldConfidence: row.screenshot_confidence,
    confidence: detected.confidence,
    reasons: detected.reasons,
  }));
}

fs.writeSync(1, `${JSON.stringify({
  indexedPhotos: rows.length,
  indexedScreenshots: rows.filter((row) => row.is_screenshot === 1).length,
  recomputedScreenshots: results.filter(({ detected }) => detected.isScreenshot).length,
  staleFalseNegativeCount: staleFalseNegatives.length,
  staleFalseNegatives: samples(staleFalseNegatives),
  staleFalsePositiveCount: staleFalsePositives.length,
  staleFalsePositives: samples(staleFalsePositives),
  borderlineCandidateCount: borderlineCandidates.length,
  borderlineCandidates: samples(borderlineCandidates),
  zeroDimensionCount: zeroDimensionRows.length,
  zeroDimensionSamples: zeroDimensionRows.slice(0, 8).map((row) => path.relative(albumPath, row.file_path)),
  exactScreenFormatCandidateCount: exactScreenFormatCandidates.length,
  exactScreenFormatCandidates: samples(exactScreenFormatCandidates),
  screenshotDirectories: [...screenshotDirectories]
    .sort((first, second) => second[1] - first[1])
    .slice(0, 20)
    .map(([directory, count]) => ({ directory, count })),
}, null, 2)}\n`);
process.exit(0);
