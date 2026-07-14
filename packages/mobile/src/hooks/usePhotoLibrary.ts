import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import type {
  Album as CameraRollAlbum,
} from '@react-native-camera-roll/camera-roll';
import type { Album, Photo } from '@photo-manager/shared';
import { usePhotoStore, useTranslation } from '@photo-manager/shared';
import {
  getCachedMobileAlbumSnapshot,
  invalidateMobileAlbumSnapshot,
  loadMobileAlbumSnapshot,
} from '../utils/photoAlbumRepository';

type UsePhotoLibraryReturn = {
  albums: Album[];
  selectedAlbumId: string | null;
  photos: Photo[];
  isLoading: boolean;
  isImporting: boolean;
  hasPermission: boolean | null; // null = not yet determined
  error: string | null;
  importProgress: {
    albumId: string | null;
    loaded: number;
    totalEstimate: number | null;
    page: number;
    status: 'idle' | 'loading' | 'done' | 'cancelled' | 'error';
  };
  requestPermission: () => Promise<void>;
  importLocalFolder: (() => Promise<void>) | null;
  setSelectedAlbum: (albumId: string | null) => void;
  cancelImport: () => void;
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
};

type AndroidPermission = Parameters<typeof PermissionsAndroid.request>[0];
type WebCameraRollImportResult = {
  albumId: string | null;
  count: number;
  cancelled?: boolean;
};
type WebCameraRoll = typeof CameraRoll & {
  importLocalFolder?: () => Promise<WebCameraRollImportResult>;
};
const READ_MEDIA_IMAGES_PERMISSION = (
  PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES ?? 'android.permission.READ_MEDIA_IMAGES'
) as AndroidPermission;
const READ_EXTERNAL_STORAGE_PERMISSION = (
  PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE ?? 'android.permission.READ_EXTERNAL_STORAGE'
) as AndroidPermission;
const READ_MEDIA_VISUAL_USER_SELECTED_PERMISSION =
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED' as AndroidPermission;
const PREFERRED_ALBUM_PATTERNS = [
  /^(camera|camera roll|recents|recently added|all photos)$/i,
  /(\u76f8\u673a|\u76f8\u6a5f|\u6700\u8fd1\u9879\u76ee|\u6700\u8fd1\u9805\u76ee|\u6700\u8fd1\u52a0\u5165|\u6240\u6709\u7167\u7247|\u5168\u90e8\u7167\u7247)/,
  /(wechat|weixin|\u5fae\u4fe1|mmexport)/i,
  /(whatsapp|telegram|line|signal|messenger)/i,
  /(screenshots?|\u622a\u5c4f|\u622a\u56fe|\u87a2\u5e55\u622a\u5716|\u622a\u5716)/i,
  /(pictures|photos|dcim|image|\u56fe\u7247|\u5716\u7247|\u7167\u7247)/i,
];

