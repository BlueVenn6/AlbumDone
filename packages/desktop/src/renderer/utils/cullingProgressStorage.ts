import { taskProgressStorage as AsyncStorage } from './taskProgressStorage';

type CullingAlbumProgress = {
  version: 1;
  albumId: string;
  reviewedPhotoIds: string[];
  updatedAt: number;
};

function getStorageKey(albumId: string): string {
  return `photo-task:v1:culling:album-progress:${encodeURIComponent(albumId)}`;
}

export async function loadCullingAlbumProgress(
  albumId: string,
  availablePhotoIds: string[],
): Promise<CullingAlbumProgress | null> {
  const payload = await AsyncStorage.getItem(getStorageKey(albumId));
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as Partial<CullingAlbumProgress>;
    if (
      parsed.version !== 1
      || parsed.albumId !== albumId
      || !Array.isArray(parsed.reviewedPhotoIds)
    ) {
      return null;
    }
    const available = new Set(availablePhotoIds);
    const reviewedPhotoIds = [...new Set(parsed.reviewedPhotoIds)]
      .filter((photoId): photoId is string => typeof photoId === 'string' && available.has(photoId));
    return {
      version: 1,
      albumId,
      reviewedPhotoIds,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function saveCullingAlbumProgress(
  albumId: string,
  reviewedPhotoIds: string[],
): Promise<void> {
  const progress: CullingAlbumProgress = {
    version: 1,
    albumId,
    reviewedPhotoIds: [...new Set(reviewedPhotoIds)],
    updatedAt: Date.now(),
  };
  await AsyncStorage.setItem(getStorageKey(albumId), JSON.stringify(progress));
}

export async function clearCullingAlbumProgress(albumId: string): Promise<void> {
  await AsyncStorage.removeItem(getStorageKey(albumId));
}
