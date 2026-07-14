const assert = require('assert');
const Module = require('module');

const allEdges = Array.from({ length: 5000 }, (_, index) => {
  const album = index < 501 ? 'Camera' : 'Archive';
  return {
    node: {
      id: `asset-${index}`,
      type: 'image/jpeg',
      subTypes: [],
      sourceType: 'UserLibrary',
      group_name: [album],
      image: {
        filename: `${album}-${index}.jpg`,
        filepath: null,
        extension: 'jpg',
        uri: `content://photos/${index}`,
        height: 3000,
        width: 4000,
        fileSize: 100000 + index,
        playableDuration: 0,
        orientation: 1,
      },
      timestamp: 1700000000 + index,
      modificationTimestamp: 1700000000 + index,
      location: null,
    },
  };
});

const cameraRollMock = {
  getPhotos: async (params) => {
    const source = params.groupTypes === 'Album'
      ? allEdges.filter((edge) => edge.node.group_name.includes(params.groupName))
      : allEdges;
    const start = params.after ? Number.parseInt(params.after, 10) : 0;
    const end = Math.min(source.length, start + params.first);
    return {
      edges: source.slice(start, end),
      page_info: {
        has_next_page: end < source.length,
        end_cursor: end < source.length ? String(end) : undefined,
      },
    };
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@react-native-camera-roll/camera-roll') {
    return { CameraRoll: cameraRollMock };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { scanPhotoAlbum } = require('../dist/mobile/src/utils/photoScanner');
Module._load = originalLoad;

(async () => {
  const progress = [];
  const all = await scanPhotoAlbum({
    albumId: '__all__',
    pageSize: 200,
    onProgress: (value) => progress.push(value),
  });
  assert.strictEqual(all.length, 5000);
  assert.strictEqual(new Set(all.map((photo) => photo.id)).size, 5000);
  assert.strictEqual(progress.at(-1).loaded, 5000);
  assert.strictEqual(progress.length, 25);

  const camera = await scanPhotoAlbum({ albumId: 'Camera', pageSize: 200 });
  assert.strictEqual(camera.length, 501);
  assert(camera.every((photo) => photo.tags.includes('Camera')));
  assert(camera.every((photo) => !photo.tags.includes('Archive')));

  console.log('mobile photo scanner pagination and album-scope tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
