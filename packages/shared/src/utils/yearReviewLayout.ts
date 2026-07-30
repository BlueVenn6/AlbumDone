export type YearReviewTimeMode = 'rolling' | 'calendar';

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

export function buildYearReviewLayoutPlan(
  photos: readonly YearReviewLayoutPhoto[],
  timeMode: YearReviewTimeMode,
  now = new Date(),
): YearReviewLayoutPlan {
  const valid = photos
    .filter((photo) => photo.id.trim() && Number.isFinite(photo.timestamp))
    .filter((photo) => !Number.isNaN(new Date(photo.timestamp).getTime()))
    .filter((photo) => timeMode !== 'calendar' || new Date(photo.timestamp).getFullYear() === now.getFullYear())
    .sort((a, b) => a.timestamp - b.timestamp);

  if (valid.length === 0) {
    return { layout: 'empty', photoIds: [], monthIds: [] };
  }

  if (valid.length < 6) {
    return {
      layout: 'vertical',
      photoIds: valid.map((photo) => photo.id),
      monthIds: valid.map((photo) => getYearReviewMonthId(photo.timestamp)),
    };
  }

  const endMonthId = timeMode === 'calendar'
    ? getYearReviewMonthId(now.getTime())
    : getYearReviewMonthId(valid[valid.length - 1]!.timestamp);
  const startMonthId = timeMode === 'calendar'
    ? now.getFullYear() * 12
    : endMonthId - 11;
  return {
    layout: 'calendar',
    photoIds: valid.map((photo) => photo.id),
    monthIds: Array.from(
      { length: endMonthId - startMonthId + 1 },
      (_, index) => startMonthId + index,
    ),
  };
}
