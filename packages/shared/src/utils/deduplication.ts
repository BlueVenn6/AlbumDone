import type { DuplicateGroup, Photo } from '../types';
import { hammingDistance, scorePhoto } from './imageQuality';

const DUPLICATE_HASH_THRESHOLD = 2; // Hamming distance threshold for pHash (tightened from 10)
const COPY_LIKE_SIZE_RATIO_THRESHOLD = 0.03;
const COPY_LIKE_DIMENSION_DELTA = 0.01;
const POSSIBLE_SIMILAR_DIMENSION_DELTA = 0.08;
const ASPECT_RATIO_DELTA_THRESHOLD = 0.025;
const NEAR_EXACT_SIZE_RATIO_THRESHOLD = 0.003;
const NEAR_EXACT_SIZE_BYTE_DELTA = 8 * 1024;
const SEQUENCE_NUMBER_WINDOW = 3;
const SIMILAR_SEARCH_WINDOW_MS = 10 * 60 * 1000;
const METADATA_COPY_TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
const VISUAL_HASH_HIGH_THRESHOLD = 4;
const VISUAL_HASH_POSSIBLE_THRESHOLD = 12;
const VISUAL_STRUCTURE_SIZE = 24;
const VISUAL_STRUCTURE_SHIFT = 1;
const VISUAL_STRUCTURE_CLOSE_MIN = 0.72;
const VISUAL_STRUCTURE_STRONG_MIN = 0.78;
const VISUAL_STRUCTURE_MODERATE_MIN = 0.86;
const VISUAL_STRUCTURE_POSSIBLE_MIN = 0.92;
const AUTO_VISUAL_HASH_THRESHOLD = 2;
const AUTO_VISUAL_STRUCTURE_MIN = 0.995;
const AUTO_VISUAL_SIGNATURE_RMSE_MAX = 3;
const MAX_VISUAL_NEIGHBORS_PER_PHOTO = 64;
const POSSIBLE_BURST_TIME_WINDOW_MS = 2 * 60 * 1000;
const POSSIBLE_BURST_SIZE_RATIO_THRESHOLD = 0.02;
const SEQUENCE_REVIEW_TIME_WINDOW_MS = 5 * 60 * 1000;
const SEQUENCE_REVIEW_HASH_THRESHOLD = 36;
const SEQUENCE_REVIEW_STRUCTURE_SIZE = 12;
const SEQUENCE_REVIEW_STRUCTURE_SHIFT = 2;
const SEQUENCE_REVIEW_STRUCTURE_MIN = 0.62;
const SEQUENCE_REVIEW_COLOR_BINS = 8;
const SEQUENCE_REVIEW_COLOR_MIN = 0.8;

type DuplicateConfidence = 'high' | 'possible';
type SimilarityResult = {
  score: number;
  confidence: DuplicateConfidence;
};

export type DeduplicationAsyncProgress = {
  stage: 'exact' | 'visual' | 'metadata';
  processed: number;
  total: number;
};

export type DeduplicationAsyncOptions = {
  shouldCancel?: () => boolean;
  onProgress?: (progress: DeduplicationAsyncProgress) => void;
  yieldEvery?: number;
};

type FilenameSequence = {
  prefix: string;
  number: number;
  stem: string;
};

/**
 * Calculate similarity score between two photos (0 = identical, higher = more different).
 * Uses multiple signals: timestamp proximity, file size similarity, dimensions.
 */
function hasUsableDuplicateSignals(photo: Photo): boolean {
  return photo.fileSize > 0;
}

function normalizeFilenameStem(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/\b(copy|duplicate|副本|拷贝|複本)\b/g, '')
    .replace(/[\s._()[\]-]+/g, '');
}

function getFilenameSequence(filename: string): FilenameSequence | null {
  const stem = filename.replace(/\.[^.]+$/, '').toLowerCase();
  let digitEndIndex = stem.length;
  while (digitEndIndex > 0) {
    const code = stem.charCodeAt(digitEndIndex - 1);
    if (code >= 48 && code <= 57) break;
    digitEndIndex -= 1;
  }
  if (digitEndIndex === 0) {
    return null;
  }

  let digitStartIndex = digitEndIndex;
  while (digitStartIndex > 0) {
    const code = stem.charCodeAt(digitStartIndex - 1);
    if (code < 48 || code > 57) break;
    digitStartIndex -= 1;
  }

  const prefix = stem.slice(0, digitStartIndex)
    .replace(/\b(copy|duplicate|副本|拷贝|複本)\b/g, '')
    .replace(/[\s._()[\]-]+/g, '');
  const number = Number.parseInt(stem.slice(digitStartIndex, digitEndIndex), 10);
  if (!prefix || !Number.isFinite(number)) {
    return null;
  }

  return { prefix, number, stem: normalizeFilenameStem(filename) };
}

function getSequenceDistance(a: Photo, b: Photo): number | null {
  const first = getFilenameSequence(a.filename);
  const second = getFilenameSequence(b.filename);
  if (!first || !second || first.prefix !== second.prefix) {
    return null;
  }
  return Math.abs(first.number - second.number);
}

