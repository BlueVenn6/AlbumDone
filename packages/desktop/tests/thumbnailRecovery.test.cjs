const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getExistingThumbnailPath,
  getThumbnailCacheRoot,
} = require('../dist/main/thumbnailCache.js');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'albumdone-thumbnail-test-'));
const userDataPath = path.join(tempRoot, 'user-data');
const thumbnailRoot = getThumbnailCacheRoot(userDataPath);

try {
  assert.strictEqual(
    thumbnailRoot,
    path.join(path.resolve(userDataPath), 'thumbnails-v1'),
    'thumbnail cache must live under persistent user data',
  );

  fs.mkdirSync(thumbnailRoot, { recursive: true });
  const missingThumbnail = path.join(thumbnailRoot, 'missing.jpg');
  const emptyThumbnail = path.join(thumbnailRoot, 'empty.jpg');
  const validThumbnail = path.join(thumbnailRoot, 'valid.jpg');

  fs.writeFileSync(emptyThumbnail, '');
  fs.writeFileSync(validThumbnail, 'valid thumbnail');

  assert.strictEqual(getExistingThumbnailPath(null), null);
  assert.strictEqual(getExistingThumbnailPath(missingThumbnail), null);
  assert.strictEqual(getExistingThumbnailPath(emptyThumbnail), null);
  assert.strictEqual(getExistingThumbnailPath(thumbnailRoot), null);
  assert.strictEqual(getExistingThumbnailPath(validThumbnail), path.resolve(validThumbnail));

  fs.unlinkSync(validThumbnail);
  assert.strictEqual(
    getExistingThumbnailPath(validThumbnail),
    null,
    'deleted cache files must not remain valid database references',
  );

  const ipcSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/ipc.ts'),
    'utf8',
  );
  assert.match(ipcSource, /getThumbnailCacheRoot\(app\.getPath\('userData'\)\)/);
  assert.match(ipcSource, /getExistingThumbnailPath\(cachedRow\?\.thumbnail_path\)/);
  assert.match(ipcSource, /getExistingThumbnailPath\(row\.thumbnail_path\)/);
  assert.match(ipcSource, /require\('@napi-rs\/canvas'\)/);
  assert.doesNotMatch(ipcSource, /require\('canvas'\)/);

  const yearInReviewSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/yearInReview.ts'),
    'utf8',
  );
  assert.match(yearInReviewSource, /require\('@napi-rs\/canvas'\)/);
  assert.doesNotMatch(yearInReviewSource, /require\('canvas'\)/);

  const desktopPackage = require('../package.json');
  assert.strictEqual(desktopPackage.dependencies['@napi-rs/canvas'] !== undefined, true);
  assert.strictEqual(desktopPackage.optionalDependencies?.canvas, undefined);

  const sharedPackage = require('../../shared/package.json');
  assert.strictEqual(sharedPackage.dependencies['@napi-rs/canvas'] !== undefined, true);
  assert.strictEqual(sharedPackage.optionalDependencies?.canvas, undefined);

  const hookSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/hooks/usePhotoThumbnail.ts'),
    'utf8',
  );
  assert.doesNotMatch(hookSource, /rememberThumbnail\(cacheKey, initialSrc\)/);
  assert.match(hookSource, /const onLoadError = useCallback/);
  assert.match(hookSource, /thumbnailUriCache\.delete\(cacheKey\)/);
  assert.match(hookSource, /lastAutoRetryUri\.current !== src/);

  const batchSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/BatchCullingGrid.tsx'),
    'utf8',
  );
  const fullscreenSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/FullscreenCulling.tsx'),
    'utf8',
  );
  assert.match(batchSource, /onError=\{thumbnail\.onLoadError\}/);
  assert.match(fullscreenSource, /preview\.onLoadError\(\)/);
  assert.match(fullscreenSource, /onError=\{thumbnail\.onLoadError\}/);

  console.log('desktop thumbnail recovery tests passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
