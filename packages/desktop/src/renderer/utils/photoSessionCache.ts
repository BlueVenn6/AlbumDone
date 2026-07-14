import type { Photo } from '@photo-manager/shared';

const MAX_CACHED_ALBUMS = 4;
const albumPhotoCache = new Map<string, Photo[]>();

function touchAlbum(albumId: string, photos: Photo[]): void {
  if (albumPhotoCache.has(albumId)) {
    albumPhotoCache.delete(albumId);
  }
  albumPhotoCache.set(albumId, photos);

  while (albumPhotoCache.size > MAX_CACHED_ALBUMS) {
    const oldest = albumPhotoCache.keys().next().value;
    if (!oldest) break;
    albumPhotoCache.delete(oldest);
  }
}

export function getCachedAlbumPhotos(albumId: string | undefined): Photo[] | null {
  if (!albumId) return null;
  const photos = albumPhotoCache.get(albumId);
  if (!photos) return null;
  touchAlbum(albumId, photos);
  return photos;
}

export function setCachedAlbumPhotos(albumId: string | undefined, photos: Photo[]): void {
  if (!albumId) return;
  touchAlbum(albumId, photos);
}

export function updateCachedAlbumPhotosAfterDelete(albumId: string | undefined, deletedIds: Set<string>): void {
  if (!albumId || deletedIds.size === 0) return;
  const photos = albumPhotoCache.get(albumId);
  if (!photos) return;
  touchAlbum(albumId, photos.filter((photo) => !deletedIds.has(photo.id)));
}