function haveCopyLikeNames(a: Photo, b: Photo): boolean {
  const firstStem = normalizeFilenameStem(a.filename);
  const secondStem = normalizeFilenameStem(b.filename);
  if (firstStem && firstStem === secondStem) {
    return true;
  }
  return false;
}

function haveSameBaseName(a: Photo, b: Photo): boolean {
  const firstStem = normalizeFilenameStem(a.filename);
  const secondStem = normalizeFilenameStem(b.filename);
  return Boolean(firstStem && firstStem === secondStem);
}

function getDimensionDelta(a: Photo, b: Photo): number {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const widthDelta = Math.abs(a.width - b.width) / Math.max(a.width, b.width);
  const heightDelta = Math.abs(a.height - b.height) / Math.max(a.height, b.height);
  return Math.max(widthDelta, heightDelta);
}

function getAspectRatioDelta(a: Photo, b: Photo): number {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const firstRatio = a.width / a.height;
  const secondRatio = b.width / b.height;
  return Math.abs(firstRatio - secondRatio) / Math.max(firstRatio, secondRatio);
}

function hasSameOrientation(a: Photo, b: Photo): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }
  return (a.width >= a.height) === (b.width >= b.height);
}

function hasKnownDimensions(photo: Photo): boolean {
  return photo.width > 0 && photo.height > 0;
}

function parseVisualHash(hash: string | undefined): bigint | null {
  if (!hash) {
    return null;
  }
  const encodedHash = hash.startsWith('v2:') ? hash.split(':', 3)[1] : hash;
  if (!encodedHash || !/^[0-9a-f]{16}$/i.test(encodedHash)) return null;

  try {
    return BigInt(`0x${encodedHash}`);
  } catch {
    return null;
  }
}

function isCurrentVisualHash(hash: string | undefined): boolean {
  return Boolean(hash && /^v2:[0-9a-f]{16}:[0-9a-f]+$/i.test(hash));
}

const visualSignatureBytes = new WeakMap<Photo, Uint8Array>();
const visualLuminanceSignatures = new WeakMap<Photo, Float64Array>();
const visualSequenceLuminanceSignatures = new WeakMap<Photo, Float64Array>();
const visualColorHistograms = new WeakMap<Photo, Float64Array>();

function getVisualSignatureBytes(photo: Photo): Uint8Array | null {
  const cached = visualSignatureBytes.get(photo);
  if (cached) return cached;
  if (!isCurrentVisualHash(photo.visualHash)) return null;
  const signature = photo.visualHash!.split(':', 3)[2]!;
  const bytes = new Uint8Array(signature.length / 2);
  for (let index = 0; index < signature.length; index += 2) {
    bytes[index / 2] = Number.parseInt(signature.slice(index, index + 2), 16);
  }
  visualSignatureBytes.set(photo, bytes);
  return bytes;
}

function getVisualLuminanceSignature(photo: Photo): Float64Array | null {
  const cached = visualLuminanceSignatures.get(photo);
  if (cached) return cached;
  const signature = getVisualSignatureBytes(photo);
  if (!signature || signature.length !== VISUAL_STRUCTURE_SIZE * VISUAL_STRUCTURE_SIZE * 3) {
    return null;
  }
  const luminance = new Float64Array(VISUAL_STRUCTURE_SIZE * VISUAL_STRUCTURE_SIZE);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const source = pixel * 3;
    luminance[pixel] = (0.299 * signature[source]!)
      + (0.587 * signature[source + 1]!)
      + (0.114 * signature[source + 2]!);
  }
  visualLuminanceSignatures.set(photo, luminance);
  return luminance;
}

function getShiftedLuminanceCorrelation(
  first: Float64Array,
  second: Float64Array,
  offsetX: number,
  offsetY: number,
  structureSize = VISUAL_STRUCTURE_SIZE,
): number {
  const startX = Math.max(0, -offsetX);
  const endX = Math.min(structureSize, structureSize - offsetX);
  const startY = Math.max(0, -offsetY);
  const endY = Math.min(structureSize, structureSize - offsetY);
  let count = 0;
  let firstSum = 0;
  let secondSum = 0;
  let firstSquaredSum = 0;
  let secondSquaredSum = 0;
  let productSum = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const firstValue = first[y * structureSize + x]!;
      const secondValue = second[(y + offsetY) * structureSize + x + offsetX]!;
      count += 1;
      firstSum += firstValue;
      secondSum += secondValue;
      firstSquaredSum += firstValue * firstValue;
      secondSquaredSum += secondValue * secondValue;
      productSum += firstValue * secondValue;
    }
  }
  const numerator = count * productSum - firstSum * secondSum;
  const denominator = Math.sqrt(
    (count * firstSquaredSum - firstSum * firstSum)
    * (count * secondSquaredSum - secondSum * secondSum),
  );
  return denominator > 0 ? numerator / denominator : 0;
}

