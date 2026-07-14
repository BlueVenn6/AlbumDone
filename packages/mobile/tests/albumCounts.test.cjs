const assert = require('assert');
const { usePhotoStore } = require('@photo-manager/shared');
const { updateScannedAlbumCount } = require('../dist/mobile/src/utils/albumCounts');
const { getVerifiedDeletedPhotoIds } = require('../dist/mobile/src/utils/deleteVerification');

usePhotoStore.setState({
  albums: [
    { id: '__all__', title: 'All Photos', count: 5000, countIsExact: true, totalBytes: 10_000_000 },
    { id: 'Camera', title: 'Camera', count: 1200, countIsExact: true, totalBytes: 4_000_000 },
    { id: 'Screenshots', title: 'Screenshots', count: 300, countIsExact: true },
  ],
});

updateScannedAlbumCount('Camera', 1199, 3_900_000);
let albums = usePhotoStore.getState().albums;
assert.strictEqual(albums.find((album) => album.id === 'Camera').count, 1199);
assert.strictEqual(albums.find((album) => album.id === 'Camera').countIsExact, true);
assert.strictEqual(albums.find((album) => album.id === 'Camera').totalBytes, 3_900_000);
assert.strictEqual(albums.find((album) => album.id === '__all__').count, 5000);
assert.strictEqual(albums.find((album) => album.id === '__all__').totalBytes, 10_000_000);

updateScannedAlbumCount('__all__', 4799, 9_500_000);
albums = usePhotoStore.getState().albums;
assert.strictEqual(albums.find((album) => album.id === '__all__').count, 4799);
assert.strictEqual(albums.find((album) => album.id === '__all__').countIsExact, true);
assert.strictEqual(albums.find((album) => album.id === '__all__').totalBytes, 9_500_000);
assert.strictEqual(albums.find((album) => album.id === 'Screenshots').count, 300);

const reportedDeleted = new Set(['gone', 'still-present']);
const verifiedDeleted = getVerifiedDeletedPhotoIds(reportedDeleted, [
  { id: 'still-present' },
  { id: 'untouched' },
]);
assert.deepStrictEqual([...verifiedDeleted], ['gone']);

console.log('mobile album count source-of-truth tests passed');
