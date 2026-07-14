const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const databasePath = path.resolve(process.argv[2] || '');
const albumPath = path.resolve(process.argv[3] || '');
const supportedExtensions = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif',
  '.heic', '.heif', '.tif', '.tiff', '.bmp',
]);

if (!databasePath || !albumPath) {
  throw new Error('Usage: electron audit-photo-index-count.cjs <database> <album-path>');
}

function walk(root) {
  const files = [];
  const directories = [root];
  while (directories.length > 0) {
    const current = directories.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) directories.push(entryPath);
      else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

const database = new Database(databasePath, { readonly: true });
const indexedPaths = database.prepare(
  'SELECT file_path FROM photo_index WHERE album_id = ?',
).all(albumPath).map((row) => row.file_path);
database.close();

const diskPaths = walk(albumPath);
const diskByKey = new Map(diskPaths.map((filePath) => [filePath.toLowerCase(), filePath]));
const indexedByKey = new Map(indexedPaths.map((filePath) => [filePath.toLowerCase(), filePath]));
const missingFromIndex = [...diskByKey].flatMap(([key, filePath]) =>
  indexedByKey.has(key) ? [] : [filePath]);
const staleIndexEntries = [...indexedByKey].flatMap(([key, filePath]) =>
  diskByKey.has(key) ? [] : [filePath]);

console.log(JSON.stringify({
  diskCount: diskPaths.length,
  diskUniqueCount: diskByKey.size,
  indexedCount: indexedPaths.length,
  indexedUniqueCount: indexedByKey.size,
  missingFromIndexCount: missingFromIndex.length,
  missingFromIndex: missingFromIndex.slice(0, 20),
  staleIndexEntryCount: staleIndexEntries.length,
  staleIndexEntries: staleIndexEntries.slice(0, 20),
}, null, 2));
