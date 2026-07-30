import type { Photo } from '../types';
import { isScreenshot } from './screenshotDetector';
import { scorePhoto } from './imageQuality';

export type MonthlyReviewPhoto = Photo & {
  capturedAt?: number;
  createdAt?: number;
  locationKey?: string;
  latitude?: number;
  longitude?: number;
  favorite?: boolean;
  keep?: boolean;
  manuallyKept?: boolean;
  edited?: boolean;
  editedAt?: number;
  shared?: boolean;
  shareCount?: number;
  duplicateGroupId?: string;
  duplicateWinner?: boolean;
  blurScore?: number;
};

export type MonthlyReviewConfidence = 'high' | 'medium' | 'low' | 'empty';

export type MonthlyReviewExcludedCandidate = {
  photoId: string;
  reasons: string[];
  score?: number;
};

export type MonthlyReviewSelection<TPhoto extends MonthlyReviewPhoto = MonthlyReviewPhoto> = {
  month: number;
  monthId: string;
  slotIndex: number;
  selectedPhoto: TPhoto | null;
  confidence: MonthlyReviewConfidence;
  score: number;
  reasons: string[];
  excludedCandidates: MonthlyReviewExcludedCandidate[];
};

export type MonthlyReviewOptions = {
  year?: number;
  startDate?: Date | number;
  now?: Date | number;
  months?: number;
  mode?: 'calendar' | 'rolling';
  allowLowConfidence?: boolean;
  excludeLowValueImages?: boolean;
  debug?: boolean;
};

type ScoredCandidate<TPhoto extends MonthlyReviewPhoto> = {
  photo: TPhoto;
  score: number;
  reasons: string[];
  penalties: string[];
  duplicateKey: string;
  timestamp: number;
};

type MonthlyStats = {
  dayCounts: Map<string, number>;
  locationCounts: Map<string, number>;
};

const MIN_HIGH_CONFIDENCE_SCORE = 72;
const MIN_MEDIUM_CONFIDENCE_SCORE = 50;
const MIN_LOW_CONFIDENCE_SCORE = 24;
const TEN_MINUTES_MS = 10 * 60 * 1000;

function toTimestampMs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  return value! < 1_000_000_000_000 ? value! * 1000 : value!;
}

function getPhotoTime(photo: MonthlyReviewPhoto): number {
  return toTimestampMs(photo.capturedAt ?? photo.createdAt ?? photo.timestamp);
}

function getPhotoId(photo: MonthlyReviewPhoto): string {
  return photo.id || photo.uri || photo.filename || 'unknown-photo';
}

function getFilename(photo: MonthlyReviewPhoto): string {
  return photo.filename || photo.uri?.split(/[\\/]/).pop() || getPhotoId(photo);
}

function safeIsScreenshot(photo: MonthlyReviewPhoto): boolean {
  try {
    return isScreenshot({
      ...photo,
      filename: getFilename(photo),
      albumId: photo.albumId ?? '',
      tags: Array.isArray(photo.tags) ? photo.tags : [],
      width: photo.width ?? 0,
      height: photo.height ?? 0,
    });
  } catch {
    return Boolean(photo.isScreenshot);
  }
}

function padMonth(month: number): string {
  return String(month + 1).padStart(2, '0');
}

function getMonthId(date: Date): string {
  return `${date.getFullYear()}-${padMonth(date.getMonth())}`;
}

function getDayId(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function getStartDate(options: MonthlyReviewOptions): Date {
  const nowValue = options.now instanceof Date
    ? options.now
    : new Date(options.now ?? Date.now());

  if (options.mode === 'calendar' || options.year !== undefined) {
    return new Date(options.year ?? nowValue.getFullYear(), 0, 1);
  }

  if (options.startDate instanceof Date) {
    return new Date(options.startDate.getFullYear(), options.startDate.getMonth(), 1);
  }

  if (typeof options.startDate === 'number') {
    const start = new Date(options.startDate);
    return new Date(start.getFullYear(), start.getMonth(), 1);
  }

  return new Date(nowValue.getFullYear(), nowValue.getMonth() - 11, 1);
}

function getSlotIndex(timestamp: number, startDate: Date, months: number): number | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const index =
    (date.getFullYear() - startDate.getFullYear()) * 12
    + date.getMonth()
    - startDate.getMonth();

  return index >= 0 && index < months ? index : null;
}