function getVisualStructureSimilarity(
  first: Photo,
  second: Photo,
  maximumShift = VISUAL_STRUCTURE_SHIFT,
): number | null {
  const firstSignature = getVisualLuminanceSignature(first);
  const secondSignature = getVisualLuminanceSignature(second);
  if (!firstSignature || !secondSignature) return null;
  let best = -1;
  for (let offsetY = -maximumShift; offsetY <= maximumShift; offsetY += 1) {
    for (let offsetX = -maximumShift; offsetX <= maximumShift; offsetX += 1) {
      best = Math.max(
        best,
        getShiftedLuminanceCorrelation(firstSignature, secondSignature, offsetX, offsetY),
      );
    }
  }
  return Math.max(0, Math.min(1, best));
}

function getSequenceReviewLuminanceSignature(photo: Photo): Float64Array | null {
  const cached = visualSequenceLuminanceSignatures.get(photo);
  if (cached) return cached;
  const source = getVisualLuminanceSignature(photo);
  if (!source) return null;
  const signature = new Float64Array(
    SEQUENCE_REVIEW_STRUCTURE_SIZE * SEQUENCE_REVIEW_STRUCTURE_SIZE,
  );
  const scale = VISUAL_STRUCTURE_SIZE / SEQUENCE_REVIEW_STRUCTURE_SIZE;
  for (let y = 0; y < SEQUENCE_REVIEW_STRUCTURE_SIZE; y += 1) {
    for (let x = 0; x < SEQUENCE_REVIEW_STRUCTURE_SIZE; x += 1) {
      let total = 0;
      for (let sourceY = 0; sourceY < scale; sourceY += 1) {
        for (let sourceX = 0; sourceX < scale; sourceX += 1) {
          total += source[(y * scale + sourceY) * VISUAL_STRUCTURE_SIZE + x * scale + sourceX]!;
        }
      }
      signature[y * SEQUENCE_REVIEW_STRUCTURE_SIZE + x] = total / (scale * scale);
    }
  }
  visualSequenceLuminanceSignatures.set(photo, signature);
  return signature;
}

function getSequenceReviewStructureSimilarity(first: Photo, second: Photo): number | null {
  const firstSignature = getSequenceReviewLuminanceSignature(first);
  const secondSignature = getSequenceReviewLuminanceSignature(second);
  if (!firstSignature || !secondSignature) return null;
  let best = -1;
  for (
    let offsetY = -SEQUENCE_REVIEW_STRUCTURE_SHIFT;
    offsetY <= SEQUENCE_REVIEW_STRUCTURE_SHIFT;
    offsetY += 1
  ) {
    for (
      let offsetX = -SEQUENCE_REVIEW_STRUCTURE_SHIFT;
      offsetX <= SEQUENCE_REVIEW_STRUCTURE_SHIFT;
      offsetX += 1
    ) {
      best = Math.max(
        best,
        getShiftedLuminanceCorrelation(
          firstSignature,
          secondSignature,
          offsetX,
          offsetY,
          SEQUENCE_REVIEW_STRUCTURE_SIZE,
        ),
      );
    }
  }
  return Math.max(0, Math.min(1, best));
}

function getVisualColorHistogram(photo: Photo): Float64Array | null {
  const cached = visualColorHistograms.get(photo);
  if (cached) return cached;
  const signature = getVisualSignatureBytes(photo);
  if (!signature || signature.length !== VISUAL_STRUCTURE_SIZE * VISUAL_STRUCTURE_SIZE * 3) {
    return null;
  }
  const histogram = new Float64Array(SEQUENCE_REVIEW_COLOR_BINS * 3);
  for (let index = 0; index < signature.length; index += 3) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = signature[index + channel]!;
      const bucket = Math.min(
        SEQUENCE_REVIEW_COLOR_BINS - 1,
        Math.floor(value * SEQUENCE_REVIEW_COLOR_BINS / 256),
      );
      histogram[channel * SEQUENCE_REVIEW_COLOR_BINS + bucket]! += 1;
    }
  }
  let squaredLength = 0;
  for (const value of histogram) squaredLength += value * value;
  const length = Math.sqrt(squaredLength);
  if (length <= 0) return null;
  for (let index = 0; index < histogram.length; index += 1) {
    histogram[index]! /= length;
  }
  visualColorHistograms.set(photo, histogram);
  return histogram;
}

function getVisualColorSimilarity(first: Photo, second: Photo): number | null {
  const firstHistogram = getVisualColorHistogram(first);
  const secondHistogram = getVisualColorHistogram(second);
  if (!firstHistogram || !secondHistogram) return null;
  let similarity = 0;
  for (let index = 0; index < firstHistogram.length; index += 1) {
    similarity += firstHistogram[index]! * secondHistogram[index]!;
  }
  return Math.max(0, Math.min(1, similarity));
}

function getVisualSignatureRmse(first: Photo, second: Photo): number | null {
  const firstSignature = getVisualSignatureBytes(first);
  const secondSignature = getVisualSignatureBytes(second);
  if (!firstSignature || !secondSignature || firstSignature.length !== secondSignature.length) {
    return null;
  }
  let squaredError = 0;
  for (let index = 0; index < firstSignature.length; index += 1) {
    const difference = firstSignature[index]! - secondSignature[index]!;
    squaredError += difference * difference;
  }
  return Math.sqrt(squaredError / firstSignature.length);
}

