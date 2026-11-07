import type {
  Photo,
  YearInReviewResult,
  ReviewMonth,
  YearReviewTimeMode,
} from '@photo-manager/shared';

declare global {
  interface Window {
    electronAPI?: {
      getAlbums(): Promise<Array<{ id: string; title: string; photoCount: number; totalBytes?: number }>>;
      selectFolder(): Promise<string | null>;
      countPhotos(path: string): Promise<number>;
      getAlbumStats(path: string): Promise<{ photoCount: number; totalBytes: number }>;
      saveAlbum(
        folderPath: string,
        photoCount: number,
        totalBytes?: number,
      ): Promise<Array<{ id: string; title: string; photoCount: number; totalBytes?: number }>>;
      getPhotos(
        folderPath: string,
        options?: {
          mode?: 'fast' | 'full';
          scanId?: string;
          onBatch?: (
            photos: Photo[],
            scanned: number,
            phase?: 'cached' | 'scanning',
          ) => void;
        },
      ): Promise<Photo[]>;
      cancelPhotoScan(scanId: string): Promise<{ cancelled: boolean }>;
      getPhotoBase64(photoId: string): Promise<string>;
      fs: {
        readImageAsBase64(
          filePath: string,
        ): Promise<{ base64: string; mimeType: string }>;
        getThumbnail(
          filePath: string,
          size?: number,
        ): Promise<{ uri: string | null; reason: string | null }>;
        computeContentHashes(filePaths: string[]): Promise<{
          hashes: Record<string, string>;
          errors: Record<string, string>;
          truncated: boolean;
        }>;
        computeVisualHashes(filePaths: string[]): Promise<{
          hashes: Record<string, string>;
          errors: Record<string, string>;
          truncated: boolean;
        }>;
        cancelVisualHashes(): Promise<{ cancelled: boolean }>;
        moveToTrash(filePath: string): Promise<{ success: boolean; error?: string }>;
        deleteFiles(filePaths: string[], mode?: 'trash' | 'permanent'): Promise<{
          originalBytesRemoved?: number;
          cacheBytesRemoved?: number;
          cancelled?: boolean;
          successCount: number;
          errors: string[];
          deletedPaths?: string[];
          fallbackTrashPaths?: string[];
        }>;
      };
      tasks: {
        getCheckpoint(checkpointKey: string): Promise<string | null>;
        saveCheckpoint(
          checkpointKey: string,
          checkpointPayload: string,
        ): Promise<{ saved: boolean }>;
        deleteCheckpoint(checkpointKey: string): Promise<{ deleted: boolean }>;
      };
      network: {
        getLocalIp(): Promise<string>;
        startLanServer(): Promise<{ ip: string; port: number; url: string; token: string }>;
        stopLanServer(): Promise<{ success: boolean }>;
        getLanServerUrl(): Promise<string | null>;
      };
      app: {
        setLocale(locale: string): Promise<boolean>;
        getVersion(): Promise<string>;
        getLocale(): Promise<string>;
        getPath(name: string): Promise<string>;
        openPath(targetPath: string): Promise<{ success: boolean; error?: string }>;
      };
      yearInReview: {
        prepare(photos: Photo[], timeMode: YearReviewTimeMode): Promise<ReviewMonth[]>;
        export(months: ReviewMonth[]): Promise<YearInReviewResult>;
        generate(
          photos: Array<{
            uri: string;
            filename: string;
            timestamp?: number;
            width?: number;
            height?: number;
            fileSize?: number;
            isScreenshot?: boolean;
            thumbnailUri?: string;
          }>,
          timeMode?: YearReviewTimeMode,
        ): Promise<YearInReviewResult>;
      };
    };
  }
}

export {};