function getAndroidSdkVersion(): number {
  if (typeof Platform.Version === 'number') return Platform.Version;
  const parsed = Number.parseInt(String(Platform.Version), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function requestAndroidPermission(): Promise<boolean> {
  try {
    const sdkVersion = getAndroidSdkVersion();
    if (sdkVersion >= 34) {
      const results = await PermissionsAndroid.requestMultiple([
        READ_MEDIA_IMAGES_PERMISSION,
        READ_MEDIA_VISUAL_USER_SELECTED_PERMISSION,
      ]);
      return (
        results[READ_MEDIA_IMAGES_PERMISSION] === PermissionsAndroid.RESULTS.GRANTED
        || results[READ_MEDIA_VISUAL_USER_SELECTED_PERMISSION] === PermissionsAndroid.RESULTS.GRANTED
      );
    }

    if (sdkVersion >= 33) {
      const result = await PermissionsAndroid.request(
        READ_MEDIA_IMAGES_PERMISSION,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } else {
      const result = await PermissionsAndroid.request(
        READ_EXTERNAL_STORAGE_PERMISSION,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch {
    return false;
  }
}

function getAlbumPriority(album: Album): number {
  if (album.id === '__all__' || album.count <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const searchableName = `${album.id} ${album.title}`.trim();
  const patternIndex = PREFERRED_ALBUM_PATTERNS.findIndex((pattern) => pattern.test(searchableName));
  return patternIndex === -1 ? PREFERRED_ALBUM_PATTERNS.length : patternIndex;
}

function sortAlbumsForDisplay(albums: Album[]): Album[] {
  return [...albums].sort((a, b) => {
    const priorityDiff = getAlbumPriority(a) - getAlbumPriority(b);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return b.count - a.count;
  });
}

function pickInitialAlbum(albums: Album[]): Album | null {
  const realAlbums = albums.filter((album) => album.id !== '__all__' && album.count > 0);
  if (realAlbums.length === 0) {
    return albums[0] ?? null;
  }

  return sortAlbumsForDisplay(realAlbums)[0] ?? albums[0] ?? null;
}

export function usePhotoLibrary(): UsePhotoLibraryReturn {
  const { t } = useTranslation();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<UsePhotoLibraryReturn['importProgress']>({
    albumId: null,
    loaded: 0,
    totalEstimate: null,
    page: 0,
    status: 'idle',
  });
  const activeImportId = useRef(0);
  const retryRequest = useRef<{ albumId: string } | null>(null);
  const autoLoadedAlbumId = useRef<string | null>(null);

  const store = usePhotoStore();
  const { selectedAlbumId, photos, setAlbums: storeSetAlbums, setSelectedAlbum, loadPhotos } = store;
  const storeAlbums = store.albums;

  useEffect(() => {
    if (storeAlbums.length > 0) {
      setAlbums(storeAlbums);
    }
  }, [storeAlbums]);

  const loadAlbums = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const albumResult = await CameraRoll.getAlbums({
        assetType: 'Photos',
      });

      const previousAlbums = usePhotoStore.getState().albums;
      const previousExactCounts = new Map(
        previousAlbums
          .filter((album) => album.countIsExact)
          .map((album) => [album.id, album.count]),
      );
      const previousExactBytes = new Map(
        previousAlbums
          .filter((album) => album.countIsExact && album.totalBytes !== undefined)
          .map((album) => [album.id, album.totalBytes!]),
      );
      const albumList: Album[] = (albumResult as CameraRollAlbum[]).map((a) => {
        const totalBytes = previousExactBytes.get(a.title);
        return {
          id: a.title,
          title: a.title,
          count: previousExactCounts.get(a.title) ?? a.count,
          countIsExact: true,
          ...(totalBytes === undefined ? {} : { totalBytes }),
        };
      });

      const cachedAllSnapshot = getCachedMobileAlbumSnapshot('__all__');
      const previousAllBytes = previousExactBytes.get('__all__');
      const allAlbum: Album = {
        id: '__all__',
        title: t('common.allPhotos'),
        count: cachedAllSnapshot?.count ?? previousExactCounts.get('__all__') ?? 0,
        countIsExact: Boolean(cachedAllSnapshot || previousExactCounts.has('__all__')),
        ...(cachedAllSnapshot
          ? { totalBytes: cachedAllSnapshot.totalBytes }
          : previousAllBytes !== undefined
            ? { totalBytes: previousAllBytes }
            : {}),
      };

      const finalAlbums = [allAlbum, ...sortAlbumsForDisplay(albumList)];
      setAlbums(finalAlbums);
      storeSetAlbums(finalAlbums);
      if (!usePhotoStore.getState().selectedAlbumId) {
        const initialAlbum = pickInitialAlbum(finalAlbums);
        if (initialAlbum) {
          setSelectedAlbum(initialAlbum.id);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.unknownError');
      setError(t('photoLibrary.albumLoadFailed', { message }));
    } finally {
      setIsLoading(false);
    }
  }, [storeSetAlbums, t]);

  const requestPermission = useCallback(async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await requestAndroidPermission();
        setHasPermission(granted);
        if (granted) {
          await loadAlbums();
        } else {
          setError(t('photoLibrary.missingPhotoPermission'));
        }
      } else {
        // iOS: CameraRoll handles permission request automatically
        await loadAlbums();
        setHasPermission(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.unknownError');
      setError(t('photoLibrary.permissionRequestFailed', { message }));
      setHasPermission(false);
    }
  }, [loadAlbums, t]);

  const loadPhotosForAlbum = useCallback(
    async (albumId: string, force = false) => {
      const importId = activeImportId.current + 1;
      activeImportId.current = importId;
      setIsLoading(true);
      setIsImporting(true);
      setError(null);
      retryRequest.current = null;
      const totalEstimate = albums.find((album) => album.id === albumId)?.count ?? null;
      setImportProgress({
        albumId,
        loaded: 0,
        totalEstimate,
        page: 0,
        status: 'loading',
      });
      loadPhotos([]);

      try {
        const snapshot = await loadMobileAlbumSnapshot(albumId, {
          force,
          shouldCancel: () => activeImportId.current !== importId,
          onProgress: (progress) => {
            if (activeImportId.current !== importId) return;
            setImportProgress({
              albumId,
              loaded: progress.loaded,
              totalEstimate,
              page: progress.page,
              status: 'loading',
            });
          },
          onBatch: (batch) => {
            if (activeImportId.current !== importId) return;
            usePhotoStore.getState().addPhotos(batch);
          },
        });
        if (activeImportId.current !== importId) {
          return;
        }

        loadPhotos(snapshot.photos);
        setAlbums((current) => {
          const next = current.map((album) =>
            album.id === albumId
              ? {
                  ...album,
                  count: snapshot.count,
                  countIsExact: true,
                  totalBytes: snapshot.totalBytes,
                }
              : album,
          );
          storeSetAlbums(next);
          return next;
        });
        setImportProgress({
          albumId,
          loaded: snapshot.count,
          totalEstimate: snapshot.count,
          page: Math.max(1, Math.ceil(snapshot.count / 200)),
          status: 'done',
        });
      } catch (err) {
        if (activeImportId.current !== importId) {
          return;
        }
        const message = err instanceof Error ? err.message : t('common.unknownError');
        setError(t('photoLibrary.photoLoadFailed', { message }));
        retryRequest.current = { albumId };
        setImportProgress((previous) => ({
          ...previous,
          status: 'error',
        }));
      } finally {
        if (activeImportId.current === importId) {
          setIsLoading(false);
          setIsImporting(false);
        }
      }
    },
    [albums, loadPhotos, storeSetAlbums, t],
  );

  const handleSetSelectedAlbum = useCallback(
    (albumId: string | null) => {
      activeImportId.current += 1;
      autoLoadedAlbumId.current = null;
      retryRequest.current = null;
      setSelectedAlbum(albumId);
      loadPhotos([]);
      setImportProgress({
        albumId,
        loaded: 0,
        totalEstimate: albums.find((album) => album.id === albumId)?.count ?? null,
        page: 0,
        status: 'idle',
      });
    },
    [albums, loadPhotos, setSelectedAlbum],
  );

  useEffect(() => {
    if (!selectedAlbumId || autoLoadedAlbumId.current === selectedAlbumId) {
      return;
    }
    if (!albums.some((album) => album.id === selectedAlbumId)) {
      return;
    }

    autoLoadedAlbumId.current = selectedAlbumId;
    void loadPhotosForAlbum(selectedAlbumId);
  }, [albums, loadPhotosForAlbum, selectedAlbumId]);

  const cancelImport = useCallback(() => {
    activeImportId.current += 1;
    setIsLoading(false);
    setIsImporting(false);
    setImportProgress((previous) => ({
      ...previous,
      status: 'cancelled',
    }));
  }, []);

  const retry = useCallback(async () => {
    const request = retryRequest.current;
    if (!request) {
      if (selectedAlbumId) {
        await loadPhotosForAlbum(selectedAlbumId, true);
      }
      return;
    }
    await loadPhotosForAlbum(request.albumId, true);
  }, [loadPhotosForAlbum, selectedAlbumId]);

  const refresh = useCallback(async () => {
    activeImportId.current += 1;
    invalidateMobileAlbumSnapshot(selectedAlbumId ?? undefined);
    await loadAlbums();
    if (selectedAlbumId) {
      autoLoadedAlbumId.current = null;
      await loadPhotosForAlbum(selectedAlbumId, true);
    }
  }, [loadAlbums, loadPhotosForAlbum, selectedAlbumId]);

  const importLocalFolder = useCallback(async () => {
    const importer = (CameraRoll as WebCameraRoll).importLocalFolder;
    if (typeof importer !== 'function') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await importer();
      if (result.cancelled || !result.albumId) {
        return;
      }

      await loadAlbums();
      handleSetSelectedAlbum(result.albumId);
    } catch (err) {
      const message = err instanceof Error && err.message === 'NO_READABLE_PHOTOS'
        ? t('home.errors.noReadablePhotos')
        : err instanceof Error
          ? err.message
          : t('common.unknownError');
      setError(t('photoLibrary.photoLoadFailed', { message }));
    } finally {
      setIsLoading(false);
    }
  }, [handleSetSelectedAlbum, loadAlbums, t]);

  // Initialize: check permission and load albums
  useEffect(() => {
    const init = async () => {
      if (Platform.OS === 'android') {
        const sdkVersion = getAndroidSdkVersion();
        const granted =
          sdkVersion >= 34
            ? (
                await PermissionsAndroid.check(READ_MEDIA_IMAGES_PERMISSION)
                || await PermissionsAndroid.check(
                  READ_MEDIA_VISUAL_USER_SELECTED_PERMISSION,
                )
              )
            : await PermissionsAndroid.check(
                sdkVersion >= 33
                  ? READ_MEDIA_IMAGES_PERMISSION
                  : READ_EXTERNAL_STORAGE_PERMISSION,
              );
        setHasPermission(granted);
        if (granted) {
          await loadAlbums();
        } else {
          setError(t('photoLibrary.missingPhotoPermission'));
        }
      } else {
        // On iOS, attempt to load (CameraRoll will prompt if needed)
        try {
          await loadAlbums();
          setHasPermission(true);
        } catch {
          setError(t('photoLibrary.checkPhotoPermission'));
          setHasPermission(false);
        }
      }
    };

    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAlbums, t]);

  return {
    albums,
    selectedAlbumId,
    photos,
    isLoading,
    isImporting,
    hasPermission,
    error,
    importProgress,
    requestPermission,
    importLocalFolder: Platform.OS === 'web' ? importLocalFolder : null,
    setSelectedAlbum: handleSetSelectedAlbum,
    cancelImport,
    retry,
    refresh,
  };
}
