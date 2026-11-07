import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type IpcErrorResponse = {
  __ipcError: true;
  error: {
    channel: string;
    code: string;
    message: string;
  };
};

function isIpcErrorResponse(value: unknown): value is IpcErrorResponse {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { __ipcError?: unknown }).__ipcError === true,
  );
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (isIpcErrorResponse(result)) {
    const error = new Error(result.error.message);
    error.name = result.error.code || 'IPC_ERROR';
    throw error;
  }
  return result as T;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Folder picker & album management (flat methods for HomeScreen)
  getAlbums: () => invoke('fs:getAlbums'),
  selectFolder: () => invoke('dialog:selectFolder'),
  countPhotos: (dirPath: string) => invoke('fs:countPhotos', dirPath),
  getAlbumStats: (dirPath: string) => invoke('fs:getAlbumStats', dirPath),
  saveAlbum: (folderPath: string, photoCount: number, totalBytes?: number) =>
    invoke('fs:saveAlbum', folderPath, photoCount, totalBytes),
  getPhotos: (
    folderPath: string,
    options?: {
      mode?: 'fast' | 'full';
      scanId?: string;
      onBatch?: (
        photos: unknown[],
        scanned: number,
        phase?: 'cached' | 'scanning',
      ) => void;
    },
  ) => {
    const streamedPhotos: unknown[] = [];
    let resolveStreamComplete: (() => void) | null = null;
    const streamComplete = new Promise<void>((resolve) => {
      resolveStreamComplete = resolve;
    });
    const onProgress = (
      _event: IpcRendererEvent,
      payload: {
        scanId: string;
        photos: unknown[];
        scanned: number;
        phase: 'cached' | 'scanning' | 'complete';
      },
    ) => {
      if (payload.scanId === options?.scanId) {
        if (payload.phase === 'complete') {
          resolveStreamComplete?.();
          return;
        }
        if (payload.phase === 'scanning') {
          streamedPhotos.push(...payload.photos);
        }
        options.onBatch?.(payload.photos, payload.scanned, payload.phase);
      }
    };
    if (options?.scanId && options.onBatch) {
      ipcRenderer.on('fs:scanProgress', onProgress);
    }
    return invoke<unknown[] | { streamed: true; count: number }>('fs:getPhotos', folderPath, {
      mode: options?.mode,
      scanId: options?.scanId,
      streamResults: Boolean(options?.scanId && options.onBatch),
    })
      .then(async (result) => {
        if (Array.isArray(result)) return result;
        await Promise.race([
          streamComplete,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Photo scan completion event timed out.')), 5000);
          }),
        ]);
        if (!result.streamed || result.count !== streamedPhotos.length) {
          throw new Error(
            `Photo scan stream count mismatch: expected ${result.count}, received ${streamedPhotos.length}.`,
          );
        }
        return streamedPhotos;
      })
      .finally(() => {
        ipcRenderer.removeListener('fs:scanProgress', onProgress);
      });
  },
  cancelPhotoScan: (scanId: string) => invoke('fs:cancelScan', scanId),
  getPhotoBase64: (photoId: string) => invoke('fs:getPhotoBase64', photoId),

  // File system
  fs: {
    readImageAsBase64: (filePath: string) =>
      invoke('fs:readImageAsBase64', filePath),
    getThumbnail: (filePath: string, size = 200) =>
      invoke('fs:getThumbnail', filePath, size),
    computeContentHashes: (filePaths: string[]) =>
      invoke('fs:computeContentHashes', filePaths),
    computeVisualHashes: (filePaths: string[]) =>
      invoke('fs:computeVisualHashes', filePaths),
    cancelVisualHashes: () =>
      invoke('fs:cancelVisualHashes'),
    moveToTrash: (filePath: string) =>
      invoke('fs:moveToTrash', filePath),
    deleteFiles: (filePaths: string[], mode: 'trash' | 'permanent' = 'trash') =>
      invoke('fs:deleteFiles', filePaths, mode),
  },

  tasks: {
    getCheckpoint: (checkpointKey: string) =>
      invoke('tasks:getCheckpoint', checkpointKey),
    saveCheckpoint: (checkpointKey: string, checkpointPayload: string) =>
      invoke('tasks:saveCheckpoint', checkpointKey, checkpointPayload),
    deleteCheckpoint: (checkpointKey: string) =>
      invoke('tasks:deleteCheckpoint', checkpointKey),
  },

  // Network / LAN server
  network: {
    getLocalIp: () => invoke('network:getLocalIp'),
    startLanServer: () => invoke('network:startLanServer'),
    stopLanServer: () => invoke('network:stopLanServer'),
    getLanServerUrl: () => invoke('network:getLanServerUrl'),
  },

  // App info
  app: {
    setLocale: (locale: string) => invoke('app:setLocale', locale),
    getVersion: () => invoke('app:getVersion'),
    getLocale: () => invoke('app:getLocale'),
    getPath: (name: string) => invoke('app:getPath', name),
    openPath: (targetPath: string) => invoke('app:openPath', targetPath),
  },

  yearInReview: {
    prepare: (photos: unknown[], timeMode: string) => invoke('yearInReview:generate', photos, timeMode, true),
    export: (months: unknown[]) => invoke('yearInReview:export', months),
    generate: (
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
      timeMode: 'rolling' | 'previousYear' | 'calendar' = 'rolling',
    ) => invoke('yearInReview:generate', photos, timeMode),
  },

});
