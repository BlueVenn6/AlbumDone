import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const THUMBNAIL_CACHE_VERSION = 'thumbnails-v1';

export function getThumbnailCacheRoot(userDataPath: string): string {
  return path.join(path.resolve(userDataPath), THUMBNAIL_CACHE_VERSION);
}

export async function removeLegacyPhotoCacheFiles(cacheRoot: string): Promise<void> {
  const entries = await fs.promises.readdir(cacheRoot).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  // Previous generated names omitted the owner. They cannot be matched to a deleted asset.
  for (const name of entries.filter((entry) => /^[a-f0-9]{40}\.jpg$/.test(entry))) {
    const candidate = path.join(cacheRoot, name);
    const stats = await fs.promises.lstat(candidate);
    if (stats.isFile() && !stats.isSymbolicLink()) await fs.promises.unlink(candidate);
  }
}

export function getPhotoCacheOwnerPrefix(filePath: string): string {
  const normalized = path.resolve(filePath);
  return createHash('sha256').update(process.platform === 'win32' ? normalized.toLowerCase() : normalized)
    .digest('hex') + '-';
}

export async function purgePhotoCacheFiles(cacheRoot: string, filePath: string, legacyPaths: string[] = []): Promise<number> {
  const root = path.resolve(cacheRoot);
  const prefix = getPhotoCacheOwnerPrefix(filePath);
  const entries = await fs.promises.readdir(root).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  const candidates = new Set([
    ...entries.filter((name) => name.startsWith(prefix) && /^[a-f0-9]{64}-[a-f0-9]{40}\.jpg$/.test(name))
      .map((name) => path.join(root, name)),
    ...legacyPaths.map((candidate) => path.resolve(candidate))
      .filter((candidate) => path.dirname(candidate) === root && /^[a-f0-9]{40}\.jpg$/.test(path.basename(candidate))),
  ]);
  let removedBytes = 0;
  for (const candidate of candidates) {
    try {
      const stats = await fs.promises.lstat(candidate);
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
      await fs.promises.unlink(candidate);
      removedBytes += stats.size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return removedBytes;
}

export function getExistingThumbnailPath(candidatePath: string | null | undefined): string | null {
  if (!candidatePath) {
    return null;
  }

  const resolvedPath = path.resolve(candidatePath);
  try {
    const stats = fs.statSync(resolvedPath);
    return stats.isFile() && stats.size > 0 ? resolvedPath : null;
  } catch {
    return null;
  }
}
