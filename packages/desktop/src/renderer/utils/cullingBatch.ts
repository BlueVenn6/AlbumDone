type IdentifiedPhoto = { id: string };

export function selectCullingBatch<T extends IdentifiedPhoto>(
  photos: T[],
  reviewedPhotoIds: Iterable<string>,
  limit: number,
): T[] {
  const reviewed = new Set(reviewedPhotoIds);
  return photos
    .filter((photo) => !reviewed.has(photo.id))
    .slice(0, Math.max(0, limit));
}

export function countRemainingCullingPhotos<T extends IdentifiedPhoto>(
  photos: T[],
  reviewedPhotoIds: Iterable<string>,
): number {
  const reviewed = new Set(reviewedPhotoIds);
  return photos.reduce(
    (count, photo) => count + (reviewed.has(photo.id) ? 0 : 1),
    0,
  );
}
