import { useEffect, useState } from 'react';
import { createAlbumSnapshot, usePhotoStore, useTranslation } from '@photo-manager/shared';
import type { Photo } from '@photo-manager/shared';
import { getCachedAlbumPhotos, setCachedAlbumPhotos } from '../utils/photoSessionCache';
import { setCachedAlbumCount } from '../utils/albumCountCache';

function photosBelongToAlbum(photos: Photo[], albumId: string): boolean {
  return photos.length > 0 && photos.every((photo) => photo.albumId === albumId);
}

/**
 * Loads photos for the given folder into usePhotoStore.
 * Re-runs only when folderPath changes.
 * Returns { loading, error } so screens can show a loading state.
 */
export function useLoadPhotos(
  folderPath: string | undefined,
  mode: 'fast' | 'full' = 'fast',
): {
  loading: boolean;
  error: string | null;
  loadedCount: number;
} {
  const [loading, setLoading] = useState(() => Boolean(folderPath));
  const [error, setError] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const { addPhotos, loadPhotos } = usePhotoStore();
  const { t } = useTranslation();

  useEffect(() => {
    if (!folderPath || !window.electronAPI?.getPhotos) {
      setLoading(false);
      return undefined;
    }

    const current = usePhotoStore.getState().photos;
    if (photosBelongToAlbum(current, folderPath)) {
      setCachedAlbumPhotos(folderPath, current);
    }

    const cachedPhotos = getCachedAlbumPhotos(folderPath);
    if (cachedPhotos && photosBelongToAlbum(cachedPhotos, folderPath)) {
      loadPhotos(cachedPhotos);
    }

    let cancelled = false;
    const scanId = `scan_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setLoading(true);
    setError(null);
    setLoadedCount(cachedPhotos?.length ?? 0);

    window.electronAPI
      .getPhotos(folderPath, {
        mode,
        scanId,
        onBatch: (batch, scanned) => {
          if (cancelled) return;
          const snapshot = createAlbumSnapshot(folderPath, batch, {
            belongsToAlbum: (photo, albumId) => photo.albumId === albumId,
          });
          addPhotos(snapshot.photos);
          setLoadedCount(scanned);
        },
      })
      .then((loaded: Photo[]) => {
        if (cancelled) return;
        const snapshot = createAlbumSnapshot(folderPath, loaded, {
          belongsToAlbum: (photo, albumId) => photo.albumId === albumId,
        });
        setCachedAlbumPhotos(folderPath, snapshot.photos);
        setCachedAlbumCount(folderPath, snapshot.count, snapshot.totalBytes);
        loadPhotos(snapshot.photos);
        setLoadedCount(snapshot.count);
        void window.electronAPI
          ?.saveAlbum(folderPath, snapshot.count, snapshot.totalBytes)
          .catch(() => null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('home.errors.loadPhotos'));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      void window.electronAPI?.cancelPhotoScan(scanId).catch(() => null);
    };
  }, [addPhotos, folderPath, loadPhotos, mode, t]);

  return { loading, error, loadedCount };
}
