import { NativeModules } from 'react-native';

type ImageBase64Result = {
  base64: string;
  mimeType: string;
  size?: number;
  filename?: string;
};

type AppDeviceModule = {
  getPreferredLocaleTags?: () => Promise<string[]>;
  readImageAsBase64?: (uri: string) => Promise<ImageBase64Result>;
  computeContentHashes?: (uris: string[]) => Promise<Record<string, string>>;
  computeVisualHashes?: (uris: string[]) => Promise<Record<string, string>>;
};

function getAppDevice(): AppDeviceModule | undefined {
  return (NativeModules as { AppDevice?: AppDeviceModule }).AppDevice;
}

export async function getNativePreferredLocaleTags(): Promise<string[]> {
  const tags = await getAppDevice()?.getPreferredLocaleTags?.();
  return Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : [];
}

export async function readNativeImageAsBase64(uri: string): Promise<ImageBase64Result | null> {
  if (!uri.trim()) {
    return null;
  }
  const result = await getAppDevice()?.readImageAsBase64?.(uri);
  if (!result?.base64 || !result.mimeType) {
    return null;
  }
  return result;
}

export async function computeNativeVisualHashes(uris: string[]): Promise<Record<string, string>> {
  const uniqueUris = [...new Set(uris.filter((uri) => uri.trim().length > 0))];
  if (uniqueUris.length === 0) {
    return {};
  }
  return await getAppDevice()?.computeVisualHashes?.(uniqueUris) ?? {};
}

export async function computeNativeContentHashes(uris: string[]): Promise<Record<string, string>> {
  const uniqueUris = [...new Set(uris.filter((uri) => uri.trim().length > 0))];
  if (uniqueUris.length === 0) {
    return {};
  }
  return await getAppDevice()?.computeContentHashes?.(uniqueUris) ?? {};
}
