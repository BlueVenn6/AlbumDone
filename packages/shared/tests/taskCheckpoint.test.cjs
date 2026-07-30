const assert = require('assert');
const {
  cancelPhotoTaskCheckpoint,
  createPhotoTaskCheckpoint,
  getRemainingPhotoTaskDeletionIds,
  photoTaskBatchesMatch,
  parsePhotoTaskCheckpoint,
  preparePhotoTaskDeletion,
  recordPhotoTaskDecision,
  recordPhotoTaskDeletionResult,
  resumePhotoTaskCheckpoint,
  selectPhotoTaskIds,
} = require('../dist/utils/taskCheckpoint');

const ids = (count) => Array.from({ length: count }, (_, index) => `photo-${index}`);

for (const limit of [50, 100, 200, 500, 777]) {
  assert.strictEqual(selectPhotoTaskIds(ids(5000), { mode: 'limited', limit }).length, limit);
}
assert.strictEqual(selectPhotoTaskIds(ids(5000), { mode: 'all' }).length, 5000);
assert.strictEqual(selectPhotoTaskIds(['a', 'a', 'b'], { mode: 'all' }).length, 2);
assert.strictEqual(photoTaskBatchesMatch({ mode: 'limited', limit: 100 }, { mode: 'all' }, 3963), false);
assert.strictEqual(photoTaskBatchesMatch({ mode: 'limited', limit: 100 }, { mode: 'limited', limit: 100 }, 3963), true);
assert.strictEqual(photoTaskBatchesMatch({ mode: 'limited', limit: 5000 }, { mode: 'all' }, 3963), false);

let checkpoint = createPhotoTaskCheckpoint({
  id: 'culling:album-a',
  kind: 'culling',
  albumId: 'album-a',
  snapshotKey: 'snapshot-a',
  photoIds: ids(5000),
  batch: { mode: 'all' },
  now: 1,
});

for (let index = 0; index < 1800; index += 1) {
  checkpoint = recordPhotoTaskDecision(
    checkpoint,
    `photo-${index}`,
    index % 10 === 0 ? 'delete' : 'keep',
    index + 2,
  );
}
assert.strictEqual(checkpoint.currentIndex, 1800);

const cancelled = cancelPhotoTaskCheckpoint(checkpoint, 2000);
const parsed = parsePhotoTaskCheckpoint(JSON.stringify(cancelled));
assert(parsed);
const resumed = resumePhotoTaskCheckpoint(parsed, 'snapshot-a', ids(5000), 2001);
assert(resumed);
assert.strictEqual(resumed.currentIndex, 1800);
assert.strictEqual(resumed.decisions['photo-1799'], 'keep');
assert.strictEqual(resumePhotoTaskCheckpoint(parsed, 'different-snapshot', ids(5000)), null);

checkpoint = preparePhotoTaskDeletion(resumed, undefined, 3000);
assert.strictEqual(checkpoint.deletion.requestedIds.length, 180);
assert.strictEqual(getRemainingPhotoTaskDeletionIds(checkpoint).length, 180);

const firstCommit = checkpoint.deletion.requestedIds.slice(0, 75);
checkpoint = recordPhotoTaskDeletionResult(checkpoint, { committedIds: firstCommit }, 3001);
assert.strictEqual(getRemainingPhotoTaskDeletionIds(checkpoint).length, 105);

checkpoint = recordPhotoTaskDeletionResult(checkpoint, { committedIds: firstCommit }, 3002);
assert.strictEqual(checkpoint.deletion.committedIds.length, 75, 'repeated resume must not double-commit deletion');

const afterExternalRescan = resumePhotoTaskCheckpoint(
  checkpoint,
  'snapshot-after-partial-delete',
  ids(5000).filter((photoId) => !firstCommit.includes(photoId)),
  3002,
);
assert(afterExternalRescan);
assert.strictEqual(getRemainingPhotoTaskDeletionIds(afterExternalRescan).length, 105);
checkpoint = afterExternalRescan;

const remaining = getRemainingPhotoTaskDeletionIds(checkpoint);
checkpoint = recordPhotoTaskDeletionResult(checkpoint, { committedIds: remaining }, 3003);
assert.strictEqual(checkpoint.status, 'completed');
assert.deepStrictEqual(getRemainingPhotoTaskDeletionIds(checkpoint), []);

console.log('task checkpoint/batch/resume tests passed');
