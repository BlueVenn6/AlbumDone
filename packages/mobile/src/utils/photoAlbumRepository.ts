import {
  createAlbumSnapshot,
  removePhotosFromAlbumSnapshot,
  type AlbumSnapshot,
  type Photo,
} from '@photo-manager/shared';
import {
  scanPhotoAlbum,
  shouldKeepPhotoForAlbum,
  type PhotoScanProgress,
} from './photoScanner';

type SnapshotListener = {
  onProgress?: (progress: PhotoScanProgress) => void;
  onBatch?: (photos: Photo[], progress: PhotoScanProgress) => void;
  shouldCancel?: () => boolean;
};

type SnapshotTask = {
  listeners: Set<SnapshotListener>;
  promise: Promise<AlbumSnapshot>;
};

export type LoadMobileAlbumSnapshotOptions = SnapshotListener & {
  force?: boolean;
  maxAgeMs?: number;
};

const snapshots = new Map<string, AlbumSnapshot>();
const tasks = new Map<string, SnapshotTask>();
const DEFAULT_SNAPSHOT_MAX_AGE_MS = 15_000;

function notifyProgress(task: SnapshotTask, progress: PhotoScanProgress): void {
  for (const listener of task.listeners) {
    listener.onProgress?.(progress);
  }
}

function notifyBatch(task: SnapshotTask, photos: Photo[], progress: PhotoScanProgress): void {
  for (const listener of task.listeners) {
    listener.onBatch?.(photos, progress);
  }
}

function allListenersCancelled(task: SnapshotTask): boolean {
  return task.listeners.size > 0
    && [...task.listeners].every((listener) => listener.shouldCancel?.() === true);
}

function startSnapshotTask(albumId: string): SnapshotTask {
  const task = {
    listeners: new Set<SnapshotListener>(),
    promise: Promise.resolve(null as unknown as AlbumSnapshot),
  };

  task.promise = (async () => {
    let cancelled = false;
    const photos = await scanPhotoAlbum({
      albumId,
      onProgress: (progress) => notifyProgress(task, progress),
      onBatch: (batch, progress) => notifyBatch(task, batch, progress),
      shouldCancel: () => {
        cancelled = allListenersCancelled(task);
        return cancelled;
      },
    });

    if (cancelled) {
      throw new Error('Album scan cancelled.');
    }

    const snapshot = createAlbumSnapshot(albumId, photos, {
      belongsToAlbum: shouldKeepPhotoForAlbum,
    });
    snapshots.set(albumId, snapshot);
    return snapshot;
  })().finally(() => {
    tasks.delete(albumId);
  });

  tasks.set(albumId, task);
  return task;
}

export function getCachedMobileAlbumSnapshot(albumId: string): AlbumSnapshot | null {
  return snapshots.get(albumId) ?? null;
}

export async function loadMobileAlbumSnapshot(
  albumId: string,
  options: LoadMobileAlbumSnapshotOptions = {},
): Promise<AlbumSnapshot> {
  if (!options.force) {
    const cached = snapshots.get(albumId);
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_SNAPSHOT_MAX_AGE_MS;
    if (cached && Date.now() - cached.createdAt <= Math.max(0, maxAgeMs)) {
      return cached;
    }
    snapshots.delete(albumId);
  } else {
    snapshots.delete(albumId);
  }

  const listener: SnapshotListener = {
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.onBatch ? { onBatch: options.onBatch } : {}),
    ...(options.shouldCancel ? { shouldCancel: options.shouldCancel } : {}),
  };
  const task = tasks.get(albumId) ?? startSnapshotTask(albumId);
  task.listeners.add(listener);

  try {
    return await task.promise;
  } finally {
    task.listeners.delete(listener);
  }
}

export function invalidateMobileAlbumSnapshot(albumId?: string): void {
  if (albumId) {
    snapshots.delete(albumId);
    return;
  }
  snapshots.clear();
}

export function removePhotosFromMobileAlbumSnapshots(deletedPhotoIds: ReadonlySet<string>): void {
  if (deletedPhotoIds.size === 0) {
    return;
  }

  for (const [albumId, snapshot] of snapshots) {
    snapshots.set(albumId, removePhotosFromAlbumSnapshot(snapshot, deletedPhotoIds));
  }
}
