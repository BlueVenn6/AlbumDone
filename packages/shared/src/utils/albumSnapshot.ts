import type { Photo } from '../types';
import { localFileUriToPath, isLocalPhotoUri } from './photoUri';

export type AlbumSnapshot = {
  albumId: string;
  snapshotKey: string;
  photos: Photo[];
  count: number;
  totalBytes: number;
  createdAt: number;
  duplicateCount: number;
  outOfScopeCount: number;
};

function hashSnapshotPart(hash: number, value: string): number {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 16777619);
  }
  return next >>> 0;
}

export type AlbumSnapshotOptions = {
  createdAt?: number;
  belongsToAlbum?: (photo: Photo, albumId: string) => boolean;
};

function normalizeWindowsPath(value: string): string {
  return value
    .replace(/^\\\\\?\\/, '')
    .replace(/\//g, '\\')
    .toLowerCase();
}

export function getCanonicalPhotoIdentity(photo: Pick<Photo, 'id' | 'uri'>): string {
  const uri = photo.uri.trim();
  if (isLocalPhotoUri(uri) || /^[a-z]:[\\/]/i.test(uri) || /^\\\\/.test(uri)) {
    return `path:${normalizeWindowsPath(localFileUriToPath(uri))}`;
  }

  if (/^file:\/\//i.test(uri)) {
    try {
      const parsed = new URL(uri);
      return `path:${normalizeWindowsPath(decodeURIComponent(parsed.pathname))}`;
    } catch {
      return `uri:${uri}`;
    }
  }

  return uri ? `uri:${uri}` : `id:${photo.id.trim()}`;
}

export function createAlbumSnapshotKey(albumId: string, photos: readonly Photo[]): string {
  let identityHash = hashSnapshotPart(2166136261, albumId);
  let metadataHash = 2246822507;
  for (const photo of photos) {
    identityHash = hashSnapshotPart(identityHash, getCanonicalPhotoIdentity(photo));
    metadataHash = hashSnapshotPart(
      metadataHash,
      `${photo.timestamp}:${photo.fileSize}:${photo.width}x${photo.height}`,
    );
  }
  return `album-v1:${photos.length}:${identityHash.toString(16).padStart(8, '0')}:${metadataHash.toString(16).padStart(8, '0')}`;
}

export function createAlbumSnapshot(
  albumId: string,
  photos: readonly Photo[],
  options: AlbumSnapshotOptions = {},
): AlbumSnapshot {
  if (!albumId.trim()) {
    throw new Error('albumId must be a non-empty string.');
  }

  const uniquePhotos: Photo[] = [];
  const seenIds = new Set<string>();
  const seenIdentities = new Set<string>();
  let duplicateCount = 0;
  let outOfScopeCount = 0;

  for (const photo of photos) {
    if (options.belongsToAlbum && !options.belongsToAlbum(photo, albumId)) {
      outOfScopeCount += 1;
      continue;
    }

    const id = photo.id.trim();
    const identity = getCanonicalPhotoIdentity(photo);
    if ((id && seenIds.has(id)) || seenIdentities.has(identity)) {
      duplicateCount += 1;
      continue;
    }

    if (id) {
      seenIds.add(id);
    }
    seenIdentities.add(identity);
    uniquePhotos.push(photo);
  }

  return {
    albumId,
    snapshotKey: createAlbumSnapshotKey(albumId, uniquePhotos),
    photos: uniquePhotos,
    count: uniquePhotos.length,
    totalBytes: uniquePhotos.reduce(
      (total, photo) => total + (Number.isFinite(photo.fileSize) ? Math.max(0, photo.fileSize) : 0),
      0,
    ),
    createdAt: options.createdAt ?? Date.now(),
    duplicateCount,
    outOfScopeCount,
  };
}

export function removePhotosFromAlbumSnapshot(
  snapshot: AlbumSnapshot,
  deletedPhotoIds: ReadonlySet<string>,
): AlbumSnapshot {
  if (deletedPhotoIds.size === 0) {
    return snapshot;
  }

  const photos = snapshot.photos.filter((photo) => !deletedPhotoIds.has(photo.id));
  return {
    ...snapshot,
    snapshotKey: createAlbumSnapshotKey(snapshot.albumId, photos),
    photos,
    count: photos.length,
    totalBytes: photos.reduce(
      (total, photo) => total + (Number.isFinite(photo.fileSize) ? Math.max(0, photo.fileSize) : 0),
      0,
    ),
    createdAt: Date.now(),
  };
}
