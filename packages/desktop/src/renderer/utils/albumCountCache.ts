type AlbumWithPhotoCount = {
  id: string;
  photoCount: number;
  totalBytes?: number;
};

const albumCountCache = new Map<string, number>();
const albumByteSizeCache = new Map<string, number>();
const ALBUM_COUNT_EVENT = 'photo-manager:album-count-updated';

function isValidCount(count: number): boolean {
  return Number.isFinite(count) && count >= 0;
}

export function getCachedAlbumCount(albumId: string | undefined): number | null {
  if (!albumId) return null;
  return albumCountCache.get(albumId) ?? null;
}

export function setCachedAlbumCount(
  albumId: string | undefined,
  count: number,
  totalBytes?: number,
): void {
  if (!albumId || !isValidCount(count)) return;
  albumCountCache.set(albumId, count);
  if (totalBytes !== undefined && isValidCount(totalBytes)) {
    albumByteSizeCache.set(albumId, totalBytes);
  }

  window.dispatchEvent(
    new CustomEvent(ALBUM_COUNT_EVENT, {
      detail: { albumId, count, ...(totalBytes !== undefined ? { totalBytes } : {}) },
    }),
  );
}

export function applyCachedAlbumCounts<T extends AlbumWithPhotoCount>(albums: T[]): T[] {
  return albums.map((album) => {
    const cachedCount = getCachedAlbumCount(album.id);
    const cachedTotalBytes = albumByteSizeCache.get(album.id);
    return {
      ...album,
      ...(cachedCount === null ? {} : { photoCount: cachedCount }),
      ...(cachedTotalBytes === undefined ? {} : { totalBytes: cachedTotalBytes }),
    };
  });
}

export function subscribeToAlbumCountUpdates(
  listener: (albumId: string, count: number, totalBytes?: number) => void,
): () => void {
  const handleUpdate = (event: Event) => {
    const detail = (event as CustomEvent<{
      albumId?: string;
      count?: number;
      totalBytes?: number;
    }>).detail;
    if (!detail?.albumId || typeof detail.count !== 'number' || !isValidCount(detail.count)) {
      return;
    }
    listener(detail.albumId, detail.count, detail.totalBytes);
  };

  window.addEventListener(ALBUM_COUNT_EVENT, handleUpdate);
  return () => window.removeEventListener(ALBUM_COUNT_EVENT, handleUpdate);
}

export async function updateAlbumCountAfterLocalDelete(
  albumId: string | undefined,
  immediateCount: number,
): Promise<void> {
  if (!albumId || !isValidCount(immediateCount) || !window.electronAPI) {
    return;
  }

  setCachedAlbumCount(albumId, immediateCount);

  try {
    await window.electronAPI.saveAlbum(albumId, immediateCount);
  } catch (err) {
    console.error('[album-count] failed to save immediate count:', err);
  }

  void (async () => {
    try {
      const exactStats = await window.electronAPI!.getAlbumStats(albumId);
      setCachedAlbumCount(albumId, exactStats.photoCount, exactStats.totalBytes);
      await window.electronAPI!.saveAlbum(
        albumId,
        exactStats.photoCount,
        exactStats.totalBytes,
      );
    } catch (err) {
      console.error('[album-count] failed to refresh exact count:', err);
    }
  })();
}
