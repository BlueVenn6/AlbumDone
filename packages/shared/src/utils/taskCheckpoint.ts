export type PhotoTaskKind = 'culling' | 'deduplication';
export type PhotoTaskStatus = 'active' | 'deleting' | 'cancelled' | 'completed';
export type PhotoTaskDecision = 'pending' | 'keep' | 'delete';

export type PhotoTaskBatch =
  | { mode: 'all' }
  | { mode: 'limited'; limit: number };

export interface PhotoTaskCheckpoint {
  version: 1;
  id: string;
  kind: PhotoTaskKind;
  albumId: string;
  snapshotKey: string;
  photoIds: string[];
  decisions: Record<string, PhotoTaskDecision>;
  currentIndex: number;
  batch: PhotoTaskBatch;
  status: PhotoTaskStatus;
  deletion: {
    requestedIds: string[];
    committedIds: string[];
    failedIds: string[];
  };
  createdAt: number;
  updatedAt: number;
}

export interface CreatePhotoTaskCheckpointInput {
  id: string;
  kind: PhotoTaskKind;
  albumId: string;
  snapshotKey: string;
  photoIds: string[];
  batch: PhotoTaskBatch;
  now?: number;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0))];
}

function normalizeBatch(batch: PhotoTaskBatch, total: number): PhotoTaskBatch {
  if (batch.mode === 'all') {
    return batch;
  }
  const limit = Number.isFinite(batch.limit) ? Math.max(0, Math.floor(batch.limit)) : 0;
  return { mode: 'limited', limit: Math.min(limit, total) };
}

export function photoTaskBatchesMatch(
  first: PhotoTaskBatch,
  second: PhotoTaskBatch,
  total: number,
): boolean {
  const normalizedFirst = normalizeBatch(first, total);
  const normalizedSecond = normalizeBatch(second, total);
  return normalizedFirst.mode === normalizedSecond.mode
    && (
      normalizedFirst.mode === 'all'
      || (
        normalizedSecond.mode === 'limited'
        && normalizedFirst.limit === normalizedSecond.limit
      )
    );
}

export function selectPhotoTaskIds(photoIds: string[], batch: PhotoTaskBatch): string[] {
  const unique = uniqueIds(photoIds);
  const normalized = normalizeBatch(batch, unique.length);
  return normalized.mode === 'all' ? unique : unique.slice(0, normalized.limit);
}

export function createPhotoTaskCheckpoint(
  input: CreatePhotoTaskCheckpointInput,
): PhotoTaskCheckpoint {
  const now = input.now ?? Date.now();
  const photoIds = selectPhotoTaskIds(input.photoIds, input.batch);
  const decisions = Object.fromEntries(photoIds.map((photoId) => [photoId, 'pending' as const]));
  return {
    version: 1,
    id: input.id,
    kind: input.kind,
    albumId: input.albumId,
    snapshotKey: input.snapshotKey,
    photoIds,
    decisions,
    currentIndex: 0,
    batch: normalizeBatch(input.batch, photoIds.length),
    status: 'active',
    deletion: { requestedIds: [], committedIds: [], failedIds: [] },
    createdAt: now,
    updatedAt: now,
  };
}

export function getPhotoTaskCheckpointKey(kind: PhotoTaskKind, albumId: string): string {
  return `photo-task:v1:${kind}:${encodeURIComponent(albumId)}`;
}

function nextPendingIndex(checkpoint: PhotoTaskCheckpoint, afterIndex: number): number {
  for (let index = afterIndex + 1; index < checkpoint.photoIds.length; index += 1) {
    if (checkpoint.decisions[checkpoint.photoIds[index]!] === 'pending') {
      return index;
    }
  }
  for (let index = 0; index <= afterIndex && index < checkpoint.photoIds.length; index += 1) {
    if (checkpoint.decisions[checkpoint.photoIds[index]!] === 'pending') {
      return index;
    }
  }
  return checkpoint.photoIds.length;
}

export function recordPhotoTaskDecision(
  checkpoint: PhotoTaskCheckpoint,
  photoId: string,
  decision: Exclude<PhotoTaskDecision, 'pending'>,
  now = Date.now(),
): PhotoTaskCheckpoint {
  if (!Object.prototype.hasOwnProperty.call(checkpoint.decisions, photoId)) {
    return checkpoint;
  }
  const decisions = { ...checkpoint.decisions, [photoId]: decision };
  const currentPosition = checkpoint.photoIds.indexOf(photoId);
  const updated = { ...checkpoint, decisions };
  return {
    ...updated,
    currentIndex: nextPendingIndex(updated, Math.max(currentPosition, checkpoint.currentIndex)),
    status: 'active',
    updatedAt: now,
  };
}

export function undoPhotoTaskDecision(
  checkpoint: PhotoTaskCheckpoint,
  photoId: string,
  now = Date.now(),
): PhotoTaskCheckpoint {
  const index = checkpoint.photoIds.indexOf(photoId);
  if (index < 0) {
    return checkpoint;
  }
  return {
    ...checkpoint,
    decisions: { ...checkpoint.decisions, [photoId]: 'pending' },
    currentIndex: index,
    status: 'active',
    updatedAt: now,
  };
}