function getMinimumVisualStructureSimilarity(distance: number): number {
  if (distance <= DUPLICATE_HASH_THRESHOLD) return VISUAL_STRUCTURE_CLOSE_MIN;
  if (distance <= VISUAL_HASH_HIGH_THRESHOLD) return VISUAL_STRUCTURE_STRONG_MIN;
  if (distance <= 8) return VISUAL_STRUCTURE_MODERATE_MIN;
  return VISUAL_STRUCTURE_POSSIBLE_MIN;
}

function photoSimilarityScore(a: Photo, b: Photo): SimilarityResult | null {
  if (!hasUsableDuplicateSignals(a) || !hasUsableDuplicateSignals(b)) {
    return null;
  }

  if (a.contentHash && b.contentHash && a.contentHash === b.contentHash) {
    return { score: 0, confidence: 'high' };
  }

  if (a.fingerprint && b.fingerprint && a.fingerprint === b.fingerprint) {
    return { score: 0.5, confidence: 'possible' };
  }

  const timeDiff = Math.abs(a.timestamp - b.timestamp);
  const sizeDelta = Math.abs(a.fileSize - b.fileSize);
  const sizeRatio =
    sizeDelta / Math.max(a.fileSize, b.fileSize);
  const dimensionDelta = getDimensionDelta(a, b);
  const aspectRatioDelta = getAspectRatioDelta(a, b);
  const sameDimensions = a.width > 0 && a.height > 0 && a.width === b.width && a.height === b.height;
  const closeSequenceDistance = getSequenceDistance(a, b);
  const hasCloseSequence =
    closeSequenceDistance !== null && closeSequenceDistance > 0 && closeSequenceDistance <= SEQUENCE_NUMBER_WINDOW;
  const copyLikeNames = haveCopyLikeNames(a, b);
  const sameBaseName = haveSameBaseName(a, b);
  const dimensionsKnown = hasKnownDimensions(a) && hasKnownDimensions(b);

  if (dimensionsKnown && aspectRatioDelta > ASPECT_RATIO_DELTA_THRESHOLD) {
    return null;
  }

  const firstVisualHash = parseVisualHash(a.visualHash);
  const secondVisualHash = parseVisualHash(b.visualHash);
  const hasVisualHashes = firstVisualHash !== null && secondVisualHash !== null;
  if (hasVisualHashes) {
    const distance = hammingDistance(firstVisualHash, secondVisualHash);
    if (dimensionsKnown && !hasSameOrientation(a, b)) {
      return null;
    }
    const dimensionCompatible = dimensionsKnown
      ? dimensionDelta <= POSSIBLE_SIMILAR_DIMENSION_DELTA
      : true;
    const structureSimilarity = getVisualStructureSimilarity(a, b);
    if (structureSimilarity !== null) {
      if (
        distance <= VISUAL_HASH_POSSIBLE_THRESHOLD
        && structureSimilarity >= getMinimumVisualStructureSimilarity(distance)
        && (!dimensionsKnown || aspectRatioDelta <= ASPECT_RATIO_DELTA_THRESHOLD)
      ) {
        const signatureRmse = getVisualSignatureRmse(a, b);
        const isHighConfidenceVisualCopy =
          (!dimensionsKnown || sameDimensions)
          && !a.isScreenshot
          && !b.isScreenshot
          && distance <= AUTO_VISUAL_HASH_THRESHOLD
          && structureSimilarity >= AUTO_VISUAL_STRUCTURE_MIN
          && signatureRmse !== null
          && signatureRmse <= AUTO_VISUAL_SIGNATURE_RMSE_MAX
          && (
            copyLikeNames
            || sameBaseName
            || timeDiff > POSSIBLE_BURST_TIME_WINDOW_MS
          );
        return {
          score: (1 - structureSimilarity) * 100 + distance,
          confidence: isHighConfidenceVisualCopy ? 'high' : 'possible',
        };
      }
      return null;
    }
    const strongNoDimensionContext =
      !dimensionsKnown
      && distance <= DUPLICATE_HASH_THRESHOLD
      && sizeRatio <= COPY_LIKE_SIZE_RATIO_THRESHOLD
      && (copyLikeNames || sameBaseName || hasCloseSequence || timeDiff <= SIMILAR_SEARCH_WINDOW_MS);
    const possibleNoDimensionContext =
      !dimensionsKnown
      && distance <= VISUAL_HASH_POSSIBLE_THRESHOLD
      && (copyLikeNames || hasCloseSequence || timeDiff <= SIMILAR_SEARCH_WINDOW_MS || sizeRatio <= 0.12);

    const legacyContext = copyLikeNames
      || (hasCloseSequence
        && timeDiff <= POSSIBLE_BURST_TIME_WINDOW_MS
        && sizeRatio <= POSSIBLE_BURST_SIZE_RATIO_THRESHOLD)
      || (timeDiff <= SIMILAR_SEARCH_WINDOW_MS && sizeRatio <= COPY_LIKE_SIZE_RATIO_THRESHOLD);
    if (
      distance <= VISUAL_HASH_HIGH_THRESHOLD
      && dimensionCompatible
      && (dimensionsKnown ? aspectRatioDelta <= ASPECT_RATIO_DELTA_THRESHOLD : strongNoDimensionContext)
      && legacyContext
    ) {
      return { score: distance, confidence: 'possible' };
    }
    if (
      distance <= VISUAL_HASH_POSSIBLE_THRESHOLD
      && dimensionCompatible
      && (dimensionsKnown
          ? legacyContext
        : possibleNoDimensionContext)
    ) {
      return { score: distance, confidence: 'possible' };
    }
    return null;
  }

  if (!dimensionsKnown || !hasSameOrientation(a, b)) {
    return null;
  }

  const metadataScore =
    (timeDiff / 1000)
    + (sizeRatio * 100)
    + (dimensionDelta * 100)
    + (closeSequenceDistance ?? SEQUENCE_NUMBER_WINDOW + 1);

  if (
    sameDimensions
    && (sizeDelta <= NEAR_EXACT_SIZE_BYTE_DELTA || sizeRatio <= NEAR_EXACT_SIZE_RATIO_THRESHOLD)
    && (sameBaseName || (copyLikeNames && timeDiff <= METADATA_COPY_TIME_WINDOW_MS))
  ) {
    return { score: metadataScore, confidence: 'possible' };
  }

  if (
    sameDimensions
    && sizeRatio <= COPY_LIKE_SIZE_RATIO_THRESHOLD
    && copyLikeNames
  ) {
    return { score: metadataScore, confidence: 'possible' };
  }

  if (
    dimensionDelta <= COPY_LIKE_DIMENSION_DELTA
    && sizeRatio <= 0.08
    && copyLikeNames
  ) {
    return { score: metadataScore, confidence: 'possible' };
  }

  if (
    sameDimensions
    && hasCloseSequence
    && timeDiff <= POSSIBLE_BURST_TIME_WINDOW_MS
    && sizeRatio <= POSSIBLE_BURST_SIZE_RATIO_THRESHOLD
  ) {
    return { score: metadataScore, confidence: 'possible' };
  }

  return null;
}

