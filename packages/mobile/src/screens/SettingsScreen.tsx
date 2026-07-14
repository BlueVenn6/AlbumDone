import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useSettingsStore,
  PROVIDER_MODELS,
  LLMClient,
  configSupportsVision,
} from '@photo-manager/shared';
import type { LLMProvider, ProviderConfig } from '@photo-manager/shared';
import { useTranslation } from '@photo-manager/shared';
import { colors, typography, spacing, radius, commonStyles } from '../theme';
import { ApiConfigCard } from '../components/ApiConfigCard';
import { deleteStoredApiKey, setStoredApiKey } from '../utils/secureApiKeys';

const API_ERROR_KEYS: Record<string, string> = {
  api_key: 'settings.apiConfig.errors.apiKey',
  permission: 'settings.apiConfig.errors.permission',
  base_url: 'settings.apiConfig.errors.baseUrl',
  model_not_found: 'settings.apiConfig.errors.modelNotFound',
  request_format: 'settings.apiConfig.errors.requestFormat',
  rate_limited: 'settings.apiConfig.errors.rateLimited',
  proxy: 'settings.apiConfig.errors.proxy',
  server: 'settings.apiConfig.errors.server',
  timeout: 'settings.apiConfig.errors.timeout',
  network: 'settings.apiConfig.errors.network',
  empty_response: 'settings.apiConfig.errors.emptyResponse',
  unknown: 'settings.apiConfig.errors.unknown',
};
const DEFAULT_API_ERROR_KEY = 'settings.apiConfig.errors.unknown';

const ALL_PROVIDERS: LLMProvider[] = [
  'openai',
  'anthropic',
  'google',
  'moonshot',
  'zhipu',
  'qwen',
  'minimax',
  'deepseek',
  'custom',
];

export function SettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const {
    providers,
    defaultVisionProvider,
    defaultTextProvider,
    updateProvider,
    removeProvider,
    setDefaultVisionProvider,
    setDefaultTextProvider,
  } = settings;

  const configuredProviders = ALL_PROVIDERS.filter((p) => !!providers[p]);
  const visionCapableProviders = configuredProviders.filter((p) =>
    configSupportsVision(providers[p]),
  );

  const handleProviderTest = useCallback(
    async (config: ProviderConfig) => {
      const provider = config.provider;
      if (!config.apiKey?.trim()) {
        throw new Error(t('settings.apiConfig.missingSessionKeyForTest'));
      }
      const client = new LLMClient(config);
      const result = await client.testConnection();
      if (result.success) {
        const taskType = result.mode === 'vision'
          ? t('settings.apiConfig.visionTested')
          : t('settings.apiConfig.textTested');
        Alert.alert(
          t('settings.apiConfig.testSuccess'),
          `${PROVIDER_MODELS[provider]?.name} ${t('settings.apiConfig.configured')} · ${taskType}`,
        );
      } else {
        const errorKey = result.category ? API_ERROR_KEYS[result.category] : undefined;
        throw new Error(
          errorKey
            ? t(errorKey)
            : result.error ?? t(DEFAULT_API_ERROR_KEY),
        );
      }
    },
    [t],
  );

  const handleProviderSave = useCallback(
    async (provider: LLMProvider, config: ProviderConfig) => {
      const apiKey = config.apiKey?.trim();
      if (apiKey) {
        await setStoredApiKey(provider, apiKey);
      }
      const { apiKey: _apiKey, ...safeConfig } = config;
      updateProvider(provider, {
        ...safeConfig,
        provider,
        hasApiKey: Boolean(apiKey || config.hasApiKey),
      });
    },
    [updateProvider],
  );

  const handleProviderRemove = useCallback(
    async (provider: LLMProvider) => {
      await deleteStoredApiKey(provider);
      removeProvider(provider);
    },
    [removeProvider],
  );

  return (
    <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* API Configuration */}
        <Text style={commonStyles.sectionTitle}>{t('settings.apiConfig.title')}</Text>
        <Text style={styles.description}>{t('settings.apiConfig.description')}</Text>
        {ALL_PROVIDERS.map((provider) => {
          const providerConfig = providers[provider];
          return (
            <ApiConfigCard
              key={provider}
              provider={provider}
              {...(providerConfig ? { config: providerConfig } : {})}
              onSave={(config) => handleProviderSave(provider, config)}
              onRemove={() => handleProviderRemove(provider)}
              onTest={handleProviderTest}
            />
          );
        })}

        {/* Vision Provider */}
        {visionCapableProviders.length > 0 && (
          <>
            <Text style={commonStyles.sectionTitle}>{t('settings.taskRouting.vision')}</Text>
            <View style={styles.card}>
              {visionCapableProviders.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={styles.providerRow}
                  onPress={() => setDefaultVisionProvider(p)}
                >
                  <View style={styles.providerRowLeft}>
                    <View
                      style={[
                        styles.radioButton,
                        defaultVisionProvider === p && styles.radioButtonSelected,
                      ]}
                    >
                      {defaultVisionProvider === p && (
                        <View style={styles.radioButtonInner} />
                      )}
                    </View>
                    <Text style={styles.providerName}>
                      {PROVIDER_MODELS[p]?.name ?? p}
                    </Text>
                  </View>
                  <Text style={styles.providerModel}>{providers[p]?.model}</Text>
                </TouchableOpacity>
              ))}
              {defaultVisionProvider && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => setDefaultVisionProvider(null)}
                >
                  <Text style={styles.clearButtonText}>{t('common.remove')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* Text Provider */}
        {configuredProviders.length > 0 && (
          <>
            <Text style={commonStyles.sectionTitle}>{t('settings.taskRouting.text')}</Text>
            <View style={styles.card}>
              {configuredProviders.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={styles.providerRow}
                  onPress={() => setDefaultTextProvider(p)}
                >
                  <View style={styles.providerRowLeft}>
                    <View
                      style={[
                        styles.radioButton,
                        defaultTextProvider === p && styles.radioButtonSelected,
                      ]}
                    >
                      {defaultTextProvider === p && (
                        <View style={styles.radioButtonInner} />
                      )}
                    </View>
                    <Text style={styles.providerName}>
                      {PROVIDER_MODELS[p]?.name ?? p}
                    </Text>
                  </View>
                  <Text style={styles.providerModel}>{providers[p]?.model}</Text>
                </TouchableOpacity>
              ))}
              {defaultTextProvider && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => setDefaultTextProvider(null)}
                >
                  <Text style={styles.clearButtonText}>{t('common.remove')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* Version */}
        <Text style={styles.versionText}>{t('home.title')} v0.1.1</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  description: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  providerRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  providerName: {
    fontSize: typography.sizes.md,
    color: colors.text,
  },
  providerModel: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    borderColor: colors.accent,
  },
  radioButtonInner: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  clearButton: {
    padding: spacing.sm,
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: typography.sizes.sm,
    color: colors.danger,
  },
  versionText: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
