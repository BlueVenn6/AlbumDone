export type YearInReviewMode = 'person' | 'scene';

export interface YearInReviewMoment {
  month: string;
  momentTitle: string;
  dateRange: string;
  coverPhoto: import('../types').Photo;
  photos: import('../types').Photo[];
  score: number;
  whySelected: string[];
}

export interface YearInReviewResult {
  outputPath: string;
  topPersonPhotoCount: number;
  monthsCovered: number;
  mode: YearInReviewMode;
  moments?: YearInReviewMoment[];
  emptyMonths?: string[];
}