function getSlotMonthId(startDate: Date, slotIndex: number): string {
  return getMonthId(new Date(startDate.getFullYear(), startDate.getMonth() + slotIndex, 1));
}

function getLocationKey(photo: MonthlyReviewPhoto): string | null {
  if (photo.locationKey) {
    return photo.locationKey;
  }
  if (Number.isFinite(photo.latitude) && Number.isFinite(photo.longitude)) {
    return `${photo.latitude!.toFixed(2)},${photo.longitude!.toFixed(2)}`;
  }
  return null;
}

function filenameLooksLowValue(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (/(screenshot|screen_shot|screen shot|capture|mmexport)/i.test(lower)) {
    return '疑似截图或屏幕导出图片';
  }
  if (/(receipt|invoice|bill|账单|发票|票据|小票)/i.test(lower)) {
    return '疑似票据/账单图片';
  }
  if (/(chat|wechat|whatsapp|telegram|qq|conversation|聊天)/i.test(lower)) {
    return '疑似聊天截图';
  }
  if (/(emoji|sticker|meme|表情|贴纸)/i.test(lower)) {
    return '疑似表情包或梗图';
  }
  return null;
}

function getLowValueReason(photo: MonthlyReviewPhoto): string | null {
  if (photo.isScreenshot || safeIsScreenshot(photo)) {
    return '疑似截图';
  }
  return filenameLooksLowValue(getFilename(photo));
}

function getDuplicateKey(photo: MonthlyReviewPhoto, timestamp: number): string {
  if (photo.duplicateGroupId) {
    return `duplicate:${photo.duplicateGroupId}`;
  }

  const day = getDayId(timestamp);
  const timeBucket = Math.floor(timestamp / TEN_MINUTES_MS);
  const widthBucket = (photo.width ?? 0) > 0 ? Math.round((photo.width ?? 0) / 80) * 80 : 0;
  const heightBucket = (photo.height ?? 0) > 0 ? Math.round((photo.height ?? 0) / 80) * 80 : 0;
  const sizeBucket = (photo.fileSize ?? 0) > 0 ? Math.round((photo.fileSize ?? 0) / 250_000) : 0;
  return `burst:${day}:${timeBucket}:${widthBucket}x${heightBucket}:${sizeBucket}`;
}

