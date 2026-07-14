import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import type { LLMProvider, ProviderConfig, ProviderMode } from '@photo-manager/shared';
import {
  PROVIDER_MODELS,
  modelSupportsVision,
  proxyModelSupportsVision,
} from '@photo-manager/shared';
import { useTranslation } from '@photo-manager/shared';
import { colors, typography, spacing, radius } from '../theme';
import { getStoredApiKey } from '../utils/secureApiKeys';
import { getMobileEndpointRisk } from '../utils/mobileEndpointPolicy';

type TestState = 'idle' | 'loading' | 'success' | 'error';

type Props = {
  provider: LLMProvider;
  config?: ProviderConfig;
  onSave: (config: ProviderConfig) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onTest: (config: ProviderConfig) => Promise<void>;
};

export const ApiConfigCard = React.memo(
  ({ provider, config, onSave, onRemove, onTest }: Props): React.JSX.Element => {
    const { t } = useTranslation();
    const providerInfo = PROVIDER_MODELS[provider];
    const [isExpanded, setIsExpanded] = useState(!!config);
    const [apiKey, setApiKey] = useState('');
    const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
    const [selectedModel, setSelectedModel] = useState(
      config?.model ?? providerInfo?.models[0] ?? '',
    );
    const [mode, setMode] = useState<ProviderMode>(config?.mode ?? 'direct');
    const [testState, setTestState] = useState<TestState>('idle');
    const [testError, setTestError] = useState('');
    const [showModelPicker, setShowModelPicker] = useState(false);
    const requiresBaseUrl = provider === 'qwen' || provider === 'custom';
    const hasSavedKey = Boolean(config?.hasApiKey);
    const hasRuntimeKey = Boolean(apiKey.trim() || config?.hasApiKey);
    const canSave = Boolean(
      (hasSavedKey || apiKey.trim())
      && selectedModel.trim()
      && (!requiresBaseUrl || baseUrl.trim()),
    );

    const hasChanges =
      Boolean(apiKey.trim()) ||
      baseUrl !== (config?.baseUrl ?? '') ||
      selectedModel !== (config?.model ?? providerInfo?.models[0] ?? '') ||
      mode !== (config?.mode ?? 'direct');

    useEffect(() => {
      setBaseUrl(config?.baseUrl ?? '');
      setSelectedModel(config?.model ?? providerInfo?.models[0] ?? '');
      setMode(config?.mode ?? 'direct');
    }, [config?.baseUrl, config?.model, config?.mode, providerInfo]);

    useEffect(() => {
      let isActive = true;
      if (!isExpanded || apiKey.trim() || !config?.hasApiKey) {
        return () => {
          isActive = false;
        };
      }

      getStoredApiKey(provider)
        .then((storedKey) => {
          if (isActive && storedKey) {
            setApiKey(storedKey);
          }
        })
        .catch(() => {});

      return () => {
        isActive = false;
      };
    }, [apiKey, config?.hasApiKey, isExpanded, provider]);

    const createConfig = useCallback((): ProviderConfig => {
      const trimmedBaseUrl = baseUrl.trim();
      const trimmedApiKey = apiKey.trim();
      const trimmedModel = selectedModel.trim();
      const supportsVision =
        mode === 'proxy'
          ? proxyModelSupportsVision(provider, trimmedModel, trimmedBaseUrl || undefined)
          : modelSupportsVision(provider, trimmedModel, trimmedBaseUrl || undefined);

      return {
        provider,
        ...(trimmedApiKey
          ? { apiKey: trimmedApiKey }
          : {}),
        hasApiKey: Boolean(trimmedApiKey || config?.hasApiKey),
        model: trimmedModel,
        supportsVision,
        mode,
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
      };
    }, [apiKey, baseUrl, config, mode, provider, providerInfo, selectedModel]);

    const handleSave = useCallback(async (): Promise<boolean> => {
      const endpointRisk = getMobileEndpointRisk(baseUrl, provider);
      if (endpointRisk?.level === 'blocked') {
        setTestState('error');
        setTestError(t(endpointRisk.key));
        return false;
      }
      const nextConfig: ProviderConfig = {
        ...createConfig(),
      };
      await onSave(nextConfig);
      setTestState('idle');
      return true;
    }, [baseUrl, createConfig, onSave, provider, t]);

    const handleRemove = useCallback(async () => {
      await onRemove();
      setApiKey('');
      setBaseUrl('');
      setSelectedModel(providerInfo?.models[0] ?? '');
      setMode('direct');
      setTestState('idle');
      setTestError('');
    }, [onRemove, providerInfo]);

    const handleTest = useCallback(async () => {
      const storedApiKey = apiKey.trim()
        || (config?.hasApiKey ? await getStoredApiKey(provider).catch(() => null) : null)
        || '';

      if (!storedApiKey.trim()) {
        setTestState('error');
        setTestError(t('settings.apiConfig.missingSessionKey'));
        return;
      }

      const trimmedBaseUrl = baseUrl.trim();
      const testConfig: ProviderConfig = {
        ...createConfig(),
        apiKey: storedApiKey.trim(),
        hasApiKey: true,
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
      };

      // Save first if there are changes
      if (hasChanges && canSave) {
        const saved = await handleSave();
        if (!saved) {
          return;
        }
      }

      setTestState('loading');
      setTestError('');

      try {
        await onTest(testConfig);
        setTestState('success');
        setTimeout(() => setTestState('idle'), 3000);
      } catch (err) {
        setTestState('error');
        setTestError(err instanceof Error ? err.message : t('settings.apiConfig.testFailed'));
        setTimeout(() => setTestState('idle'), 5000);
      }
    }, [
      config,
      apiKey,
      hasChanges,
      handleSave,
      onTest,
      t,
      baseUrl,
      selectedModel,
      provider,
      providerInfo,
      canSave,
      createConfig,
    ]);

    const isConfigured = Boolean(config && hasSavedKey);

    return (
      <View style={[styles.card, isConfigured && styles.cardConfigured]}>
        {/* Card Header */}
        <TouchableOpacity
          style={styles.header}
          onPress={() => setIsExpanded((v) => !v)}
          activeOpacity={0.7}
        >
          <View style={styles.headerLeft}>
            <View style={[styles.statusDot, isConfigured && styles.statusDotActive]} />
            <Text style={styles.providerName}>
              {providerInfo?.name ?? provider}
            </Text>
            {isConfigured && (
              <Text style={styles.configuredBadge}>{t('settings.apiConfig.configured')}</Text>
            )}
          </View>
          <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.body}>
            {/* API Key */}
            <Text style={styles.fieldLabel}>{t('settings.apiConfig.keyLabel')}</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={hasSavedKey ? t('settings.apiConfig.savedKeyPlaceholder') : 'sk-...'}
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            {hasSavedKey && !hasRuntimeKey && (
              <Text style={styles.hintText}>
                {t('settings.apiConfig.secureKeyHint')}
              </Text>
            )}

            <Text style={styles.fieldLabel}>{t('settings.apiConfig.modeLabel')}</Text>
            <View style={styles.modeRow}>
              {(['direct', 'proxy'] as ProviderMode[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.modeButton, mode === option && styles.modeButtonActive]}
                  onPress={() => setMode(option)}
                >
                  <Text style={[styles.modeButtonText, mode === option && styles.modeButtonTextActive]}>
                    {option === 'direct'
                      ? t('settings.apiConfig.directMode')
                      : t('settings.apiConfig.cloudCompatibleMode')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>
              {provider === 'qwen'
                ? t('settings.apiConfig.qwenBaseUrlLabel')
                : t('settings.apiConfig.baseUrlLabel')}
              {!requiresBaseUrl ? ` (${t('common.notSet')})` : ''}
            </Text>
            <TextInput
              style={styles.input}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={provider === 'qwen'
                ? t('settings.apiConfig.qwenBaseUrlPlaceholder')
                : t('settings.apiConfig.baseUrlPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            {/* Model Selector */}
            <Text style={styles.fieldLabel}>{t('settings.apiConfig.modelLabel')}</Text>
            <TextInput
              style={styles.input}
              value={selectedModel}
              onChangeText={setSelectedModel}
              placeholder={t('settings.apiConfig.customModelPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {(providerInfo?.models.length ?? 0) > 0 && (
              <TouchableOpacity
                style={styles.modelSelector}
                onPress={() => setShowModelPicker((v) => !v)}
              >
                <Text style={styles.modelSelectorText}>
                  {showModelPicker
                    ? t('settings.apiConfig.hidePresetModels')
                    : t('settings.apiConfig.showPresetModels')}
                </Text>
                <Text style={styles.chevron}>{showModelPicker ? '▲' : '▼'}</Text>
              </TouchableOpacity>
            )}

            {showModelPicker && (
              <View style={styles.modelList}>
                {(providerInfo?.models ?? []).map((model) => (
                  <TouchableOpacity
                    key={model}
                    style={[
                      styles.modelOption,
                      selectedModel === model && styles.modelOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedModel(model);
                      setShowModelPicker(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modelOptionText,
                        selectedModel === model && styles.modelOptionTextSelected,
                      ]}
                    >
                      {model}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  (!canSave || !hasChanges) && styles.saveButtonDisabled,
                ]}
                onPress={handleSave}
                disabled={!canSave || !hasChanges}
              >
                <Text style={styles.saveButtonText}>{t('common.save')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.testButton,
                  testState === 'loading' && styles.testButtonLoading,
                  testState === 'success' && styles.testButtonSuccess,
                  testState === 'error' && styles.testButtonError,
                ]}
                onPress={handleTest}
                disabled={testState === 'loading' || !hasRuntimeKey}
              >
                {testState === 'loading' ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={styles.testButtonText}>
                    {testState === 'success'
                      ? `✅ ${t('settings.apiConfig.testSuccess')}`
                      : testState === 'error'
                      ? `❌ ${t('settings.apiConfig.testBtn')}`
                      : t('settings.apiConfig.testBtn')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {testState === 'error' && testError && (
              <Text style={styles.errorText}>{testError}</Text>
            )}

            {isConfigured && (
              <TouchableOpacity style={styles.removeButton} onPress={handleRemove}>
                <Text style={styles.removeButtonText}>{t('common.remove')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  },
);
ApiConfigCard.displayName = 'ApiConfigCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  cardConfigured: {
    borderColor: colors.accent + '40',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.textTertiary,
  },
  statusDotActive: {
    backgroundColor: colors.success,
  },
  providerName: {
    fontSize: typography.sizes.md,
    fontWeight: '600',
    color: colors.text,
  },
  configuredBadge: {
    fontSize: typography.sizes.xs,
    color: colors.success,
    backgroundColor: colors.successDim,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.sizes.sm,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hintText: {
    marginTop: spacing.xs,
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    lineHeight: 18,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  modeButton: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  modeButtonText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: colors.accent,
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
  },
  modelSelectorText: {
    fontSize: typography.sizes.md,
    color: colors.text,
  },
  modelList: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  modelOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  modelOptionSelected: {
    backgroundColor: colors.accentDim,
  },
  modelOptionText: {
    fontSize: typography.sizes.sm,
    color: colors.text,
  },
  modelOptionTextSelected: {
    color: colors.accent,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    color: colors.textOnStrong,
    fontSize: typography.sizes.md,
    fontWeight: '600',
  },
  testButton: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  testButtonLoading: {
    opacity: 0.6,
  },
  testButtonSuccess: {
    borderColor: colors.success,
    backgroundColor: colors.successDim,
  },
  testButtonError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerDim,
  },
  testButtonText: {
    color: colors.text,
    fontSize: typography.sizes.md,
  },
  errorText: {
    fontSize: typography.sizes.sm,
    color: colors.danger,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  removeButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  removeButtonText: {
    color: colors.danger,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
  },
});
