import type { Photo } from '../types';
import { isScreenshot } from './screenshotDetector';
import { scorePhoto } from './imageQuality';

export type MeaningfulMomentPhoto = Photo & {
  capturedAt?: number;
  createdAt?: number;
  locationKey?: string;
  latitude?: number;
  longitude?: number;
  favorite?: boolean;
  keep?: boolean;
  manuallyKept?: boolean;
  duplicateGroupId?: string;
  duplicateWinner?: boolean;
  blurScore?: number;
};

export type MeaningfulMoment = {
  month: string;
  momentTitle: string;
  dateRange: string;
  coverPhoto: MeaningfulMomentPhoto;
  photos: MeaningfulMomentPhoto[];
  score: number;
  whySelected: string[];
};

type Cluster = {
  photos: MeaningfulMomentPhoto[];
  start: number;
  end: number;
  locationKey: string | null;
};

const LOW_RESOLUTION_PIXELS = 640 * 480;
const CLUSTER_GAP_MS = 6 * 60 * 60 * 1000;

function getPhotoTime(photo: MeaningfulMomentPhoto): number {
  return photo.capturedAt ?? photo.createdAt ?? photo.timestamp;
}

function getMonthId(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

function getDayId(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function getLocationKey(photo: MeaningfulMomentPhoto): string | null {
  if (photo.locationKey) {
    return photo.locationKey;
  }
  if (Number.isFinite(photo.latitude) && Number.isFinite(photo.longitude)) {
    return `${photo.latitude!.toFixed(2)},${photo.longitude!.toFixed(2)}`;
  }
  return null;
}

function isLowValuePhoto(photo: MeaningfulMomentPhoto): boolean {
  if (photo.isScreenshot || isScreenshot(photo)) {
    return true;
  }
  if (photo.width > 0 && photo.height > 0 && photo.width * photo.height < LOW_RESOLUTION_PIXELS) {
    return true;
  }
  if (photo.quality?.exposure === 'underexposed' && (photo.quality?.sharpness ?? 0) < 80) {
    return true;
  }
  if ((photo.blurScore ?? 0) > 0.85) {
    return true;
  }
  return false;
}

function buildClusters(photos: MeaningfulMomentPhoto[]): Cluster[] {
  const sorted = [...photos].sort((a, b) => getPhotoTime(a) - getPhotoTime(b));
  const clusters: Cluster[] = [];

  for (const photo of sorted) {
    const timestamp = getPhotoTime(photo);
    const locationKey = getLocationKey(photo);
    const previous = clusters[clusters.length - 1];

    if (
      previous
      && getDayId(previous.end) === getDayId(timestamp)
      && (
        timestamp - previous.end <= CLUSTER_GAP_MS
        || (locationKey && previous.locationKey === locationKey)
      )
    ) {
      previous.photos.push(photo);
      previous.end = Math.max(previous.end, timestamp);
      previous.locationKey = previous.locationKey ?? locationKey;
    } else {
      clusters.push({
        photos: [photo],
        start: timestamp,
        end: timestamp,
        locationKey,
      });
    }
  }

  return clusters;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreCluster(cluster: Cluster, monthPhotoCount: number): {
  score: number;
  whySelected: string[];
  coverPhoto: MeaningfulMomentPhoto;
} {
  const photos = cluster.photos;
  const qualityScores = photos.map((photo) => photo.quality ? scorePhoto(photo.quality) / 100 : 0.55);
  const qualityScore = qualityScores.reduce((sum, value) => sum + value, 0) / Math.max(1, qualityScores.length);
  const favoriteOrKeptScore = photos.some((photo) => photo.favorite || photo.keep || photo.manuallyKept) ? 1 : 0;
  const faceOrPeopleScore = clamp01(
    photos.reduce((sum, photo) => sum + (photo.quality?.hasFace ? 1 : 0) + (photo.quality?.faceScore ?? 0), 0)
      / Math.max(1, photos.length * 1.5),
  );
  const burstDensityScore = clamp01(Math.log2(photos.length + 1) / Math.log2(Math.max(3, monthPhotoCount + 1)));
  const locationClusterScore = cluster.locationKey ? 1 : 0;
  const uniqueIds = new Set(photos.map((photo) => photo.duplicateGroupId ?? photo.id));
  const uniquenessScore = photos.length === 0 ? 0 : uniqueIds.size / photos.length;
  const seasonalDiversityScore = photos.length > 1 ? 0.8 : 0.4;
  const screenshotPenalty = photos.filter((photo) => photo.isScreenshot || isScreenshot(photo)).length / Math.max(1, photos.length);
  const duplicatePenalty = 1 - uniquenessScore;
  const blurPenalty = photos.filter((photo) =>
    (photo.blurScore ?? 0) > 0.7 || (photo.quality?.sharpness ?? 500) < 80,
  ).length / Math.max(1, photos.length);

  const score =
    qualityScore * 0.25
    + favoriteOrKeptScore * 0.2
    + faceOrPeopleScore * 0.15
    + burstDensityScore * 0.15
    + locationClusterScore * 0.1
    + uniquenessScore * 0.1
    + seasonalDiversityScore * 0.05
    - screenshotPenalty * 0.35
    - duplicatePenalty * 0.2
    - blurPenalty * 0.2;

  const coverPhoto = [...photos].sort((a, b) => {
    const aScore = (a.quality ? scorePhoto(a.quality) : 55) + (a.favorite || a.keep || a.manuallyKept ? 30 : 0);
    const bScore = (b.quality ? scorePhoto(b.quality) : 55) + (b.favorite || b.keep || b.manuallyKept ? 30 : 0);
    return bScore - aScore || b.fileSize - a.fileSize || getPhotoTime(a) - getPhotoTime(b);
  })[0]!;

  const whySelected: string[] = [];
  if (photos.length >= 3) whySelected.push('这组照片在短时间内集中出现');
  if (favoriteOrKeptScore > 0) whySelected.push('包含用户保留或收藏的照片');
  if (faceOrPeopleScore >= 0.35) whySelected.push('包含人物或合照信号');
  if (locationClusterScore > 0) whySelected.push('照片地点较集中');
  if (qualityScore >= 0.65) whySelected.push('整体质量评分较高');
  if (uniquenessScore >= 0.8) whySelected.push('重复照片较少');
  if (whySelected.length === 0) whySelected.push('照片数量和质量信号相对更突出');

  return { score: Math.round(Math.max(0, score) * 100), whySelected, coverPhoto };
}

function formatDateRange(start: number, end: number): string {
  const startText = new Date(start).toISOString().slice(0, 10);
  const endText = new Date(end).toISOString().slice(0, 10);
  return startText === endText ? startText : `${startText} - ${endText}`;
}

function buildMomentTitle(month: string, cluster: Cluster): string {
  const day = new Date(cluster.start).getDate();
  return `${month} meaningful moment around day ${day}`;
}

export function selectMeaningfulMoments(photos: MeaningfulMomentPhoto[]): MeaningfulMoment[] {
  const byMonth = new Map<string, MeaningfulMomentPhoto[]>();
  for (const photo of photos) {
    const timestamp = getPhotoTime(photo);
    if (!Number.isFinite(timestamp) || isLowValuePhoto(photo)) {
      continue;
    }
    const monthId = getMonthId(timestamp);
    byMonth.set(monthId, [...(byMonth.get(monthId) ?? []), photo]);
  }

  const moments: MeaningfulMoment[] = [];
  for (const [month, monthPhotos] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = buildClusters(monthPhotos)
      .map((cluster) => ({ cluster, ...scoreCluster(cluster, monthPhotos.length) }))
      .sort((a, b) => b.score - a.score || b.cluster.photos.length - a.cluster.photos.length);
    const best = ranked[0];
    if (!best || best.score <= 0) {
      continue;
    }
    moments.push({
      month,
      momentTitle: buildMomentTitle(month, best.cluster),
      dateRange: formatDateRange(best.cluster.start, best.cluster.end),
      coverPhoto: best.coverPhoto,
      photos: best.cluster.photos,
      score: best.score,
      whySelected: best.whySelected,
    });
  }

  return moments;
}
