const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  groupSimilarPhotosAsync,
  selectDedupeSignatureCandidates,
} = require('../../shared/dist/utils/deduplication.js');

const databasePath = path.resolve(process.argv[2] || '');
const albumPath = path.resolve(process.argv[3] || '');
const database = new Database(databasePath, { readonly: true });
const rows = database.prepare('SELECT * FROM photo_index WHERE album_id = ?').all(albumPath);
database.close();

const photos = rows.map((row) => ({
  id: row.id,
  uri: row.uri,
  filename: row.filename,
  timestamp: row.timestamp,
  width: row.width,
  height: row.height,
  fileSize: row.file_size,
  fingerprint: row.fingerprint || undefined,
  contentHash: row.content_hash || undefined,
  visualHash: row.visual_hash || undefined,
  isScreenshot: row.is_screenshot === 1,
  tags: [],
  albumId: row.album_id,
}));
const candidates = selectDedupeSignatureCandidates(photos);
void (async () => {
  const result = {
    input: photos.length,
    contentCandidates: candidates.content.length,
    visualCandidates: candidates.visual.length,
    totalSignatureWork: candidates.content.length + candidates.visual.length,
  };
  if (process.argv.includes('--group')) {
    let candidateComparisons = 0;
    const startedAt = performance.now();
    const groups = await groupSimilarPhotosAsync(photos, {
      onProgress: ({ stage, total }) => {
        if (stage !== 'exact') candidateComparisons = Math.max(candidateComparisons, total);
      },
    });
    Object.assign(result, {
      candidateComparisons,
      groups: groups.length,
      pendingDeletion: groups.reduce(
        (total, group) => total + (group.rejectedPhotoIds?.length ?? 0),
        0,
      ),
      groupSamples: groups.slice(0, 20).map((group) => ({
        confidence: group.confidence,
        photos: group.photos.map((photo) => photo.filename),
      })),
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  }
  fs.writeSync(1, `${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
})().catch((error) => {
  fs.writeSync(2, `${error.stack || error}\n`);
  process.exit(1);
});
