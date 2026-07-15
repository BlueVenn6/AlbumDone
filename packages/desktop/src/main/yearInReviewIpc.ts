type YearReviewPhotoInput = {
  uri: string;
  filename: string;
  timestamp?: number;
  width?: number;
  height?: number;
  fileSize?: number;
  isScreenshot?: boolean;
  thumbnailUri?: string;
};

type RegisterYearInReviewIpcDependencies = {
  safeHandle: (
    channel: string,
    handler: (event: unknown, ...args: any[]) => unknown | Promise<unknown>,
  ) => void;
  maxScanPhotos: number;
  assertImagePath: (value: string, action: string) => string;
  assertString: (value: unknown, name: string) => string;
  toLocalFileUri: (filePath: string) => string;
  getOutputRoot: () => string;
  getPreferredLocale: () => Promise<string | null>;
  generateYearInReview: (
    photos: YearReviewPhotoInput[],
    outputDir: string,
    timeMode?: 'rolling' | 'calendar',
    locale?: string,
  ) => Promise<unknown>;
};

export function registerYearInReviewIpc(
  dependencies: RegisterYearInReviewIpcDependencies,
): void {
  dependencies.safeHandle(
    'yearInReview:generate',
    async (
      _event,
      photos: YearReviewPhotoInput[],
      timeMode: 'rolling' | 'calendar' = 'rolling',
    ) => {
      if (
        !Array.isArray(photos)
        || photos.length === 0
        || photos.length > dependencies.maxScanPhotos
      ) {
        throw new Error(
          `Year In Review requires 1-${dependencies.maxScanPhotos} photos.`,
        );
      }
      const safePhotos = photos.map((photo, index) => {
        if (!photo || typeof photo !== 'object') {
          throw new Error(`Invalid photo at index ${index}.`);
        }
        const allowedPath = dependencies.assertImagePath(photo.uri, 'yearInReview');
        let thumbnailUri: string | undefined;
        if (photo.thumbnailUri) {
          try {
            thumbnailUri = dependencies.toLocalFileUri(
              dependencies.assertImagePath(photo.thumbnailUri, 'yearInReviewThumbnail'),
            );
          } catch {
            thumbnailUri = undefined;
          }
        }
        const safePhoto = {
          uri: dependencies.toLocalFileUri(allowedPath),
          filename: dependencies.assertString(photo.filename, `photos[${index}].filename`),
          isScreenshot: photo.isScreenshot === true,
        };
        return {
          ...safePhoto,
          ...(Number.isFinite(photo.timestamp) ? { timestamp: Number(photo.timestamp) } : {}),
          ...(Number.isFinite(photo.width)
            ? { width: Math.max(0, Math.round(Number(photo.width))) }
            : {}),
          ...(Number.isFinite(photo.height)
            ? { height: Math.max(0, Math.round(Number(photo.height))) }
            : {}),
          ...(Number.isFinite(photo.fileSize)
            ? { fileSize: Math.max(0, Math.round(Number(photo.fileSize))) }
            : {}),
          ...(thumbnailUri ? { thumbnailUri } : {}),
        };
      });
      return dependencies.generateYearInReview(
        safePhotos,
        dependencies.getOutputRoot(),
        timeMode,
        (await dependencies.getPreferredLocale()) ?? 'en',
      );
    },
  );
}
