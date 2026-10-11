import type { Photo } from '@photo-manager/shared';
import { localFileUriToPath } from '@photo-manager/shared';

const DELETE_BATCH_SIZE = 200;

export type DeletePhotosResult = {
  deletedIds: Set<string>;
  successCount: number;
  errors: string[];
  fallbackTrashPaths: string[];
  originalBytesRemoved: number;
  cacheBytesRemoved: number;
  cancelled: boolean;
};

export type DeletePhotosProgress = {
  attemptedIds: string[];
  deletedIds: string[];
  failedIds: string[];
};

export type DeletePhotosOptions = {
  mode?: 'trash' | 'permanent';
  onBatch?: (progress: DeletePhotosProgress) => void | Promise<void>;
};

function normalizePathKey(filePath: string): string {
  const normalized = filePath.replace(/\//g, '\\');
  return normalized.toLowerCase();
}

export async function deletePhotosFromDisk(
  photos: Photo[],
  options: DeletePhotosOptions = {},
): Promise<DeletePhotosResult> {
  const deletedIds = new Set<string>();
  const errors: string[] = [];
  const fallbackTrashPaths: string[] = [];
  let successCount = 0;
  let originalBytesRemoved = 0;
  let cacheBytesRemoved = 0;
  let cancelled = false;

  if (photos.length === 0) {
    return { deletedIds, successCount, errors, fallbackTrashPaths, originalBytesRemoved, cacheBytesRemoved, cancelled };
  }

  const pathToIds = new Map<string, string[]>();
  const uniquePaths = new Map<string, string>();
  photos.forEach((photo) => {
    const filePath = localFileUriToPath(photo.uri);
    const key = normalizePathKey(filePath);
    const ids = pathToIds.get(key) ?? [];
    ids.push(photo.id);
    pathToIds.set(key, ids);
    uniquePaths.set(key, filePath);
  });
  const filePaths = [...uniquePaths.values()];

  if (window.electronAPI?.fs.deleteFiles) {
    for (let index = 0; index < filePaths.length; index += DELETE_BATCH_SIZE) {
      const batch = filePaths.slice(index, index + DELETE_BATCH_SIZE);
      const result = await window.electronAPI.fs.deleteFiles(batch, options.mode ?? 'trash');
      if (result.cancelled) {
        cancelled = true;
        break;
      }
      successCount += result.successCount;
      originalBytesRemoved += result.originalBytesRemoved ?? 0;
      cacheBytesRemoved += result.cacheBytesRemoved ?? 0;
      errors.push(...result.errors);
      fallbackTrashPaths.push(...(result.fallbackTrashPaths ?? []));

      for (const deletedPath of result.deletedPaths ?? []) {
        const ids = pathToIds.get(normalizePathKey(deletedPath)) ?? [];
        ids.forEach((id) => deletedIds.add(id));
      }

      const attemptedIds = batch.flatMap(
        (filePath) => pathToIds.get(normalizePathKey(filePath)) ?? [],
      );
      const batchDeletedIds = (result.deletedPaths ?? []).flatMap(
        (filePath) => pathToIds.get(normalizePathKey(filePath)) ?? [],
      );
      const batchDeletedSet = new Set(batchDeletedIds);
      await options.onBatch?.({
        attemptedIds,
        deletedIds: batchDeletedIds,
        failedIds: attemptedIds.filter((id) => !batchDeletedSet.has(id)),
      });

      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
  } else {
    if (options.mode === 'permanent') throw new Error('Permanent deletion is unavailable in this application version.');
    for (const [index, filePath] of filePaths.entries()) {
      const result = await window.electronAPI?.fs.moveToTrash(filePath);
      if (result?.success) {
        successCount += 1;
        const ids = pathToIds.get(normalizePathKey(filePath)) ?? [];
        ids.forEach((id) => deletedIds.add(id));
      } else {
        errors.push(result?.error ?? `Failed to delete ${filePath}`);
      }

      const itemIds = pathToIds.get(normalizePathKey(filePath)) ?? [];
      await options.onBatch?.({
        attemptedIds: itemIds,
        deletedIds: result?.success ? itemIds : [],
        failedIds: result?.success ? [] : itemIds,
      });

      if (index % DELETE_BATCH_SIZE === 0) {
        await new Promise((resolve) => { setTimeout(resolve, 0); });
      }
    }
  }

  return { deletedIds, successCount, errors, fallbackTrashPaths, originalBytesRemoved, cacheBytesRemoved, cancelled };
}
