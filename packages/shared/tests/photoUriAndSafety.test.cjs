const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const {
  localFileUriToPath,
  normalizePhotoUri,
  pathToLocalFileUri,
} = require('../dist/utils/photoUri');

const nativePath = 'C:\\Users\\ExampleUser\\照片 空格\\春节.jpg';
const uri = pathToLocalFileUri(nativePath);
assert.ok(uri.startsWith('local-file:///'));
assert.strictEqual(normalizePhotoUri(uri), uri);
assert.strictEqual(normalizePhotoUri(uri.replace('local-file:///', 'local-photo:///')), uri);
assert.ok(localFileUriToPath(uri).includes('春节.jpg'));
assert.ok(localFileUriToPath(pathToLocalFileUri('C:\\Users\\ExampleUser\\OneDrive - Photos\\长路径 '.repeat(8) + 'a.jpg')).includes('OneDrive'));

const specialCharsPath = 'C:\\Users\\ExampleUser\\照片 #1\\holiday?final&keep.jpg';
const specialCharsUri = pathToLocalFileUri(specialCharsPath);
assert.ok(specialCharsUri.includes('%231'));
assert.ok(specialCharsUri.includes('holiday%3Ffinal%26keep.jpg'));
assert.strictEqual(localFileUriToPath(specialCharsUri), specialCharsPath);

function importSignature(filePath, size, mtime) {
  return `${path.resolve(filePath)}|${size}|${mtime}`;
}
assert.strictEqual(
  importSignature('C:/Photos/a.jpg', 123, 456),
  importSignature('C:/Photos/a.jpg', 123, 456),
);
assert.notStrictEqual(
  importSignature('C:/Photos/a.jpg', 123, 456),
  importSignature('C:/Photos/a.jpg', 124, 456),
);

function thumbnailKey(filePath, size, sourceSize, mtimeMs) {
  return crypto.createHash('sha1')
    .update(JSON.stringify({ filePath: path.resolve(filePath), size, sourceSize, mtimeMs }))
    .digest('hex');
}
assert.strictEqual(
  thumbnailKey('C:/Photos/a.jpg', 200, 123, 456),
  thumbnailKey('C:/Photos/a.jpg', 200, 123, 456),
);
assert.notStrictEqual(
  thumbnailKey('C:/Photos/a.jpg', 200, 123, 456),
  thumbnailKey('C:/Photos/a.jpg', 320, 123, 456),
);

function isSafeDeleteTarget(root, candidate) {
  const resolvedRoot = path.resolve(root).toLowerCase();
  const resolvedCandidate = path.resolve(candidate).toLowerCase();
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
assert.ok(isSafeDeleteTarget('C:/Photos', 'C:/Photos/a.jpg'));
assert.ok(!isSafeDeleteTarget('C:/Photos', 'C:/Windows/system32/not-a-photo.jpg'));
assert.ok(!isSafeDeleteTarget('C:/Photos', 'C:/Photos/../Windows/system32/not-a-photo.jpg'));

function protocolPathAllowed(allowedRoot, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const resolvedRoot = path.resolve(allowedRoot).toLowerCase();
  const resolvedPath = path.resolve(decoded).toLowerCase();
  const relative = path.relative(resolvedRoot, resolvedPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
assert.ok(protocolPathAllowed('C:/Users/Alice/照片 空格', 'C:/Users/Alice/%E7%85%A7%E7%89%87%20%E7%A9%BA%E6%A0%BC/a.jpg'));
assert.ok(!protocolPathAllowed('C:/Users/Alice/照片 空格', 'C:/Users/Alice/%E7%85%A7%E7%89%87%20%E7%A9%BA%E6%A0%BC/../../Windows/win.ini'));

console.log('photoUri/import/thumbnail/delete safety tests passed');
