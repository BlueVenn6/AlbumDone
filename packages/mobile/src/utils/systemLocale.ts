import { I18nManager, NativeModules, Platform } from 'react-native';
import { getNativePreferredLocaleTags } from './nativeAppDevice';

type SettingsManagerModule = {
  settings?: {
    AppleLocale?: string;
    AppleLanguages?: string[];
  };
};

function normalizeNativeLocaleTag(locale: string | undefined): string | undefined {
  return locale?.trim().replace(/_/g, '-');
}

function extractLocaleTag(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeNativeLocaleTag(value);
  if (!normalized) {
    return undefined;
  }

  const languageTag = normalized
    .split('.')[0]
    ?.split('@')[0]
    ?.trim();
  return languageTag || undefined;
}

export function detectMobileSystemLocaleTag(): string | undefined {
  const i18nConstants = I18nManager.getConstants?.();
  const i18nLocale = normalizeNativeLocaleTag(
    i18nConstants?.localeIdentifier ?? undefined,
  );

  if (Platform.OS === 'ios') {
    const settingsManager = NativeModules.SettingsManager as SettingsManagerModule | undefined;
    const settings = settingsManager?.settings;
    const extracted =
      extractLocaleTag(settings?.AppleLocale)
      ?? extractLocaleTag(settings?.AppleLanguages?.[0])
      ?? i18nLocale;
    return extracted;
  }

  const fallbackLocale = extractLocaleTag(i18nLocale);
  if (fallbackLocale) {
    return fallbackLocale;
  }

  return i18nLocale ?? 'en';
}

export async function detectMobileSystemLocaleTagAsync(): Promise<string | undefined> {
  try {
    const nativeTags = await getNativePreferredLocaleTags();
    const firstNativeTag = nativeTags
      .map(extractLocaleTag)
      .find((tag): tag is string => Boolean(tag));
    if (firstNativeTag) {
      return firstNativeTag;
    }
  } catch {
    // Fall back to React Native's synchronous locale constants.
  }

  return detectMobileSystemLocaleTag();
}
