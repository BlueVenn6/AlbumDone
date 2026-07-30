/**
 * I18nProvider — wraps react-i18next's I18nextProvider and resolves the app
 * locale from the platform-provided system language.
 *
 * Import this at the root of both the mobile and desktop app.
 */
import React, { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18next, { initI18n, resolveAppLocale } from './index';
import type { SupportedLocale } from './index';

type Props = {
  children: React.ReactNode;
  /** Override locale for testing/storybook.  Normal usage: omit this. */
  forceLocale?: SupportedLocale;
  /** Mobile uses system language only; old stored language settings are ignored. */
  followSystemLocale?: boolean;
  /** Optional platform-provided locale tag, useful for React Native. */
  systemLocale?: string | undefined;
};

/**
 * Mount once at the app root. Initialises i18next on first render and re-syncs
 * whenever the platform-provided system language changes.
 */
export function I18nProvider({
  children,
  forceLocale,
  followSystemLocale = true,
  systemLocale,
}: Props): React.JSX.Element {
  const [ready, setReady] = useState(i18next.isInitialized);

  useEffect(() => {
    let cancelled = false;
    const locale = resolveAppLocale({
      forceLocale,
      followSystemLocale,
      systemLocale,
    });
    if (!i18next.isInitialized || i18next.language !== locale) {
      setReady(false);
    }
    void initI18n(locale).then(() => {
      if (!cancelled) {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [followSystemLocale, forceLocale, systemLocale]);

  if (!ready) {
    return <></>;
  }

  return <I18nextProvider i18n={i18next}>{children}</I18nextProvider>;
}

/**
 * Re-export the hook so screens don't need to import from react-i18next
 * directly; all i18n imports come from @photo-manager/shared.
 */
export { useTranslation } from 'react-i18next';
export type { TFunction } from 'i18next';
