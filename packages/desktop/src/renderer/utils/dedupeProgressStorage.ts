import { taskProgressStorage as AsyncStorage } from './taskProgressStorage';
import { getRemainingPhotoTaskDeletionIds, type DuplicateGroup, type PhotoTaskCheckpoint } from '@photo-manager/shared';

type ReviewGroup = {
  photoIds: string[];
  selectedPhotoId: string;
  rejectedPhotoIds: string[];
};

export type DedupeAlbumProgress = {
  version: 1;
  albumId: string;
  checkedPhotoIds: string[];
  scanTaskId: string | null;
  review: { taskId: string; groups: ReviewGroup[]; manual: boolean } | null;
};

function storageKey(albumId: string): string {
  return `photo-task:v1:deduplication:album-progress:${encodeURIComponent(albumId)}`;
}

export function createDedupeAlbumProgress(albumId: string): DedupeAlbumProgress {
  return { version: 1, albumId, checkedPhotoIds: [], scanTaskId: null, review: null };
}

export function getDedupeTaskRecovery(checkpoint: PhotoTaskCheckpoint | null, progress: DedupeAlbumProgress): {
  kind: 'scan' | 'review' | null;
  hasPendingDeletion: boolean;
} {
  const none = { kind: null, hasPendingDeletion: false };
  if (!checkpoint || checkpoint.kind !== 'deduplication' || checkpoint.albumId !== progress.albumId
    || checkpoint.status === 'completed' || checkpoint.photoIds.length === 0) return none;
  const ids = new Set(checkpoint.photoIds);
  const review = progress.review?.taskId === checkpoint.id ? progress.review : null;
  const groups = review?.groups.filter((group) => group.photoIds.length >= 2
    && group.photoIds.every((id) => ids.has(id)) && group.photoIds.includes(group.selectedPhotoId)) ?? [];
  const pendingDeletion = checkpoint.status === 'deleting' && getRemainingPhotoTaskDeletionIds(checkpoint).length > 0;
  if (groups.length > 0 || pendingDeletion) {
    return {
      kind: 'review',
      hasPendingDeletion: groups.length > 0
        ? groups.some((group) => group.rejectedPhotoIds.some((id) => ids.has(id)
          && group.photoIds.includes(id) && id !== group.selectedPhotoId))
        : pendingDeletion,
    };
  }
  // An old active checkpoint alone cannot distinguish a stopped scan from an
  // old completed scan. Only an explicitly saved in-flight task offers resume.
  return { kind: checkpoint.status !== 'deleting' && progress.scanTaskId === checkpoint.id ? 'scan' : null,
    hasPendingDeletion: false };
}

export function captureDedupeReview(taskId: string, groups: DuplicateGroup[], manual = false): DedupeAlbumProgress['review'] {
  return {
    taskId,
    manual,
    groups: groups.map((group) => ({
      photoIds: group.photos.map((photo) => photo.id),
      selectedPhotoId: group.selectedPhotoId,
      rejectedPhotoIds: [...(group.rejectedPhotoIds ?? [])],
    })),
  };
}

export function restoreDedupeReview(groups: DuplicateGroup[], review: DedupeAlbumProgress['review']): DuplicateGroup[] {
  if (!review) return groups;
  return groups.map((group) => {
    const ids = new Set(group.photos.map((photo) => photo.id));
    const saved = review.groups.find((candidate) => new Set(candidate.photoIds).size === ids.size
      && candidate.photoIds.every((id) => ids.has(id)));
    if (!saved || !ids.has(saved.selectedPhotoId)) return group;
    return {
      ...group,
      selectedPhotoId: saved.selectedPhotoId,
      // Never restore a decision that would delete the keeper or the entire group.
      rejectedPhotoIds: saved.rejectedPhotoIds.filter((id) => ids.has(id) && id !== saved.selectedPhotoId),
      reason: 'manual-selection',
    };
  });
}

export async function loadDedupeAlbumProgress(albumId: string, availablePhotoIds: string[]): Promise<DedupeAlbumProgress> {
  const payload = await AsyncStorage.getItem(storageKey(albumId));
  const empty = createDedupeAlbumProgress(albumId);
  if (!payload) return empty;
  try {
    const parsed = JSON.parse(payload) as DedupeAlbumProgress;
    if (parsed.version !== 1 || parsed.albumId !== albumId || !Array.isArray(parsed.checkedPhotoIds)) return empty;
    const available = new Set(availablePhotoIds);
    const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.every((id) => typeof id === 'string');
    const review = parsed.review && typeof parsed.review.taskId === 'string'
      && Array.isArray(parsed.review.groups) && parsed.review.groups.every((group) => group
        && validIds(group.photoIds) && validIds(group.rejectedPhotoIds) && typeof group.selectedPhotoId === 'string')
      ? { ...parsed.review, manual: parsed.review.manual === true } : null;
    return { ...empty, checkedPhotoIds: [...new Set(parsed.checkedPhotoIds)].filter((id) => available.has(id)),
      scanTaskId: typeof parsed.scanTaskId === 'string' ? parsed.scanTaskId : null, review };
  } catch {
    return empty;
  }
}

export async function saveDedupeAlbumProgress(progress: DedupeAlbumProgress): Promise<void> {
  await AsyncStorage.setItem(storageKey(progress.albumId), JSON.stringify(progress));
}