function buildStats<TPhoto extends MonthlyReviewPhoto>(photos: TPhoto[]): MonthlyStats {
  const dayCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();

  for (const photo of photos) {
    const timestamp = getPhotoTime(photo);
    if (Number.isFinite(timestamp)) {
      const day = getDayId(timestamp);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    const location = getLocationKey(photo);
    if (location) {
      locationCounts.set(location, (locationCounts.get(location) ?? 0) + 1);
    }
  }

  return { dayCounts, locationCounts };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreCandidate<TPhoto extends MonthlyReviewPhoto>(
  photo: TPhoto,
  monthPhotos: TPhoto[],
  stats: MonthlyStats,
): ScoredCandidate<TPhoto> | null {
  const timestamp = getPhotoTime(photo);
  const reasons: string[] = [];
  const penalties: string[] = [];

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  let score = 40;
  reasons.push('拍摄时间有效');

  const pixels = Math.max(0, photo.width ?? 0) * Math.max(0, photo.height ?? 0);
  if (pixels >= 12_000_000) {
    score += 12;
    reasons.push('图片分辨率很高');
  } else if (pixels >= 4_000_000) {
    score += 9;
    reasons.push('图片分辨率较高');
  } else if (pixels >= 1_000_000) {
    score += 5;
    reasons.push('图片分辨率可用');
  } else if (pixels > 0) {
    score += 1;
    penalties.push('图片分辨率偏低');
  } else {
    score -= 8;
    penalties.push('缺少图片尺寸元数据');
  }

  const fileSize = photo.fileSize ?? 0;
  if (fileSize >= 3_000_000) {
    score += 8;
    reasons.push('文件体积支持高质量照片判断');
  } else if (fileSize >= 800_000) {
    score += 5;
    reasons.push('文件体积正常');
  } else if (fileSize > 0) {
    score -= 3;
    penalties.push('文件体积偏小');
  } else {
    score -= 5;
    penalties.push('缺少文件大小元数据');
  }

  if (photo.quality) {
    const qualityScore = scorePhoto(photo.quality);
    score += clamp((qualityScore - 50) / 3, -10, 16);
    if (qualityScore >= 72) {
      reasons.push('本地质量评分较高');
    }
    if (photo.quality.hasFace || photo.quality.faceScore > 0.35) {
      score += 10;
      reasons.push('有人物或合照信号');
    }
    if (photo.quality.compositionScore >= 0.65) {
      score += 5;
      reasons.push('构图评分较好');
    }
    if (photo.quality.exposure !== 'normal') {
      score -= 6;
      penalties.push('曝光不理想');
    }
  }

  if ((photo.blurScore ?? 0) > 0.75) {
    score -= 22;
    penalties.push('疑似模糊照片');
  } else if ((photo.blurScore ?? 0) > 0.55) {
    score -= 10;
    penalties.push('清晰度信号一般');
  }

  const lowValueReason = getLowValueReason(photo);
  if (lowValueReason) {
    score -= lowValueReason?.includes('票据') ? 22 : 32;
    penalties.push(lowValueReason ?? '疑似截图');
  }

  if (photo.favorite || photo.keep || photo.manuallyKept) {
    score += 18;
    reasons.push('用户收藏或手动保留');
  }

  if (photo.shared || (photo.shareCount ?? 0) > 0) {
    score += 6 + clamp(photo.shareCount ?? 0, 0, 4);
    reasons.push('有分享行为信号');
  }

  if (photo.edited || Number.isFinite(photo.editedAt)) {
    score += 6;
    reasons.push('用户编辑过');
  }

  const location = getLocationKey(photo);
  if (location) {
    score += 9;
    reasons.push('包含拍摄地点信息');
    const sameLocationCount = stats.locationCounts.get(location) ?? 0;
    if (sameLocationCount <= Math.max(2, Math.ceil(monthPhotos.length * 0.25))) {
      score += 4;
      reasons.push('地点相对少见，可能代表一次外出或旅行');
    }
  }

  const tags = (Array.isArray(photo.tags) ? photo.tags : []).map((tag) => tag.toLowerCase());
  if (tags.some((tag) => /(travel|trip|event|party|family|people|portrait|旅行|聚会|家人|人物)/i.test(tag))) {
    score += 8;
    reasons.push('包含旅行、人物或事件标签');
  }

  const dayCount = stats.dayCounts.get(getDayId(timestamp)) ?? 0;
  if (dayCount >= 10) {
    score -= 5;
    penalties.push('同一天照片很多，降低普通连拍权重');
  } else if (dayCount >= 3) {
    score += 3;
    reasons.push('同一天有一组事件照片');
  }

  if (photo.duplicateWinner) {
    score += 6;
    reasons.push('已标记为重复组保留图');
  }

  return {
    photo,
    score: Math.round(clamp(score, 0, 100)),
    reasons,
    penalties,
    duplicateKey: getDuplicateKey(photo, timestamp),
    timestamp,
  };
}

function getConfidence(score: number, selectedPhoto: MonthlyReviewPhoto | null): MonthlyReviewConfidence {
  if (!selectedPhoto) {
    return 'empty';
  }
  if (score >= MIN_HIGH_CONFIDENCE_SCORE) {
    return 'high';
  }
  if (score >= MIN_MEDIUM_CONFIDENCE_SCORE) {
    return 'medium';
  }
  return 'low';
}

function buildSelectionForMonth<TPhoto extends MonthlyReviewPhoto>(
  slotIndex: number,
  monthId: string,
  monthPhotos: TPhoto[],
  allowLowConfidence: boolean,
): MonthlyReviewSelection<TPhoto> {
  const date = new Date(`${monthId}-01T00:00:00`);
  const month = date.getMonth() + 1;

  if (monthPhotos.length === 0) {
    return {
      month,
      monthId,
      slotIndex,
      selectedPhoto: null,
      confidence: 'empty',
      score: 0,
      reasons: ['该月没有照片'],
      excludedCandidates: [],
    };
  }

  const stats = buildStats(monthPhotos);
  const scored = monthPhotos
    .map((photo) => scoreCandidate(photo, monthPhotos, stats))
    .filter((item): item is ScoredCandidate<TPhoto> => Boolean(item));

  if (scored.length === 0) {
    return {
      month,
      monthId,
      slotIndex,
      selectedPhoto: null,
      confidence: 'empty',
      score: 0,
      reasons: ['该月照片缺少有效拍摄时间'],
      excludedCandidates: monthPhotos.map((photo) => ({
        photoId: getPhotoId(photo),
        reasons: ['缺少有效拍摄时间'],
      })),
    };
  }

  const groups = new Map<string, ScoredCandidate<TPhoto>[]>();
  for (const candidate of scored) {
    groups.set(candidate.duplicateKey, [...(groups.get(candidate.duplicateKey) ?? []), candidate]);
  }

  const deduped: ScoredCandidate<TPhoto>[] = [];
  const excludedCandidates: MonthlyReviewExcludedCandidate[] = [];

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) =>
      b.score - a.score
      || Number(Boolean(b.photo.favorite || b.photo.keep || b.photo.manuallyKept))
        - Number(Boolean(a.photo.favorite || a.photo.keep || a.photo.manuallyKept))
      || (b.photo.fileSize ?? 0) - (a.photo.fileSize ?? 0)
      || a.timestamp - b.timestamp,
    );
    const winner = sorted[0]!;
    if (group.length > 1) {
      winner.reasons.push(`从 ${group.length} 张相似或连拍照片中胜出`);
    }
    deduped.push(winner);

    for (const loser of sorted.slice(1)) {
      excludedCandidates.push({
        photoId: getPhotoId(loser.photo),
        score: loser.score,
        reasons: [
          ...loser.penalties,
          `与 ${getPhotoId(winner.photo)} 属于相似或连拍候选，保留分数更高的一张`,
        ],
      });
    }
  }

  const ranked = deduped.sort((a, b) =>
    b.score - a.score
    || Number(Boolean(b.photo.favorite || b.photo.keep || b.photo.manuallyKept))
      - Number(Boolean(a.photo.favorite || a.photo.keep || a.photo.manuallyKept))
    || (b.photo.fileSize ?? 0) - (a.photo.fileSize ?? 0)
    || a.timestamp - b.timestamp,
  );

  const best = ranked[0]!;
  const shouldSelect =
    best.score >= MIN_LOW_CONFIDENCE_SCORE || (allowLowConfidence && scored.length > 0);
  const selectedPhoto = shouldSelect ? best.photo : null;
  const confidence = getConfidence(best.score, selectedPhoto);

  for (const candidate of ranked.slice(1)) {
    excludedCandidates.push({
      photoId: getPhotoId(candidate.photo),
      score: candidate.score,
      reasons: [
        ...candidate.penalties,
        `分数低于入选照片 ${getPhotoId(best.photo)}`,
      ],
    });
  }

  const reasons = [
    ...best.reasons,
    ...best.penalties.map((reason) => `低置信度因素：${reason}`),
  ];
  if (confidence === 'low') {
    reasons.push('该月缺少高质量候选，保留为低置信度代表图');
  }

  return {
    month,
    monthId,
    slotIndex,
    selectedPhoto,
    confidence,
    score: selectedPhoto ? best.score : 0,
    reasons,
    excludedCandidates,
  };
}