function sequenceReviewSimilarityScore(a: Photo, b: Photo): SimilarityResult | null {
  if (!hasUsableDuplicateSignals(a) || !hasUsableDuplicateSignals(b)) return null;
  if (!hasKnownDimensions(a) || !hasKnownDimensions(b)) return null;
  if (a.albumId !== b.albumId || !hasSameOrientation(a, b)) return null;
  if (getAspectRatioDelta(a, b) > ASPECT_RATIO_DELTA_THRESHOLD) return null;

  const sequenceDistance = getSequenceDistance(a, b);
  if (
    sequenceDistance === null
    || sequenceDistance < 1
    || sequenceDistance > SEQUENCE_NUMBER_WINDOW
    || Math.abs(a.timestamp - b.timestamp) > SEQUENCE_REVIEW_TIME_WINDOW_MS
  ) {
    return null;
  }

  const firstVisualHash = parseVisualHash(a.visualHash);
  const secondVisualHash = parseVisualHash(b.visualHash);
  if (firstVisualHash === null || secondVisualHash === null) return null;
  const hashDistance = hammingDistance(firstVisualHash, secondVisualHash);
  if (hashDistance > SEQUENCE_REVIEW_HASH_THRESHOLD) return null;

  const colorSimilarity = getVisualColorSimilarity(a, b);
  if (colorSimilarity === null || colorSimilarity < SEQUENCE_REVIEW_COLOR_MIN) return null;
  const structureSimilarity = getSequenceReviewStructureSimilarity(a, b);
  if (structureSimilarity === null || structureSimilarity < SEQUENCE_REVIEW_STRUCTURE_MIN) return null;

  return {
    score: (1 - structureSimilarity) * 100 + (1 - colorSimilarity) * 50 + hashDistance,
    confidence: 'possible',
  };
}

function getContentHashGroups(photos: Photo[], assigned: Set<string>): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const byContentHash = new Map<string, Photo[]>();

  for (const photo of photos) {
    if (!photo.contentHash) {
      continue;
    }
    const matches = byContentHash.get(photo.contentHash) ?? [];
    matches.push(photo);
    byContentHash.set(photo.contentHash, matches);
  }

  for (const matches of byContentHash.values()) {
    const group = matches.filter((photo) => !assigned.has(photo.id));
    if (group.length < 2) {
      continue;
    }
    group.forEach((photo) => assigned.add(photo.id));
    groups.push(buildDuplicateGroup(group[0]!, group));
  }

  return groups;
}

function buildDuplicateGroup(seed: Photo, group: Photo[]): DuplicateGroup {
  const bestId = selectBestPhoto(group);
  const rejectedPhotoIds = getDefaultRejectedPhotoIds(group, bestId);
  const confidence: DuplicateConfidence = rejectedPhotoIds.length > 0 ? 'high' : 'possible';
  return {
    id: `group_${seed.id}`,
    photos: group,
    selectedPhotoId: bestId,
    confidence,
    rejectedPhotoIds,
    reason: buildSelectionReason(group.find((p) => p.id === bestId)!, group, confidence),
  };
}

function getDefaultRejectedPhotoIds(group: Photo[], bestId: string): string[] {
  const best = group.find((photo) => photo.id === bestId);
  if (!best) {
    return [];
  }

  const rejected = group
    .filter((photo) => photo.id !== bestId && photoSimilarityScore(best, photo)?.confidence === 'high')
    .map((photo) => photo.id);

  return rejected;
}

