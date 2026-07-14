import type { Photo } from '@photo-manager/shared';

export function getVerifiedDeletedPhotoIds(
  reportedDeletedIds: ReadonlySet<string>,
  remainingPhotos: readonly Pick<Photo, 'id'>[],
): Set<string> {
  const remainingIds = new Set(remainingPhotos.map((photo) => photo.id));
  return new Set([...reportedDeletedIds].filter((photoId) => !remainingIds.has(photoId)));
}
