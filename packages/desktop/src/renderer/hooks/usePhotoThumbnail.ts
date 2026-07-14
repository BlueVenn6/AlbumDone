import { useEffect, useMemo, useState } from 'react';

const DEFAULT_THUMBNAIL_SIZE = 200;
const THUMBNAIL_CONCURRENCY = 4;
const NULL_CACHE_RETRY_MS = 15000;

const thumbnailUriCache = new Map<string, string>();
const thumbnailNullCache = new Map<string, { reason: string; cachedAt: number }>();
const thumbnailInFlight = new Map<string, Promise<{ uri: string | null; reason: string | null }>>();

type QueueTask = {
  taskKey: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

const thumbnailQueue: QueueTask[] = [];
let activeThumbnailTasks = 0;

function pumpThumbnailQueue(): void {
  while (activeThumbnailTasks < THUMBNAIL_CONCURRENCY && thumbnailQueue.length > 0) {
    const nextTask = thumbnailQueue.shift();
    if (!nextTask) {
      return;
    }

    activeThumbnailTasks += 1;
    void nextTask.run()
      .then(nextTask.resolve, nextTask.reject)
      .finally(() => {
        activeThumbnailTasks -= 1;
        pumpThumbnailQueue();
      });
  }
}

function enqueueThumbnailTask<T>(
  taskKey: string,
  run: () => Promise<T>,
  priority: boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const task = {
      taskKey,
      run: async () => run(),
      resolve: (value) => resolve(value as T),
      reject,
    };
    if (priority) {
      thumbnailQueue.unshift(task);
    } else {
      thumbnailQueue.push(task);
    }
    pumpThumbnailQueue();
  });
}

function getThumbnailCacheKey(filePath: string, size: number): string {
  return `${filePath}::${size}`;
}

function getThumbnailTaskKey(filePath: string, size: number): string {
  return `thumb:${filePath}:${size}`;
}

function rememberThumbnail(cacheKey: string, uri: string): void {
  if (thumbnailUriCache.has(cacheKey)) {
    thumbnailUriCache.delete(cacheKey);
  }
  thumbnailUriCache.set(cacheKey, uri);
  while (thumbnailUriCache.size > 2000) {
    const oldest = thumbnailUriCache.keys().next().value;
    if (!oldest) break;
    thumbnailUriCache.delete(oldest);
  }
}

function getNullCacheEntry(cacheKey: string): { reason: string; cachedAt: number } | null {
  const entry = thumbnailNullCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.cachedAt > NULL_CACHE_RETRY_MS) {
    thumbnailNullCache.delete(cacheKey);
    return null;
  }

  return entry;
}

async function requestThumbnail(
  filePath: string,
  size: number,
  priority: boolean,
): Promise<{ uri: string | null; reason: string | null }> {
  const cacheKey = getThumbnailCacheKey(filePath, size);
  const taskKey = getThumbnailTaskKey(filePath, size);
  if (!filePath) {
    return { uri: null, reason: 'thumbnail_missing_path' };
  }

  const cached = thumbnailUriCache.get(cacheKey);
  if (cached) {
    return { uri: cached, reason: null };
  }

  const cachedNull = getNullCacheEntry(cacheKey);
  if (cachedNull) {
    return { uri: null, reason: cachedNull.reason };
  }

  const inFlight = thumbnailInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const nextRequest = enqueueThumbnailTask(taskKey, async () => {
    const result = await window.electronAPI?.fs.getThumbnail(filePath, size);
    const nextSrc = result?.uri ?? null;
    const reason = result?.reason ?? (nextSrc ? null : 'thumbnail_failed');

    if (!nextSrc) {
      thumbnailNullCache.set(cacheKey, { reason, cachedAt: Date.now() });
      return { uri: null, reason };
    }

    rememberThumbnail(cacheKey, nextSrc);
    thumbnailNullCache.delete(cacheKey);
    return { uri: nextSrc, reason: null };
  }, priority);

  thumbnailInFlight.set(cacheKey, nextRequest);

  try {
    return await nextRequest;
  } catch {
    return { uri: null, reason: 'thumbnail_failed' };
  } finally {
    thumbnailInFlight.delete(cacheKey);
  }
}

export function usePhotoThumbnail(
  filePath: string,
  shouldLoad: boolean,
  initialSrc?: string | null,
  size = DEFAULT_THUMBNAIL_SIZE,
  priority = false,
): {
  src: string | null;
  isLoading: boolean;
  status: 'idle' | 'loading' | 'success' | 'failed';
  reason: string | null;
  retry: () => void;
} {
  const cacheKey = useMemo(() => getThumbnailCacheKey(filePath, size), [filePath, size]);
  const [src, setSrc] = useState<string | null>(() => {
    const cached = thumbnailUriCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (initialSrc) {
      if (size <= DEFAULT_THUMBNAIL_SIZE) {
        rememberThumbnail(cacheKey, initialSrc);
      }
      return initialSrc;
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [reason, setReason] = useState<string | null>(() => getNullCacheEntry(cacheKey)?.reason ?? null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const cached = thumbnailUriCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      setReason(null);
      return;
    }
    if (initialSrc) {
      if (size <= DEFAULT_THUMBNAIL_SIZE) {
        rememberThumbnail(cacheKey, initialSrc);
      }
      setSrc(initialSrc);
      setReason(null);
      return;
    }
    setSrc(null);
    setReason(getNullCacheEntry(cacheKey)?.reason ?? null);
  }, [cacheKey, initialSrc, size]);

  useEffect(() => {
    if (!shouldLoad || !filePath) {
      return;
    }

    const cached = thumbnailUriCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      setReason(null);
      setIsLoading(false);
      return;
    }

    const cachedNull = getNullCacheEntry(cacheKey);
    if (cachedNull) {
      setSrc(null);
      setReason(cachedNull.reason);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setReason(null);

    void requestThumbnail(filePath, size, priority)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSrc(result.uri);
        setReason(result.reason);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, filePath, priority, retryToken, shouldLoad, size]);

  return {
    src,
    isLoading,
    status: isLoading ? 'loading' : src ? 'success' : reason ? 'failed' : 'idle',
    reason,
    retry: () => {
      thumbnailNullCache.delete(cacheKey);
      thumbnailInFlight.delete(cacheKey);
      setRetryToken((value) => value + 1);
    },
  };
}
