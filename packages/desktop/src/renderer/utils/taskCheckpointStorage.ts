import {
  getPhotoTaskCheckpointKey,
  parsePhotoTaskCheckpoint,
  type PhotoTaskCheckpoint,
  type PhotoTaskKind,
} from '@photo-manager/shared';

export async function loadDesktopTaskCheckpoint(
  kind: PhotoTaskKind,
  albumId: string,
): Promise<PhotoTaskCheckpoint | null> {
  const key = getPhotoTaskCheckpointKey(kind, albumId);
  const payload = await window.electronAPI?.tasks.getCheckpoint(key);
  return parsePhotoTaskCheckpoint(payload ?? null);
}

export async function saveDesktopTaskCheckpoint(
  checkpoint: PhotoTaskCheckpoint,
): Promise<void> {
  const key = getPhotoTaskCheckpointKey(checkpoint.kind, checkpoint.albumId);
  await window.electronAPI?.tasks.saveCheckpoint(key, JSON.stringify(checkpoint));
}

export async function deleteDesktopTaskCheckpoint(
  kind: PhotoTaskKind,
  albumId: string,
): Promise<void> {
  const key = getPhotoTaskCheckpointKey(kind, albumId);
  await window.electronAPI?.tasks.deleteCheckpoint(key);
}
