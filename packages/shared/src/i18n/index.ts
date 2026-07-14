import i18next from 'i18next';

import en from './locales/en.json';
import zhHans from './locales/zh-Hans.json';
import zhHant from './locales/zh-Hant.json';

export type SupportedLocale = 'en' | 'zh-Hans' | 'zh-Hant';

export const SUPPORTED_LOCALES: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};

export function normalizeLocale(tag: string | null | undefined): SupportedLocale {
  const normalized = (tag ?? '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase()
    .split('.')[0]
    ?.split('@')[0]
    ?.trim() ?? '';

  const parts = normalized
    .split('-')
    .map((part) => part.replace(/^#/, ''))
    .filter(Boolean);
  const language = parts[0];
  const subtags = new Set(parts.slice(1));

  if (language === 'zh') {
    if (subtags.has('hant')) {
      return 'zh-Hant';
    }
    if (subtags.has('hans')) {
      return 'zh-Hans';
    }
    if (subtags.has('tw') || subtags.has('hk') || subtags.has('mo')) {
      return 'zh-Hant';
    }
    return 'zh-Hans';
  }

  if (language === 'en') {
    return 'en';
  }

  return 'en';
}

const resources = {
  en: { translation: en },
  'zh-Hans': { translation: zhHans },
  'zh-Hant': { translation: zhHant },
};

export type LocaleResolutionOptions = {
  forceLocale?: string | undefined;
  followSystemLocale?: boolean;
  systemLocale?: string | undefined;
};

export function resolveAppLocale(options: LocaleResolutionOptions = {}): SupportedLocale {
  if (options.forceLocale && options.forceLocale !== 'system') {
    return normalizeLocale(options.forceLocale);
  }
  if (options.followSystemLocale) {
    return normalizeLocale(options.systemLocale ?? detectSystemLocaleTag());
  }
  return normalizeLocale(options.systemLocale ?? detectSystemLocaleTag());
}

/**
 * Initialise i18next.  Call once at app startup, before rendering any UI.
 *
 * @param locale   Override locale (e.g. from user settings).  When omitted,
 *                 the function looks at the system language and falls back to
 *                 English.
 */
export function initI18n(locale?: string): Promise<void> {
  const lng = resolveAppLocale({ forceLocale: locale });

  if (i18next.isInitialized) {
    // Allow hot-switching language without reinitialising
    return i18next.changeLanguage(lng).then(() => undefined);
  }

  return i18next.init({
    lng,
    supportedLngs: ['en', 'zh-Hans', 'zh-Hant'],
    fallbackLng: {
      'zh-Hans': ['en'],
      'zh-Hant': ['en'],
      default: ['en'],
    },
    resources,
    parseMissingKeyHandler: () => '',
    interpolation: {
      // React already escapes values
      escapeValue: false,
    },
    returnNull: false,
    react: {
      // All translations are bundled synchronously — no async loading, no Suspense
      useSuspense: false,
    },
  }).then(() => undefined);
}

/**
 * Switch the active language at runtime for tests or platform-provided system
 * locale changes. The app does not expose an in-app language switcher.
 */
export function changeLanguage(locale: SupportedLocale): Promise<void> {
  return i18next.changeLanguage(locale).then(() => undefined);
}

/**
 * Read the system locale from the environment.  Works in both browser
 * (navigator.language) and Node / Electron main process (process.env.LANG).
 */
function detectSystemLocaleTag(): string {
  const globalScope = globalThis as Record<string, unknown>;

  // Browser / Electron renderer
  const navigatorLike = globalScope['navigator'] as { language?: string } | undefined;
  if (navigatorLike?.language) {
    return navigatorLike.language;
  }

  if (typeof Intl !== 'undefined') {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) {
      return locale;
    }
  }

  // Node / Electron main process
  const processLike = globalScope['process'] as { env?: Record<string, string | undefined> } | undefined;
  const lang = processLike?.env?.LANG ?? processLike?.env?.LANGUAGE ?? '';
  if (lang) return lang;

  return 'en';
}

export function detectSystemLocale(): SupportedLocale {
  return normalizeLocale(detectSystemLocaleTag());
}

export function getResolvedLocale(): SupportedLocale {
  return normalizeLocale(i18next.resolvedLanguage ?? i18next.language);
}

export { i18next };
export default i18next;
