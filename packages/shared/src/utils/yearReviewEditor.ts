import { getYearReviewMonthId } from './yearReviewLayout';
import type {
  MonthlyReviewPhoto,
  MonthlyReviewSelection,
} from './monthlyReview';

export type ReviewMonth = {
  key: string;
  monthId: number;
  photo: MonthlyReviewPhoto | null;
  candidates: MonthlyReviewPhoto[];
  quote: string;
};

export function buildReviewMonths(
  selections: MonthlyReviewSelection[],
  monthIds: number[],
  quotes: string[],
): ReviewMonth[] {
  return monthIds.map((monthId, index) => ({
    key: `month:${monthId}`,
    monthId,
    photo: selections[index]?.selectedPhoto ?? null,
    candidates: selections[index]?.candidates ?? [],
    quote: quotes[index]!,
  }));
}

export function replaceReviewPhoto(
  months: ReviewMonth[],
  monthId: number,
  photoId: string,
): ReviewMonth[] {
  return months.map((month) => {
    if (month.monthId !== monthId) return month;
    const photo = month.candidates.find(
      (candidate) => candidate.id === photoId,
    );
    // A candidate must belong to the real month; never borrow another month's photo.
    if (!photo || getYearReviewMonthId(photo.timestamp) !== monthId)
      return month;
    return { ...month, photo };
  });
}

export function getReviewSummary(months: readonly Pick<ReviewMonth, 'photo' | 'monthId'>[]) {
  const covered = new Set(
    months.filter((month) => month.photo).map((month) => month.monthId),
  ).size;
  return { covered, empty: months.length - covered };
}

export function isReviewExportReady(
  months: readonly Pick<ReviewMonth, 'photo' | 'key'>[],
  imageStates: Record<string, string>,
) {
  return (
    months.length > 0 &&
    months.every(
      (month) =>
        !month.photo ||
        imageStates[`${month.key}:${month.photo.id}`] === 'loaded',
    )
  );
}