export function preparePhotoTaskDeletion(
  checkpoint: PhotoTaskCheckpoint,
  requestedIds?: string[],
  now = Date.now(),
): PhotoTaskCheckpoint {
  const selectedIds = requestedIds ?? checkpoint.photoIds.filter(
    (photoId) => checkpoint.decisions[photoId] === 'delete',
  );
  const inTask = new Set(checkpoint.photoIds);
  const requested = uniqueIds(selectedIds).filter((photoId) => inTask.has(photoId));
  const requestedSet = new Set(requested);
  return {
    ...checkpoint,
    status: requested.length > 0 ? 'deleting' : 'completed',
    deletion: {
      requestedIds: requested,
      committedIds: checkpoint.deletion.committedIds.filter((photoId) => requestedSet.has(photoId)),
      failedIds: checkpoint.deletion.failedIds.filter((photoId) => requestedSet.has(photoId)),
    },
    updatedAt: now,
  };
}

export function getRemainingPhotoTaskDeletionIds(checkpoint: PhotoTaskCheckpoint): string[] {
  const committed = new Set(checkpoint.deletion.committedIds);
  return checkpoint.deletion.requestedIds.filter((photoId) => !committed.has(photoId));
}

export function recordPhotoTaskDeletionResult(
  checkpoint: PhotoTaskCheckpoint,
  result: { committedIds: string[]; failedIds?: string[] },
  now = Date.now(),
): PhotoTaskCheckpoint {
  const requested = new Set(checkpoint.deletion.requestedIds);
  const committedIds = uniqueIds([
    ...checkpoint.deletion.committedIds,
    ...result.committedIds,
  ]).filter((photoId) => requested.has(photoId));
  const committed = new Set(committedIds);
  const failedIds = uniqueIds(result.failedIds ?? [])
    .filter((photoId) => requested.has(photoId) && !committed.has(photoId));
  const remaining = checkpoint.deletion.requestedIds.filter((photoId) => !committed.has(photoId));
  return {
    ...checkpoint,
    status: remaining.length === 0 ? 'completed' : 'deleting',
    deletion: {
      ...checkpoint.deletion,
      committedIds,
      failedIds,
    },
    updatedAt: now,
  };
}

export function cancelPhotoTaskCheckpoint(
  checkpoint: PhotoTaskCheckpoint,
  now = Date.now(),
): PhotoTaskCheckpoint {
  return checkpoint.status === 'completed'
    ? checkpoint
    : { ...checkpoint, status: 'cancelled', updatedAt: now };
}

export function resumePhotoTaskCheckpoint(
  checkpoint: PhotoTaskCheckpoint,
  snapshotKey: string,
  availablePhotoIds: string[],
  now = Date.now(),
): PhotoTaskCheckpoint | null {
  if (
    checkpoint.version !== 1
    || (checkpoint.snapshotKey !== snapshotKey && checkpoint.status !== 'deleting')
  ) {
    return null;
  }
  const available = new Set(uniqueIds(availablePhotoIds));
  const photoIds = checkpoint.photoIds.filter((photoId) => available.has(photoId));
  if (photoIds.length === 0) {
    return null;
  }
  const decisions = Object.fromEntries(photoIds.map((photoId) => [
    photoId,
    checkpoint.decisions[photoId] ?? 'pending',
  ])) as Record<string, PhotoTaskDecision>;
  const requestedIds = checkpoint.deletion.requestedIds.filter((photoId) => available.has(photoId));
  const committedIds = checkpoint.deletion.committedIds.filter((photoId) => requestedIds.includes(photoId));
  const updated: PhotoTaskCheckpoint = {
    ...checkpoint,
    snapshotKey,
    photoIds,
    decisions,
    deletion: {
      requestedIds,
      committedIds,
      failedIds: checkpoint.deletion.failedIds.filter((photoId) => requestedIds.includes(photoId)),
    },
    status: checkpoint.status === 'completed' ? 'completed' : checkpoint.status === 'deleting' ? 'deleting' : 'active',
    updatedAt: now,
  };
  const currentId = checkpoint.photoIds[checkpoint.currentIndex];
  const currentIndex = currentId ? photoIds.indexOf(currentId) : -1;
  return {
    ...updated,
    currentIndex: currentIndex >= 0 ? currentIndex : nextPendingIndex(updated, -1),
  };
}

export function parsePhotoTaskCheckpoint(value: string | null): PhotoTaskCheckpoint | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<PhotoTaskCheckpoint>;
    if (
      parsed.version !== 1
      || typeof parsed.id !== 'string'
      || (parsed.kind !== 'culling' && parsed.kind !== 'deduplication')
      || typeof parsed.albumId !== 'string'
      || typeof parsed.snapshotKey !== 'string'
      || !Array.isArray(parsed.photoIds)
      || typeof parsed.decisions !== 'object'
      || parsed.decisions === null
      || !parsed.deletion
    ) {
      return null;
    }
    return resumePhotoTaskCheckpoint(
      parsed as PhotoTaskCheckpoint,
      parsed.snapshotKey,
      parsed.photoIds,
      parsed.updatedAt,
    );
  } catch {
    return null;
  }
}
