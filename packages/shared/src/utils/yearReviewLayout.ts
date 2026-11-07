export type YearReviewTimeMode = 'rolling' | 'previousYear' | 'calendar';

export type YearReviewLayoutPhoto = {
  id: string;
  timestamp: number;
};

export type YearReviewLayoutPlan =
  | {
    layout: 'empty';
    photoIds: [];
    monthIds: [];
  }
  | {
    layout: 'vertical';
    photoIds: string[];
    monthIds: number[];
  }
  | {
    layout: 'calendar';
    photoIds: string[];
    monthIds: number[];
  };

export function getYearReviewMonthId(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getFullYear() * 12 + date.getMonth();
}

export function getYearReviewMonthIds(timeMode: YearReviewTimeMode, now = new Date()): number[] {
  const end = timeMode === 'previousYear'
    ? now.getFullYear() * 12 - 1
    : getYearReviewMonthId(now.getTime());
  const start = timeMode === 'calendar' ? now.getFullYear() * 12 : end - 11;
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

/** Balanced rows fill the available width, including a short final row. */
export function getYearReviewRows(count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const rowCount = count <= 3 ? 1 : count === 4 ? 2 : Math.ceil(count / 4);
  const size = Math.floor(count / rowCount);
  return Array.from({ length: rowCount }, (_, index) => size + (index < count % rowCount ? 1 : 0));
}

export function buildYearReviewLayoutPlan(
  photos: readonly YearReviewLayoutPhoto[],
  timeMode: YearReviewTimeMode,
  now = new Date(),
): YearReviewLayoutPlan {
  const monthIds = getYearReviewMonthIds(timeMode, now);
  const inRange = new Set(monthIds);
  const valid = photos
    .filter((photo) => photo.id.trim() && Number.isFinite(photo.timestamp))
    .filter((photo) => !Number.isNaN(new Date(photo.timestamp).getTime()))
    .filter((photo) => photo.timestamp <= now.getTime() && inRange.has(getYearReviewMonthId(photo.timestamp)))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (valid.length === 0) {
    return { layout: 'empty', photoIds: [], monthIds: [] };
  }

  return {
    layout: 'calendar',
    photoIds: valid.map((photo) => photo.id),
    monthIds,
  };
}
