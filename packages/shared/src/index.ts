// Types
export * from './types';

// API
export { LLMClient, testLLMConnection } from './api/llmClient';
export type { TestConnectionResult } from './api/llmClient';
export {
  LLMClientError,
  buildAnthropicMessagesUrl,
  buildGoogleGenerateContentUrl,
  buildOpenAIChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  classifyLLMError,
  getDefaultProviderBaseUrl,
  normalizeProviderBaseUrl,
} from './api/llmEndpoint';
export type { ClassifiedLLMError, LLMErrorCategory } from './api/llmEndpoint';
export {
  analyzeScreenshot,
  executeInstruction,
  preProcessForCulling,
  selectBestFromGroup,
} from './api/vision';
export type { ScreenshotType, ScreenshotAnalysis, CullingPreprocessResult } from './api/vision';
export { extractTextFromImage } from './api/ocr';
export { selectImageSource } from './api/imagePicker';
export type { ImageSourceSelection, PickedMobileImage } from './api/imagePicker';
export type { YearInReviewResult, YearInReviewMode, YearInReviewMoment } from './api/yearInReview';
export { proxyModelSupportsVision } from './types';
export { APP_ENV_KEYS, APP_PORTS } from './config/ports';

// Stores
export { useSettingsStore, selectVisionClient, selectTextClient } from './store/settingsStore';
export type { SettingsState } from './store/settingsStore';
export { usePhotoStore } from './store/photoStore';
export type { PhotoState } from './store/photoStore';
export { useCullingStore } from './store/cullingStore';
export type { CullingState, AiStats } from './store/cullingStore';

// DB
export type { DbAdapter } from './db/queries';
export * from './db/queries';
export * from './db/schema';

// Utils
export {
  calculateSharpness,
  analyzeExposure,
  estimateNoise,
  scorePhoto,
  computeDHash,
  computeVisualHashSignature,
  hammingDistance,
} from './utils/imageQuality';

export {
  groupSimilarPhotos,
  groupSimilarPhotosAsync,
  getSafeRejectedPhotoIds,
  selectDedupeSignatureCandidates,
  selectBestPhoto,
  findScreenshotDuplicates,
  areLikelyDuplicates,
} from './utils/deduplication';
export type {
  DeduplicationAsyncOptions,
  DeduplicationAsyncProgress,
  DedupeSignatureCandidates,
} from './utils/deduplication';

export {
  isScreenshot,
  detectScreenshotCandidate,
  classifyScreenshot,
  filterScreenshots,
  filterNonScreenshots,
  detectScreenshots,
} from './utils/screenshotDetector';
export type { ScreenshotDetectionInput, ScreenshotDetectionResult } from './utils/screenshotDetector';
export { translateText } from './utils/translation';
export { getFeatureAvailability } from './utils/featureAvailability';
export type { FeatureAvailability } from './utils/featureAvailability';
export {
  pathToLocalFileUri,
  localFileUriToPath,
  normalizePhotoUri,
  isLocalPhotoUri,
} from './utils/photoUri';
export {
  createAlbumSnapshot,
  createAlbumSnapshotKey,
  getCanonicalPhotoIdentity,
  removePhotosFromAlbumSnapshot,
} from './utils/albumSnapshot';
export type { AlbumSnapshot, AlbumSnapshotOptions } from './utils/albumSnapshot';
export {
  cancelPhotoTaskCheckpoint,
  createPhotoTaskCheckpoint,
  getPhotoTaskCheckpointKey,
  getRemainingPhotoTaskDeletionIds,
  photoTaskBatchesMatch,
  parsePhotoTaskCheckpoint,
  preparePhotoTaskDeletion,
  recordPhotoTaskDecision,
  recordPhotoTaskDeletionResult,
  resumePhotoTaskCheckpoint,
  selectPhotoTaskIds,
  undoPhotoTaskDecision,
} from './utils/taskCheckpoint';
export type {
  CreatePhotoTaskCheckpointInput,
  PhotoTaskBatch,
  PhotoTaskCheckpoint,
  PhotoTaskDecision,
  PhotoTaskKind,
  PhotoTaskStatus,
} from './utils/taskCheckpoint';
export { getLocalizedAlbumTitle } from './utils/localizedAlbumTitle';
export {
  selectMeaningfulMoments,
} from './utils/meaningfulMoments';
export type {
  MeaningfulMoment,
  MeaningfulMomentPhoto,
} from './utils/meaningfulMoments';
export {
  selectMonthlyReviewPhotos,
} from './utils/monthlyReview';
export type {
  MonthlyReviewConfidence,
  MonthlyReviewExcludedCandidate,
  MonthlyReviewOptions,
  MonthlyReviewPhoto,
  MonthlyReviewSelection,
} from './utils/monthlyReview';
export {
  buildYearReviewLayoutPlan,
  getYearReviewMonthId,
} from './utils/yearReviewLayout';
export type {
  YearReviewLayoutPhoto,
  YearReviewLayoutPlan,
  YearReviewTimeMode,
} from './utils/yearReviewLayout';
export { ENCOURAGEMENTS, getEncouragementByIndex, getRandomEncouragement } from './data/encouragements';

// i18n
export {
  initI18n,
  changeLanguage,
  getResolvedLocale,
  normalizeLocale,
  SUPPORTED_LOCALES,
  i18next,
} from './i18n/index';
export type { SupportedLocale } from './i18n/index';
export { I18nProvider, useTranslation } from './i18n/provider';
export type { TFunction } from './i18n/provider';