export function getSafeRejectedPhotoIds(group: DuplicateGroup): string[] {
  const photoIds = new Set(group.photos.map((photo) => photo.id));
  if (group.rejectedPhotoIds) {
    return [...new Set(group.rejectedPhotoIds)].filter(
      (photoId) => photoId !== group.selectedPhotoId && photoIds.has(photoId),
    );
  }

  if (group.confidence !== 'high') {
    return [];
  }
  const selected = group.photos.find((photo) => photo.id === group.selectedPhotoId);
  if (!selected?.contentHash) {
    return [];
  }
  return group.photos
    .filter((photo) => photo.id !== selected.id && photo.contentHash === selected.contentHash)
    .map((photo) => photo.id);
}

export type DedupeSignatureCandidates = {
  content: Photo[];
  visual: Photo[];
};

export function selectDedupeSignatureCandidates(photos: Photo[]): DedupeSignatureCandidates {
  const content = new Map<string, Photo>();
  const byFileSize = new Map<number, Photo[]>();
  for (const photo of photos) {
    if (photo.contentHash || photo.fileSize <= 0) continue;
    const group = byFileSize.get(photo.fileSize) ?? [];
    group.push(photo);
    byFileSize.set(photo.fileSize, group);
  }
  for (const group of byFileSize.values()) {
    if (group.length > 1) {
      group.forEach((photo) => content.set(photo.id, photo));
    }
  }

  return {
    content: [...content.values()],
    // A coarse fingerprint can reduce work, but it cannot prove that two
    // differently encoded images are unrelated. Every photo needs a current
    // pixel signature before an "All" run can claim complete coverage.
    visual: photos.filter((photo) => !isCurrentVisualHash(photo.visualHash)),
  };
}

/**
 * Group photos that are likely duplicates.
 * Uses dimension matching, timestamp proximity, and file size similarity.
 */
export function groupSimilarPhotos(photos: Photo[]): DuplicateGroup[] {
  if (photos.length < 2) return [];

  const assigned = new Set<string>();
  const groups: DuplicateGroup[] = getContentHashGroups(photos, assigned);
  const matches = collectCandidateMatches(getBoundedCandidatePairs(photos, assigned));
  groups.push(...buildCandidateGroups(photos, assigned, matches));
  return groups;
}

