const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deletePhotoFiles } = require('../dist/main/photoDeletion');
const { purgePhotoCacheFiles, getPhotoCacheOwnerPrefix } = require('../dist/main/thumbnailCache');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'albumdone-delete-test-'));
  const cache = path.join(root, 'cache');
  fs.mkdirSync(cache);
  try {
    const photos = Array.from({ length: 200 }, (_, i) => path.join(root, `${i}.jpg`));
    for (const photo of photos) {
      fs.writeFileSync(photo, Buffer.alloc(512 * 1024, 7));
      fs.writeFileSync(path.join(cache, getPhotoCacheOwnerPrefix(photo) + 'a'.repeat(40) + '.jpg'), Buffer.alloc(16384));
    }
    const protectedFile = path.join(cache, 'notes.txt');
    fs.writeFileSync(protectedFile, 'preserve');
    const before = fs.statfsSync(root);
    const result = await deletePhotoFiles([...photos, photos[0]], {
      mode: 'permanent',
      trashItem: async () => { throw new Error('Permanent deletion must bypass trash'); },
      purgeCache: (photo) => purgePhotoCacheFiles(cache, photo),
    });
    assert.equal(result.successCount, 200);
    assert.equal(result.originalBytesRemoved, 200 * 512 * 1024);
    assert.equal(result.cacheBytesRemoved, 200 * 16384);
    assert.deepEqual(result.errors, []);
    assert(photos.every((photo) => !fs.existsSync(photo)));
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'preserve');
    const after = fs.statfsSync(root);
    console.log(JSON.stringify({ availableBytesDelta: (after.bavail - before.bavail) * after.bsize, ...result, deletedPaths: result.deletedPaths.length }));

    const original = path.join(root, 'recycle.jpg');
    fs.writeFileSync(original, 'photo');
    const recycled = await deletePhotoFiles([original], {
      mode: 'trash', trashItem: async () => { throw new Error('Synthetic trash failure'); }, purgeCache: async () => 0,
    });
    assert.equal(recycled.originalBytesRemoved, 0);
    assert.equal(recycled.fallbackTrashPaths.length, 1);
    assert.equal(fs.readFileSync(recycled.fallbackTrashPaths[0], 'utf8'), 'photo');

    const retained = path.join(root, 'retained.jpg');
    fs.writeFileSync(retained, 'photo');
    const failure = await deletePhotoFiles([retained], {
      mode: 'trash', trashItem: async () => {}, purgeCache: async () => { throw new Error('Must not clean a retained photo'); },
    });
    assert.equal(failure.successCount, 0);
    assert.equal(failure.errors.length, 1);
    assert(fs.existsSync(retained));
    console.log('photo deletion and cache ownership tests passed');
  } finally {
    // root is a directory created by this test under the OS temporary directory.
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
