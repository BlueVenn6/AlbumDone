const assert = require('assert');
const {
  createAlbumSnapshot,
  getCanonicalPhotoIdentity,
  removePhotosFromAlbumSnapshot,
} = require('../dist/utils/albumSnapshot');

function photo(index, albumId = 'album') {
  return {
    id: `photo-${index}`,
    uri: `local-file:///C:/Photos/image-${index}.jpg`,
    filename: `image-${index}.jpg`,
    timestamp: 1_700_000_000_000 + index,
    width: 4000,
    height: 3000,
    fileSize: 2_000_000 + index,
    isScreenshot: false,
    tags: [],
    albumId,
  };
}

const requiredSizes = [
  0, 1, 49, 50, 51, 99, 100, 101, 199, 200, 201,
  499, 500, 501, 1000, 3000, 5000, 10000,
];

for (const size of requiredSizes) {
  const photos = Array.from({ length: size }, (_, index) => photo(index));
  const snapshot = createAlbumSnapshot('album', photos, {
    createdAt: 123,
    belongsToAlbum: (candidate, albumId) => candidate.albumId === albumId,
  });
  assert.strictEqual(snapshot.count, size);
  assert.strictEqual(
    snapshot.totalBytes,
    photos.reduce((total, item) => total + item.fileSize, 0),
  );
  assert.match(snapshot.snapshotKey, new RegExp(`^album-v1:${size}:`));
  assert.strictEqual(snapshot.photos.length, size);
  assert.strictEqual(snapshot.createdAt, 123);
  assert.strictEqual(snapshot.duplicateCount, 0);
  assert.strictEqual(snapshot.outOfScopeCount, 0);
}

{
  const original = createAlbumSnapshot('album', [photo(1), photo(2)]);
  const repeated = createAlbumSnapshot('album', [photo(1), photo(2)]);
  const changed = createAlbumSnapshot('album', [photo(1), { ...photo(2), fileSize: 123 }]);
  assert.strictEqual(original.snapshotKey, repeated.snapshotKey);
  assert.notStrictEqual(original.snapshotKey, changed.snapshotKey);
}

{
  const first = photo(1);
  const duplicateId = { ...photo(2), id: first.id };
  const duplicatePathAlias = {
    ...photo(3),
    uri: 'local-photo:///c:/photos/image-1.jpg',
  };
  const outOfScope = photo(4, 'other-album');
  const snapshot = createAlbumSnapshot(
    'album',
    [first, duplicateId, duplicatePathAlias, outOfScope],
    { belongsToAlbum: (candidate, albumId) => candidate.albumId === albumId },
  );

  assert.strictEqual(snapshot.count, 1);
  assert.strictEqual(snapshot.duplicateCount, 2);
  assert.strictEqual(snapshot.outOfScopeCount, 1);
}

{
  const snapshot = createAlbumSnapshot('album', [photo(1), photo(2), photo(3)]);
  const afterDelete = removePhotosFromAlbumSnapshot(snapshot, new Set(['photo-2']));
  assert.strictEqual(afterDelete.count, 2);
  assert.strictEqual(afterDelete.totalBytes, photo(1).fileSize + photo(3).fileSize);
  assert.notStrictEqual(afterDelete.snapshotKey, snapshot.snapshotKey);
  assert.deepStrictEqual(afterDelete.photos.map((item) => item.id), ['photo-1', 'photo-3']);
  assert.strictEqual(snapshot.count, 3);
}

assert.strictEqual(
  getCanonicalPhotoIdentity({ id: 'a', uri: 'local-file:///C:/Photos/Test.jpg' }),
  getCanonicalPhotoIdentity({ id: 'b', uri: 'local-photo:///c:/photos/test.jpg' }),
);

console.log('album snapshot/count consistency tests passed');
