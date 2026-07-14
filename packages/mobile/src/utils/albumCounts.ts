import { usePhotoStore } from '@photo-manager/shared';

export function updateScannedAlbumCount(
  albumId: string,
  actualCount: number,
  totalBytes?: number,
): void {
  if (!Number.isFinite(actualCount) || actualCount < 0) {
    return;
  }

  const store = usePhotoStore.getState();
  store.setAlbums(
    store.albums.map((album) => {
      if (album.id === albumId) {
        return {
          ...album,
          count: actualCount,
          countIsExact: true,
          ...(totalBytes === undefined ? {} : { totalBytes }),
        };
      }
      return album;
    }),
  );
}
