import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getPhotoTaskCheckpointKey,
  parsePhotoTaskCheckpoint,
  type PhotoTaskCheckpoint,
  type PhotoTaskKind,
} from '@photo-manager/shared';

export async function loadMobileTaskCheckpoint(
  kind: PhotoTaskKind,
  albumId: string,
): Promise<PhotoTaskCheckpoint | null> {
  const payload = await AsyncStorage.getItem(getPhotoTaskCheckpointKey(kind, albumId));
  return parsePhotoTaskCheckpoint(payload);
}

export async function saveMobileTaskCheckpoint(
  checkpoint: PhotoTaskCheckpoint,
): Promise<void> {
  await AsyncStorage.setItem(
    getPhotoTaskCheckpointKey(checkpoint.kind, checkpoint.albumId),
    JSON.stringify(checkpoint),
  );
}

export async function deleteMobileTaskCheckpoint(
  kind: PhotoTaskKind,
  albumId: string,
): Promise<void> {
  await AsyncStorage.removeItem(getPhotoTaskCheckpointKey(kind, albumId));
}
