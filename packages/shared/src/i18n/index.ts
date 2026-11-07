import i18next from 'i18next';

import en from './locales/en.json';
import zhHans from './locales/zh-Hans.json';
import zhHant from './locales/zh-Hant.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import it from './locales/it.json';
import hu from './locales/hu.json';
import pl from './locales/pl.json';
import cs from './locales/cs.json';
import ro from './locales/ro.json';
import uk from './locales/uk.json';
import hr from './locales/hr.json';

export type SupportedLocale = 'en' | 'zh-Hans' | 'zh-Hant' | 'fr' | 'de' | 'ru' | 'ja' | 'ko' | 'it' | 'hu' | 'pl' | 'cs' | 'ro' | 'uk' | 'hr';

export const SUPPORTED_LOCALES: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
  ja: '日本語',
  ko: '한국어',
  it: 'Italiano',
  hu: 'Magyar',
  pl: 'Polski',
  cs: 'Čeština',
  ro: 'Română',
  uk: 'Українська',
  hr: 'Hrvatski',
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

  if (language && Object.prototype.hasOwnProperty.call(SUPPORTED_LOCALES, language)) {
    return language as SupportedLocale;
  }

  return 'en';
}

const resources = {
  en: { translation: en },
  'zh-Hans': { translation: zhHans },
  'zh-Hant': { translation: zhHant },
  fr: { translation: fr },
  de: { translation: de },
  ru: { translation: ru },
  ja: { translation: ja },
  ko: { translation: ko },
  it: { translation: it },
  hu: { translation: hu },
  pl: { translation: pl },
  cs: { translation: cs },
  ro: { translation: ro },
  uk: { translation: uk },
  hr: { translation: hr },
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
    supportedLngs: Object.keys(SUPPORTED_LOCALES),
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
 * locale changes. Desktop also exposes this through its language selector.
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
