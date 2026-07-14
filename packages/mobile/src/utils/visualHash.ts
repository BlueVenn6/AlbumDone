import { selectDedupeSignatureCandidates, type Photo } from '@photo-manager/shared';
import {
  computeNativeContentHashes,
  computeNativeVisualHashes,
} from './nativeAppDevice';

const MOBILE_VISUAL_HASH_BATCH_SIZE = 24;

export async function addDedupeSignaturesToPhotos(
  photos: Photo[],
  options: {
    shouldCancel?: () => boolean;
    onProgress?: (
      processed: number,
      total: number,
      phase: 'content' | 'visual',
      failed: number,
    ) => void;
  } = {},
): Promise<Photo[]> {
  const candidates = selectDedupeSignatureCandidates(photos);
  const contentHashPhotos = candidates.content;
  const missingHashPhotos = candidates.visual;
  if (contentHashPhotos.length === 0 && missingHashPhotos.length === 0) {
    return photos;
  }

  const contentHashes: Record<string, string> = {};
  let processed = 0;
  const failedUris = new Set<string>();
  const total = contentHashPhotos.length + missingHashPhotos.length;
  options.onProgress?.(processed, total, 'content', failedUris.size);
  for (let index = 0; index < contentHashPhotos.length; index += MOBILE_VISUAL_HASH_BATCH_SIZE) {
    if (options.shouldCancel?.()) {
      throw new Error('Deduplication cancelled.');
    }
    const batch = contentHashPhotos.slice(index, index + MOBILE_VISUAL_HASH_BATCH_SIZE);
    const batchHashes = await computeNativeContentHashes(batch.map((photo) => photo.uri));
    Object.assign(contentHashes, batchHashes);
    batch.forEach((photo) => {
      if (!batchHashes[photo.uri]) failedUris.add(photo.uri);
    });
    processed += batch.length;
    options.onProgress?.(processed, total, 'content', failedUris.size);
  }

  const visualHashes: Record<string, string> = {};
  for (let index = 0; index < missingHashPhotos.length; index += MOBILE_VISUAL_HASH_BATCH_SIZE) {
    if (options.shouldCancel?.()) {
      throw new Error('Deduplication cancelled.');
    }
    const batch = missingHashPhotos.slice(index, index + MOBILE_VISUAL_HASH_BATCH_SIZE);
    const batchHashes = await computeNativeVisualHashes(batch.map((photo) => photo.uri));
    Object.assign(visualHashes, batchHashes);
    batch.forEach((photo) => {
      if (!batchHashes[photo.uri]) failedUris.add(photo.uri);
    });
    processed += batch.length;
    options.onProgress?.(processed, total, 'visual', failedUris.size);
  }
  if (missingHashPhotos.length > 0 && Object.keys(visualHashes).length === 0) {
    throw new Error('Visual signatures could not be generated for this analysis.');
  }

  return photos.map((photo) => {
    const contentHash = contentHashes[photo.uri];
    const visualHash = visualHashes[photo.uri];
    return contentHash || visualHash
      ? { ...photo, ...(contentHash ? { contentHash } : {}), ...(visualHash ? { visualHash } : {}) }
      : photo;
  });
}
