import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './navigation/AppNavigator';
import { colors } from './theme';
import { I18nProvider, useSettingsStore } from '@photo-manager/shared';
import type { LLMProvider } from '@photo-manager/shared';
import { getStoredApiKey } from './utils/secureApiKeys';
import {
  detectMobileSystemLocaleTag,
  detectMobileSystemLocaleTagAsync,
} from './utils/systemLocale';
import { ErrorBoundary } from './components/ErrorBoundary';

const navigationTheme = {
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

export default function App(): React.JSX.Element {
  const [systemLocale, setSystemLocale] = useState(() => detectMobileSystemLocaleTag());

  useEffect(() => {
    let isMounted = true;

    void detectMobileSystemLocaleTagAsync()
      .then((locale) => {
        if (isMounted && locale) {
          setSystemLocale(locale);
        }
      })
      .catch(() => {});

    const hydrateApiKeys = async () => {
      const { providers, updateProvider } = useSettingsStore.getState();
      const entries = Object.entries(providers) as Array<[
        LLMProvider,
        NonNullable<(typeof providers)[LLMProvider]>,
      ]>;

      for (const [provider, config] of entries) {
        if (!config?.hasApiKey) {
          continue;
        }

        try {
          const apiKey = await getStoredApiKey(provider);
          if (isMounted) {
            const { apiKey: _apiKey, ...safeConfig } = config;
            updateProvider(provider, {
              ...safeConfig,
              provider,
              hasApiKey: Boolean(apiKey),
            });
          }
        } catch {
          // Keep non-sensitive settings usable even if the device keychain is locked.
        }
      }
    };

    void hydrateApiKeys();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <I18nProvider followSystemLocale systemLocale={systemLocale}>
      <GestureHandlerRootView style={styles.root}>
        <ErrorBoundary>
          <SafeAreaProvider>
            <StatusBar
              barStyle="dark-content"
              backgroundColor={colors.background}
              translucent={false}
            />
            <NavigationContainer theme={navigationTheme}>
              <AppNavigator />
            </NavigationContainer>
          </SafeAreaProvider>
        </ErrorBoundary>
      </GestureHandlerRootView>
    </I18nProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