export function selectMonthlyReviewPhotos<TPhoto extends MonthlyReviewPhoto>(
  photos: TPhoto[],
  options: MonthlyReviewOptions = {},
): MonthlyReviewSelection<TPhoto>[] {
  const months = Math.max(1, options.months ?? 12);
  const startDate = getStartDate(options);
  const allowLowConfidence = options.allowLowConfidence ?? true;
  const excludeLowValueImages = options.excludeLowValueImages ?? false;
  const buckets = Array.from({ length: months }, () => [] as TPhoto[]);

  for (const photo of photos) {
    if (excludeLowValueImages && getLowValueReason(photo)) {
      continue;
    }

    const timestamp = getPhotoTime(photo);
    const slotIndex = getSlotIndex(timestamp, startDate, months);
    if (slotIndex === null) {
      continue;
    }
    buckets[slotIndex]!.push(photo);
  }

  const selections = buckets.map((monthPhotos, slotIndex) =>
    buildSelectionForMonth(
      slotIndex,
      getSlotMonthId(startDate, slotIndex),
      monthPhotos,
      allowLowConfidence,
    ),
  );

  if (options.debug) {
    console.info('[monthlyReview] selection', selections.map((selection) => ({
      monthId: selection.monthId,
      selectedPhotoId: selection.selectedPhoto ? getPhotoId(selection.selectedPhoto) : null,
      confidence: selection.confidence,
      score: selection.score,
      reasons: selection.reasons,
      excludedCount: selection.excludedCandidates.length,
    })));
  }

  return selections;
}