function throwIfDedupeCancelled(options: DeduplicationAsyncOptions): void {
  if (options.shouldCancel?.()) {
    const error = new Error('Deduplication cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

type DedupeCandidatePair = {
  first: Photo;
  second: Photo;
  stage: 'visual' | 'metadata';
  allowSequenceReview: boolean;
};

function canShareVisualCandidateBucket(first: Photo, second: Photo): boolean {
  if (!hasKnownDimensions(first) || !hasKnownDimensions(second)) {
    return true;
  }
  return hasSameOrientation(first, second)
    && getAspectRatioDelta(first, second) <= ASPECT_RATIO_DELTA_THRESHOLD;
}

type VisualHashTreeNode = {
  hash: bigint;
  photos: Photo[];
  children: Map<number, VisualHashTreeNode>;
};

function insertVisualHashNode(root: VisualHashTreeNode, hash: bigint, photo: Photo): void {
  let node = root;
  while (true) {
    const distance = hammingDistance(node.hash, hash);
    if (distance === 0) {
      node.photos.push(photo);
      return;
    }
    const child = node.children.get(distance);
    if (child) {
      node = child;
      continue;
    }
    node.children.set(distance, { hash, photos: [photo], children: new Map() });
    return;
  }
}

type VisualHashNeighbor = {
  photo: Photo;
  distance: number;
  timeDelta: number;
};

function addBoundedVisualHashNeighbor(
  output: VisualHashNeighbor[],
  photo: Photo,
  target: Photo,
  distance: number,
): void {
  output.push({ photo, distance, timeDelta: Math.abs(photo.timestamp - target.timestamp) });
  output.sort((first, second) => first.distance - second.distance || first.timeDelta - second.timeDelta);
  if (output.length > MAX_VISUAL_NEIGHBORS_PER_PHOTO) {
    output.pop();
  }
}

function findVisualHashNeighbors(
  node: VisualHashTreeNode,
  hash: bigint,
  target: Photo,
  output: VisualHashNeighbor[],
): void {
  const distance = hammingDistance(node.hash, hash);
  if (distance <= VISUAL_HASH_POSSIBLE_THRESHOLD) {
    for (const photo of node.photos) {
      addBoundedVisualHashNeighbor(output, photo, target, distance);
    }
  }
  const minimum = Math.max(0, distance - VISUAL_HASH_POSSIBLE_THRESHOLD);
  const maximum = distance + VISUAL_HASH_POSSIBLE_THRESHOLD;
  for (const [edgeDistance, child] of node.children) {
    if (edgeDistance >= minimum && edgeDistance <= maximum) {
      findVisualHashNeighbors(child, hash, target, output);
    }
  }
}

function getBoundedCandidatePairs(
  photos: Photo[],
  assigned: Set<string>,
): DedupeCandidatePair[] {
  const pairs = new Map<string, DedupeCandidatePair>();
  const photoIndex = new Map(photos.map((photo, index) => [photo.id, index]));
  const addPair = (first: Photo, second: Photo, stage: 'visual' | 'metadata') => {
    if (first.id === second.id || assigned.has(first.id) || assigned.has(second.id)) return;
    const firstIndex = photoIndex.get(first.id);
    const secondIndex = photoIndex.get(second.id);
    if (firstIndex === undefined || secondIndex === undefined) return;
    const low = Math.min(firstIndex, secondIndex);
    const high = Math.max(firstIndex, secondIndex);
    const key = `${low}:${high}`;
    const existing = pairs.get(key);
    if (!existing || stage === 'visual') {
      pairs.set(key, {
        first: photos[low]!,
        second: photos[high]!,
        stage,
        allowSequenceReview: stage === 'metadata' || Boolean(existing?.allowSequenceReview),
      });
    } else if (stage === 'metadata') {
      existing.allowSequenceReview = true;
    }
  };

  let visualHashTree: VisualHashTreeNode | null = null;
  for (const photo of photos) {
    if (assigned.has(photo.id)) continue;
    const hash = parseVisualHash(photo.visualHash);
    if (hash === null) continue;
    if (!visualHashTree) {
      visualHashTree = { hash, photos: [photo], children: new Map() };
      continue;
    }
    const neighbors: VisualHashNeighbor[] = [];
    findVisualHashNeighbors(visualHashTree, hash, photo, neighbors);
    for (const neighbor of neighbors) {
      if (canShareVisualCandidateBucket(neighbor.photo, photo)) {
        addPair(neighbor.photo, photo, 'visual');
      }
    }
    insertVisualHashNode(visualHashTree, hash, photo);
  }

  const sequenceBuckets = new Map<string, Array<{ photo: Photo; number: number }>>();
  for (const photo of photos) {
    if (assigned.has(photo.id) || !isCurrentVisualHash(photo.visualHash)) continue;
    const sequence = getFilenameSequence(photo.filename);
    if (!sequence) continue;
    const key = `${photo.albumId}\u0000${sequence.prefix}`;
    const bucket = sequenceBuckets.get(key) ?? [];
    bucket.push({ photo, number: sequence.number });
    sequenceBuckets.set(key, bucket);
  }
  for (const bucket of sequenceBuckets.values()) {
    bucket.sort((first, second) => first.number - second.number);
    for (let index = 0; index < bucket.length; index += 1) {
      const first = bucket[index]!;
      for (let nextIndex = index + 1; nextIndex < bucket.length; nextIndex += 1) {
        const second = bucket[nextIndex]!;
        const sequenceDistance = second.number - first.number;
        if (sequenceDistance > SEQUENCE_NUMBER_WINDOW) break;
        if (
          sequenceDistance >= 1
          && Math.abs(first.photo.timestamp - second.photo.timestamp) <= SEQUENCE_REVIEW_TIME_WINDOW_MS
          && canShareVisualCandidateBucket(first.photo, second.photo)
        ) {
          addPair(first.photo, second.photo, 'metadata');
        }
      }
    }
  }

  return [...pairs.values()];
}

function addCandidateMatch(matches: Map<string, Set<string>>, firstId: string, secondId: string): void {
  const firstMatches = matches.get(firstId) ?? new Set<string>();
  firstMatches.add(secondId);
  matches.set(firstId, firstMatches);
  const secondMatches = matches.get(secondId) ?? new Set<string>();
  secondMatches.add(firstId);
  matches.set(secondId, secondMatches);
}

function collectCandidateMatches(candidatePairs: DedupeCandidatePair[]): Map<string, Set<string>> {
  const matches = new Map<string, Set<string>>();
  for (const pair of candidatePairs) {
    const similarity = photoSimilarityScore(pair.first, pair.second)
      ?? (pair.allowSequenceReview
        ? sequenceReviewSimilarityScore(pair.first, pair.second)
        : null);
    if (similarity) addCandidateMatch(matches, pair.first.id, pair.second.id);
  }
  return matches;
}

function buildCandidateGroups(
  photos: Photo[],
  assigned: Set<string>,
  matches: Map<string, Set<string>>,
): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  for (const photo of photos) {
    if (assigned.has(photo.id) || !matches.has(photo.id)) continue;
    const queue = [photo.id];
    const component: Photo[] = [];
    assigned.add(photo.id);
    while (queue.length > 0) {
      const photoId = queue.shift()!;
      const candidate = photoById.get(photoId);
      if (candidate) component.push(candidate);
      for (const matchedId of matches.get(photoId) ?? []) {
        if (assigned.has(matchedId) || !photoById.has(matchedId)) continue;
        assigned.add(matchedId);
        queue.push(matchedId);
      }
    }
    if (component.length > 1) groups.push(buildDuplicateGroup(component[0]!, component));
  }
  return groups;
}

async function yieldDedupeWork(): Promise<void> {
  if (typeof MessageChannel !== 'undefined') {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Responsive production grouping. Exact hashes are grouped in linear time;
 * review-only visual and metadata candidates are compared in bounded buckets.
 */
export async function groupSimilarPhotosAsync(
  photos: Photo[],
  options: DeduplicationAsyncOptions = {},
): Promise<DuplicateGroup[]> {
  if (photos.length < 2) return [];
  const yieldEvery = Math.max(50, options.yieldEvery ?? 500);
  const assigned = new Set<string>();
  const groups = getContentHashGroups(photos, assigned);
  options.onProgress?.({ stage: 'exact', processed: photos.length, total: photos.length });
  throwIfDedupeCancelled(options);
  await yieldDedupeWork();

  const candidatePairs = getBoundedCandidatePairs(photos, assigned);
  const totalComparisons = Math.max(1, candidatePairs.length);
  let processed = 0;
  const matches = new Map<string, Set<string>>();
  for (const pair of candidatePairs) {
    processed += 1;
    const similarity = photoSimilarityScore(pair.first, pair.second)
      ?? (pair.allowSequenceReview
        ? sequenceReviewSimilarityScore(pair.first, pair.second)
        : null);
    if (similarity) {
      addCandidateMatch(matches, pair.first.id, pair.second.id);
    }
    if (processed % yieldEvery === 0) {
      options.onProgress?.({ stage: pair.stage, processed, total: totalComparisons });
      throwIfDedupeCancelled(options);
      await yieldDedupeWork();
    }
  }

  groups.push(...buildCandidateGroups(photos, assigned, matches));

  throwIfDedupeCancelled(options);
  options.onProgress?.({ stage: 'visual', processed: totalComparisons, total: totalComparisons });
  return groups;
}

/**
 * Select the best photo from a group using quality arbitration:
 * 1. Technical quality filter (sharpness, exposure, noise)
 * 2. Composition score
 * 3. Timestamp tiebreaker (prefer later photo = final position in burst)
 *
 * Returns the ID of the best photo.
 */
export function selectBestPhoto(photos: Photo[]): string {
  if (photos.length === 0) throw new Error('No photos to select from');
  if (photos.length === 1) return photos[0]!.id;

  // Step 1: Score photos that have quality data
  const scored = photos.map((photo) => ({
    photo,
    score: photo.quality ? scorePhoto(photo.quality) : -1,
    hasQuality: !!photo.quality,
  }));

  // Step 2: If any photos have quality scores, use them
  const withQuality = scored.filter((s) => s.hasQuality);
  if (withQuality.length > 0) {
    // Sort by score descending, then by composition, then by timestamp descending
    withQuality.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 5) {
        return b.score - a.score;
      }
      const compA = a.photo.quality?.compositionScore ?? 0;
      const compB = b.photo.quality?.compositionScore ?? 0;
      if (Math.abs(compA - compB) > 0.05) {
        return compB - compA;
      }
      // Later timestamp wins (end of burst = photographer got the shot)
      return b.photo.timestamp - a.photo.timestamp;
    });

    return withQuality[0]!.photo.id;
  }

  // Step 3: Fallback - use file size as proxy for quality, then timestamp
  const fallbackSorted = [...photos].sort((a, b) => {
    const sizeDiff = b.fileSize - a.fileSize;
    if (Math.abs(sizeDiff) > b.fileSize * 0.1) return sizeDiff;
    return b.timestamp - a.timestamp;
  });

  return fallbackSorted[0]!.id;
}

function buildSelectionReason(
  best: Photo,
  group: Photo[],
  confidence: DuplicateConfidence,
): string {
  if (confidence === 'possible') {
    return 'possible-duplicate';
  }

  const hasExactContentMatch = group.some((photo, index) =>
    group.some((candidate, candidateIndex) =>
      candidateIndex > index
      && Boolean(photo.contentHash)
      && photo.contentHash === candidate.contentHash,
    ),
  );
  if (!hasExactContentMatch) {
    return 'highly-similar';
  }

  if (!best.quality) {
    // Fallback reason based on file size
    const maxSize = Math.max(...group.map((p) => p.fileSize));
    if (best.fileSize === maxSize) {
      return 'largest-file';
    }
    return 'metadata-best';
  }

  const reasons: string[] = [];
  const score = scorePhoto(best.quality);
  reasons.push(`Quality score: ${score}/100`);

  if (best.quality.exposure === 'normal') reasons.push('well-exposed');
  if (best.quality.sharpness > 300) reasons.push('sharp');
  if (best.quality.hasFace && best.quality.faceScore > 0.7) {
    reasons.push('clear face');
  }

  return reasons.join(', ');
}

/**
 * Find potential screenshot duplicates by checking filename patterns.
 */
export function findScreenshotDuplicates(photos: Photo[]): DuplicateGroup[] {
  const screenshots = photos.filter((p) => p.isScreenshot);
  return groupSimilarPhotos(screenshots);
}

/**
 * Compare two perceptual hash values and return similarity.
 * Returns true if images are likely duplicates.
 */
export function areLikelyDuplicates(hash1: bigint, hash2: bigint): boolean {
  let diff = hash1 ^ hash2;
  let distance = 0;
  while (diff > 0n) {
    distance += Number(diff & 1n);
    diff >>= 1n;
  }
  return distance <= DUPLICATE_HASH_THRESHOLD;
}
