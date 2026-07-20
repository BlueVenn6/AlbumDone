import type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  Photo,
  ProviderMode,
  TestConnectionResult,
  YearInReviewResult,
} from '@photo-manager/shared';

type DesktopProviderRequest = {
  provider: LLMProvider;
  baseUrl?: string;
  model: string;
  supportsVision?: boolean;
  mode?: ProviderMode;
};

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
      saveToArchive(
        photoId: string,
        content: string,
        instruction: string,
      ): Promise<{ success: boolean; id?: string; error?: string }>;
      fs: {
        readImageAsBase64(
          filePath: string,
        ): Promise<{ base64: string; mimeType: string }>;
        readImagePreviewAsBase64(
          filePath: string,
          maxDimension?: number,
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
        deleteFiles(filePaths: string[]): Promise<{
          successCount: number;
          errors: string[];
          deletedPaths?: string[];
          fallbackTrashPaths?: string[];
        }>;
      };
      settings: {
        getProviderConfigs(): Promise<Partial<Record<LLMProvider, import('@photo-manager/shared').ProviderConfig>>>;
        setProviderConfig(config: import('@photo-manager/shared').ProviderConfig): Promise<void>;
        deleteProviderConfig(provider: string): Promise<void>;
        getApiKeyStatus(provider: string): Promise<{
          provider: LLMProvider;
          hasApiKey: boolean;
          maskedKey?: string;
        }>;
        setApiKey(provider: string, apiKey: string): Promise<void>;
        deleteApiKey(provider: string): Promise<void>;
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
        getVersion(): Promise<string>;
        getLocale(): Promise<string>;
        getPath(name: string): Promise<string>;
        openPath(targetPath: string): Promise<{ success: boolean; error?: string }>;
      };
      yearInReview: {
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
          timeMode?: 'rolling' | 'calendar',
        ): Promise<YearInReviewResult>;
      };
      llm: {
        testConnection(
          params: DesktopProviderRequest & { apiKey?: string },
        ): Promise<TestConnectionResult>;
        chat(
          params: DesktopProviderRequest & {
            messages: LLMMessage[];
            options?: { temperature?: number; maxTokens?: number };
          },
        ): Promise<LLMResponse>;
        chatWithImage(
          params: DesktopProviderRequest & {
            prompt: string;
            imageBase64: string;
            mimeType: string;
            options?: { temperature?: number; maxTokens?: number };
          },
        ): Promise<LLMResponse>;
      };
      screenshot: {
        executeInstruction(
          params: DesktopProviderRequest & {
            instruction: string;
            imageBase64: string;
            mimeType: string;
            languageCode?: string;
            requestId: string;
          },
        ): Promise<{ content: string }>;
        cancelInstruction(requestId: string): Promise<{ cancelled: boolean }>;
      };
      ocr: {
        extractText(filePath: string, lang?: string): Promise<{ text: string }>;
      };
    };
  }
}

export {};
