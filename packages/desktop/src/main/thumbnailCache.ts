import * as fs from 'fs';
import * as path from 'path';

const THUMBNAIL_CACHE_VERSION = 'thumbnails-v1';

export function getThumbnailCacheRoot(userDataPath: string): string {
  return path.join(path.resolve(userDataPath), THUMBNAIL_CACHE_VERSION);
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
