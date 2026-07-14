import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import type { Photo } from '@photo-manager/shared';
import { usePhotoStore } from '@photo-manager/shared';

// Each CameraRoll.deletePhotos call can trigger a system confirmation prompt on Android.
// Keep normal culling batches (400-600 photos) in one request, while still avoiding
// very large URI payloads that some Android versions reject.
const DELETE_REQUEST_BATCH_SIZE = 1000;

export type DeletePhotosResult = {
  deletedIds: Set<string>;
  errors: string[];
};

export type DeletePhotosProgress = {
  attemptedIds: string[];
  deletedIds: string[];
  failedIds: string[];
};

export type DeletePhotosOptions = {
  onBatch?: (progress: DeletePhotosProgress) => void | Promise<void>;
};

function uniquePhotos(photos: Photo[]): Photo[] {
  const byId = new Map<string, Photo>();
  for (const photo of photos) {
    if (!byId.has(photo.id)) {
      byId.set(photo.id, photo);
    }
  }
  return [...byId.values()];
}

export async function deletePhotosFromLibrary(
  photos: Photo[],
  options: DeletePhotosOptions = {},
): Promise<DeletePhotosResult> {
  const candidates = uniquePhotos(photos).filter((photo) => photo.uri.trim());
  const deletedIds = new Set<string>();
  const errors: string[] = [];

  for (let index = 0; index < candidates.length; index += DELETE_REQUEST_BATCH_SIZE) {
    const batch = candidates.slice(index, index + DELETE_REQUEST_BATCH_SIZE);
    try {
      await CameraRoll.deletePhotos(batch.map((photo) => photo.uri));
      batch.forEach((photo) => deletedIds.add(photo.id));
      await options.onBatch?.({
        attemptedIds: batch.map((photo) => photo.id),
        deletedIds: batch.map((photo) => photo.id),
        failedIds: [],
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      errors.push(detail);
      await options.onBatch?.({
        attemptedIds: batch.map((photo) => photo.id),
        deletedIds: [],
        failedIds: batch.map((photo) => photo.id),
      });
    }
  }

  return { deletedIds, errors };
}

export function applyDeletedPhotosToStore(deletedPhotos: Photo[]): void {
  const deletedIds = new Set(deletedPhotos.map((photo) => photo.id));
  if (deletedIds.size === 0) {
    return;
  }

  const albumDeleteCounts = new Map<string, number>();
  const albumDeleteBytes = new Map<string, number>();
  for (const photo of deletedPhotos) {
    if (photo.albumId) {
      albumDeleteCounts.set(
        photo.albumId,
        (albumDeleteCounts.get(photo.albumId) ?? 0) + 1,
      );
      albumDeleteBytes.set(
        photo.albumId,
        (albumDeleteBytes.get(photo.albumId) ?? 0) + Math.max(0, photo.fileSize),
      );
    }
  }

  const store = usePhotoStore.getState();
  store.removePhotosById([...deletedIds]);
  store.setAlbums(
    store.albums.map((album) => {
      const decrement = album.countIsExact && album.id === '__all__'
        ? deletedIds.size
        : albumDeleteCounts.get(album.id) ?? 0;
      const byteDecrement = album.id === '__all__'
        ? deletedPhotos.reduce((total, photo) => total + Math.max(0, photo.fileSize), 0)
        : albumDeleteBytes.get(album.id) ?? 0;

      return decrement > 0
        ? {
            ...album,
            count: Math.max(0, album.count - decrement),
            ...(album.totalBytes === undefined
              ? {}
              : { totalBytes: Math.max(0, album.totalBytes - byteDecrement) }),
          }
        : album;
    }),
  );
}
