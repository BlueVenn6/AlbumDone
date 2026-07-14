import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { captureRef } from 'react-native-view-shot';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import {
  configSupportsVision,
  executeInstruction,
  filterScreenshots,
  formatProviderRouteLabel,
  resolveProviderRoute,
  usePhotoStore,
  useSettingsStore,
  useTranslation,
} from '@photo-manager/shared';
import type { CustomInstruction, LLMProvider, Photo } from '@photo-manager/shared';
import { colors, typography, spacing, radius, commonStyles } from '../theme';
import { createRuntimeLLMClient } from '../utils/runtimeProviderConfig';
import { copyText } from '../utils/clipboard';
import { loadMobileAlbumSnapshot } from '../utils/photoAlbumRepository';
import { readNativeImageAsBase64 } from '../utils/nativeAppDevice';
import { updateScannedAlbumCount } from '../utils/albumCounts';

type Props = NativeStackScreenProps<HomeStackParamList, 'Screenshots'>;

type PresetInstruction = {
  id: string;
  label: string;
  prompt: string;
};

function getEndpointHost(baseUrl?: string): string {
  try {
    return baseUrl ? new URL(baseUrl).host : '';
  } catch {
    return '';
  }
}

function getCloudDestination(
  route: { provider: LLMProvider; config: { baseUrl?: string } },
  fallbackLabel: string,
): string {
  const host = getEndpointHost(route.config.baseUrl);
  if (route.provider === 'custom' && host) {
    return `Custom Endpoint (${host})`;
  }
  if (route.config.baseUrl && host) {
    return `${fallbackLabel} (${host})`;
  }
  return fallbackLabel;
}

function useScreenshotInstructions(): PresetInstruction[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        id: 'extract_text',
        label: t('screenshots.instructions.extract_text'),
        prompt: t('screenshots.instructionPrompts.extract_text'),
      },
      {
        id: 'translate_zh',
        label: t('screenshots.instructions.translate_zh'),
        prompt: t('screenshots.instructionPrompts.translate_zh'),
      },
      {
        id: 'translate_en',
        label: t('screenshots.instructions.translate_en'),
        prompt: t('screenshots.instructionPrompts.translate_en'),
      },
      {
        id: 'key_points',
        label: t('screenshots.instructions.key_points'),
        prompt: t('screenshots.instructionPrompts.key_points'),
      },
      {
        id: 'todos',
        label: t('screenshots.instructions.todos'),
        prompt: t('screenshots.instructionPrompts.todos'),
      },
      {
        id: 'formal_email',
        label: t('screenshots.instructions.formal_email'),
        prompt: t('screenshots.instructionPrompts.formal_email'),
      },
      {
        id: 'casual_msg',
        label: t('screenshots.instructions.casual_msg'),
        prompt: t('screenshots.instructionPrompts.casual_msg'),
      },
      {
        id: 'extract_numbers',
        label: t('screenshots.instructions.extract_numbers'),
        prompt: t('screenshots.instructionPrompts.extract_numbers'),
      },
      {
        id: 'summarize',
        label: t('screenshots.instructions.summarize'),
        prompt: t('screenshots.instructionPrompts.summarize'),
      },
      {
        id: 'commitments',
        label: t('screenshots.instructions.commitments'),
        prompt: t('screenshots.instructionPrompts.commitments'),
      },
    ],
    [t],
  );
}

export function ScreenshotScreen({ route, navigation }: Props): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const { albumId } = route.params;
  const previewRef = useRef<View>(null);
  const settings = useSettingsStore();
  const [scannedPhotos, setScannedPhotos] = useState<Photo[]>([]);
  const instructions = useScreenshotInstructions();
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | ''>('');
  const [runningInstruction, setRunningInstruction] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [currentInstructionLabel, setCurrentInstructionLabel] = useState('');
  const [customInstruction, setCustomInstruction] = useState('');
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(true);
  const [scanCount, setScanCount] = useState(0);
  const trustedCloudRoutesRef = useRef(new Set<string>());
  const instructionAbortControllerRef = useRef<AbortController | null>(null);
  const screenshots = useMemo(() => filterScreenshots(scannedPhotos), [scannedPhotos]);
  const [activeId, setActiveId] = useState<string | null>(screenshots[0]?.id ?? null);
  const activePhoto = useMemo(
    () => screenshots.find((photo) => photo.id === activeId) ?? screenshots[0] ?? null,
    [activeId, screenshots],
  );
  const activePosition = activePhoto
    ? screenshots.findIndex((photo) => photo.id === activePhoto.id) + 1
    : 0;

  useEffect(() => {
    let cancelled = false;

    const scan = async () => {
      setIsScanning(true);
      setError('');
      setScannedPhotos([]);
      try {
        const snapshot = await loadMobileAlbumSnapshot(albumId, {
          onProgress: ({ loaded }) => {
            if (!cancelled) {
              setScanCount(loaded);
            }
          },
          onBatch: (batch) => {
            if (!cancelled) {
              setScannedPhotos((previous) => {
                const byId = new Map(previous.map((photo) => [photo.id, photo]));
                for (const photo of batch) {
                  if (!byId.has(photo.id)) {
                    byId.set(photo.id, photo);
                  }
                }
                return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
              });
            }
          },
          shouldCancel: () => cancelled,
        });

        if (!cancelled) {
          setScannedPhotos(snapshot.photos);
          usePhotoStore.getState().loadPhotos(snapshot.photos);
          updateScannedAlbumCount(albumId, snapshot.count, snapshot.totalBytes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('common.unknownError'));
        }
      } finally {
        if (!cancelled) {
          setIsScanning(false);
        }
      }
    };

    void scan();

    return () => {
      cancelled = true;
    };
  }, [albumId, t]);

  useEffect(() => () => {
    instructionAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!activeId || !screenshots.some((photo) => photo.id === activeId)) {
      setActiveId(screenshots[0]?.id ?? null);
    }
  }, [activeId, screenshots]);

  const visionProviders = useMemo(
    () =>
      Object.entries(settings.providers).flatMap(([provider, config]) => {
        if (!config || !configSupportsVision(config)) {
          return [];
        }
        const providerKey = provider as LLMProvider;
        return [{
          provider: providerKey,
          label: formatProviderRouteLabel({ provider: providerKey, config }),
        }];
      }),
    [settings.providers],
  );

  useEffect(() => {
    if (
      selectedProvider
      && !visionProviders.some((option) => option.provider === selectedProvider)
    ) {
      setSelectedProvider('');
    }
  }, [selectedProvider, visionProviders]);

  const activeVisionRoute = useMemo(
    () => resolveProviderRoute(
      settings.providers,
      {
        providerKey: selectedProvider || null,
        defaultVisionProvider: settings.defaultVisionProvider,
        defaultTextProvider: settings.defaultTextProvider,
      },
      { requiresVision: true, allowMissingApiKey: true },
    ),
    [
      selectedProvider,
      settings.defaultTextProvider,
      settings.defaultVisionProvider,
      settings.providers,
    ],
  );
  const activeVisionLabel = activeVisionRoute
    ? formatProviderRouteLabel(activeVisionRoute)
    : null;
  const canExecuteInstruction = Boolean(activePhoto && activeVisionRoute) && !runningInstruction;
  const activeCloudRouteKey = activeVisionRoute
    ? `${activeVisionRoute.provider}:${activeVisionRoute.config.baseUrl ?? ''}:${activeVisionRoute.config.model}`
    : '';
  const activeCloudDestination = activeVisionRoute
    ? getCloudDestination(activeVisionRoute, activeVisionLabel ?? activeVisionRoute.provider)
    : '';
  const activeCloudRequiresConfirmation = Boolean(activeVisionRoute);

  const requestCloudConfirmation = useCallback(
    (routeKey: string, destination: string) =>
      new Promise<'cancel' | 'once' | 'session'>((resolve) => {
        Alert.alert(
          t('screenshots.cloudConfirmTitle'),
          t('screenshots.cloudConfirmBody', { destination }),
          [
            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve('cancel') },
            { text: t('screenshots.continueOnce'), onPress: () => resolve('once') },
            {
              text: t('screenshots.trustForSession'),
              onPress: () => {
                trustedCloudRoutesRef.current.add(routeKey);
                resolve('session');
              },
            },
          ],
        );
      }),
    [t],
  );

  const handleExecute = useCallback(
    async (instructionText: string, instructionId: string, instructionLabel: string) => {
      if (!activePhoto || !previewRef.current || runningInstruction) {
        return;
      }

      setRunningInstruction(instructionId);
      setResult('');
      setCurrentInstructionLabel(instructionLabel);
      setError('');

      try {
        if (
          activeCloudRequiresConfirmation
          && activeCloudRouteKey
          && !trustedCloudRoutesRef.current.has(activeCloudRouteKey)
        ) {
          const choice = await requestCloudConfirmation(activeCloudRouteKey, activeCloudDestination);
          if (choice === 'cancel') {
            return;
          }
        }

        const client = await createRuntimeLLMClient(activeVisionRoute?.config);
        if (!client) {
          throw new Error(activeVisionRoute ? t('screenshots.noApiKey') : t('screenshots.noVisionModel'));
        }

        const controller = new AbortController();
        instructionAbortControllerRef.current = controller;

        const originalImage = await readNativeImageAsBase64(activePhoto.uri).catch(() => null);
        if (controller.signal.aborted) {
          return;
        }
        const fallbackBase64 = originalImage
          ? null
          : await captureRef(previewRef, {
              format: 'jpg',
              quality: 0.92,
              result: 'base64',
            });
        const output = await executeInstruction(
          originalImage?.base64 ?? fallbackBase64 ?? '',
          originalImage?.mimeType ?? 'image/jpeg',
          instructionText,
          client,
          i18n.language,
          { signal: controller.signal, timeoutMs: 60000 },
        );
        setResult(output);
      } catch (err) {
        if (!instructionAbortControllerRef.current?.signal.aborted) {
          setError(err instanceof Error ? err.message : t('analysis.instructionFailed'));
        }
      } finally {
        instructionAbortControllerRef.current = null;
        setRunningInstruction(null);
      }
    },
    [
      activeCloudDestination,
      activeCloudRequiresConfirmation,
      activeCloudRouteKey,
      activePhoto,
      activeVisionRoute,
      i18n.language,
      requestCloudConfirmation,
      runningInstruction,
      t,
    ],
  );

  const handleCancelInstruction = useCallback(() => {
    instructionAbortControllerRef.current?.abort();
  }, []);

  const handlePresetExecute = useCallback(
    (instruction: PresetInstruction) => {
      void handleExecute(instruction.prompt, instruction.id, instruction.label);
    },
    [handleExecute],
  );

  const handleCustomExecute = useCallback(() => {
    const trimmed = customInstruction.trim();
    if (!trimmed) {
      return;
    }
    void handleExecute(trimmed, 'custom', trimmed);
    setCustomInstruction('');
  }, [customInstruction, handleExecute]);

  const handleSavedInstructionExecute = useCallback(
    (instruction: CustomInstruction) => {
      void handleExecute(instruction.prompt, `custom-${instruction.id}`, instruction.name);
    },
    [handleExecute],
  );

  const handleCopy = useCallback(async () => {
    if (!result) {
      return;
    }
    await copyText(result);
  }, [result]);

  const renderScreenshot = useCallback(
    ({ item }: { item: Photo }) => (
      <TouchableOpacity
        style={[
          styles.thumbnailButton,
          item.id === activePhoto?.id && styles.thumbnailButtonActive,
        ]}
        onPress={() => {
          setActiveId(item.id);
          setResult('');
          setError('');
        }}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: item.thumbnailUri ?? item.uri, width: 96, height: 96 }}
          style={styles.thumbnailImage}
          resizeMode="cover"
          resizeMethod="resize"
        />
      </TouchableOpacity>
    ),
    [activePhoto?.id],
  );

  if (isScanning && screenshots.length === 0) {
    return (
      <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.emptyTitle}>{t('dedup.analyzingTitle')}</Text>
          <Text style={styles.emptySubtitle}>
            {t('common.photoCount', { count: scanCount })}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screenshots.length === 0) {
    return (
      <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>□</Text>
          <Text style={styles.emptyTitle}>
            {error ? t('common.error') : t('screenshots.noSelection')}
          </Text>
          <Text style={styles.emptySubtitle}>
            {error || t('screenshots.emptySubtitle')}
          </Text>
          <TouchableOpacity
            style={[commonStyles.primaryButton, styles.backButton]}
            onPress={() => navigation.goBack()}
          >
            <Text style={commonStyles.primaryButtonText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          <View style={styles.previewSection}>
            <View ref={previewRef} collapsable={false} style={styles.previewCard}>
              {activePhoto && (
                <Image
                  source={{ uri: activePhoto.uri, width: 1280, height: 1280 }}
                  style={styles.previewImage}
                  resizeMode="contain"
                  resizeMethod="resize"
                />
              )}
            </View>

            <Text style={styles.thumbnailPosition}>
              {t('screenshots.position', {
                current: activePosition,
                total: screenshots.length,
              })}
            </Text>
            <FlatList
              horizontal
              data={screenshots}
              keyExtractor={(item) => item.id}
              renderItem={renderScreenshot}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbnailList}
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={5}
              removeClippedSubviews={Platform.OS === 'android'}
              getItemLayout={(_data, index) => ({ length: 60, offset: 60 * index, index })}
            />
          </View>

          <ScrollView
            style={styles.controlsScroll}
            contentContainerStyle={styles.controlsContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
          <View style={[
            styles.modelBox,
            !activeVisionLabel && styles.modelBoxWarning,
          ]}>
            <Text style={[
              styles.modelLabel,
              !activeVisionLabel && styles.modelLabelWarning,
            ]}>
              {activeVisionLabel
                ? t('screenshots.usingModel', { model: activeVisionLabel })
                : t('screenshots.noVisionModel')}
            </Text>
            {visionProviders.length > 0 && (
              <TouchableOpacity
                style={[
                  styles.providerChip,
                  !selectedProvider && styles.providerChipActive,
                ]}
                onPress={() => setSelectedProvider('')}
              >
                <Text style={[
                  styles.providerChipText,
                  !selectedProvider && styles.providerChipTextActive,
                ]}>
                  {t('screenshots.useDefaultModel')}
                </Text>
              </TouchableOpacity>
            )}
            {visionProviders.length > 1 && (
              <View style={styles.providerRow}>
                {visionProviders.map((option) => (
                  <TouchableOpacity
                    key={option.provider}
                    style={[
                      styles.providerChip,
                      activeVisionRoute?.provider === option.provider && selectedProvider === option.provider && styles.providerChipActive,
                    ]}
                    onPress={() => setSelectedProvider(option.provider)}
                  >
                    <Text style={[
                      styles.providerChipText,
                      activeVisionRoute?.provider === option.provider && selectedProvider === option.provider && styles.providerChipTextActive,
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={styles.instructions}>
            {instructions.map((instruction) => (
              <TouchableOpacity
                key={instruction.id}
                style={[
                  styles.instructionButton,
                  !canExecuteInstruction && styles.instructionButtonDisabled,
                ]}
                onPress={() => handlePresetExecute(instruction)}
                disabled={!canExecuteInstruction}
              >
                {runningInstruction === instruction.id ? (
                  <ActivityIndicator size="small" color={colors.textOnStrong} />
                ) : (
                  <Text style={styles.instructionButtonText}>{instruction.label}</Text>
                )}
              </TouchableOpacity>
            ))}
            {settings.customInstructions?.map((instruction) => (
              <TouchableOpacity
                key={instruction.id}
                style={[
                  styles.instructionButton,
                  styles.savedInstructionButton,
                  !canExecuteInstruction && styles.instructionButtonDisabled,
                ]}
                onPress={() => handleSavedInstructionExecute(instruction)}
                disabled={!canExecuteInstruction}
              >
                {runningInstruction === `custom-${instruction.id}` ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={[styles.instructionButtonText, styles.savedInstructionButtonText]}>
                    {instruction.name}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.customRow}>
            <TextInput
              style={styles.customInput}
              value={customInstruction}
              onChangeText={setCustomInstruction}
              placeholder={t('screenshots.customPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              onSubmitEditing={handleCustomExecute}
              returnKeyType="go"
              editable={canExecuteInstruction}
            />
            <TouchableOpacity
              style={[
                styles.executeButton,
                (!customInstruction.trim() || !canExecuteInstruction) && styles.instructionButtonDisabled,
              ]}
              onPress={handleCustomExecute}
              disabled={!customInstruction.trim() || !canExecuteInstruction}
            >
              {runningInstruction === 'custom' ? (
                <ActivityIndicator size="small" color={colors.textOnStrong} />
              ) : (
                <Text style={styles.executeButtonText}>{t('screenshots.execute')}</Text>
              )}
            </TouchableOpacity>
          </View>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          {result || runningInstruction ? (
            <View style={styles.resultBox}>
              {currentInstructionLabel ? (
                <Text style={styles.resultLabel}>{currentInstructionLabel}</Text>
              ) : null}
              {runningInstruction ? (
                <View style={styles.resultLoading}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.resultLoadingText}>{t('screenshots.executing')}</Text>
                  <TouchableOpacity style={commonStyles.ghostButton} onPress={handleCancelInstruction}>
                    <Text style={commonStyles.ghostButtonText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TextInput
                    style={styles.resultText}
                    value={result}
                    onChangeText={setResult}
                    multiline
                    textAlignVertical="top"
                  />
                  <TouchableOpacity style={styles.copyButton} onPress={handleCopy}>
                    <Text style={styles.copyButtonText}>{t('button.copy_text')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : null}

            <TouchableOpacity
              style={[commonStyles.ghostButton, styles.backButton]}
              onPress={() => navigation.goBack()}
            >
              <Text style={commonStyles.ghostButtonText}>{t('common.back')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  keyboardRoot: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  previewSection: {
    flexShrink: 1,
    minHeight: 180,
    maxHeight: 330,
    gap: spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.sizes.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  backButton: {
    paddingHorizontal: spacing.xxl,
  },
  previewCard: {
    flex: 1,
    minHeight: 170,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailList: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  thumbnailPosition: {
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    textAlign: 'right',
  },
  thumbnailButton: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surfaceElevated,
  },
  thumbnailButtonActive: {
    borderColor: colors.accent,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  controlsScroll: {
    flex: 1.45,
    minHeight: 280,
  },
  controlsContent: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  modelBox: {
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  modelBoxWarning: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerDim,
  },
  modelLabel: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
  },
  modelLabelWarning: {
    color: colors.danger,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  providerChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  providerChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  providerChipText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
  },
  providerChipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  instructions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  instructionButton: {
    flexGrow: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  instructionButtonDisabled: {
    opacity: 0.45,
  },
  instructionButtonText: {
    color: colors.textOnStrong,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
  },
  savedInstructionButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  savedInstructionButtonText: {
    color: colors.text,
  },
  customRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  customInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 112,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: typography.sizes.md,
  },
  executeButton: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  executeButtonText: {
    color: colors.textOnStrong,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
  },
  resultBox: {
    minHeight: 220,
    maxHeight: 420,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  resultLabel: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  resultText: {
    height: 160,
    color: colors.text,
    fontSize: typography.sizes.md,
    lineHeight: typography.lineHeights.md,
    minHeight: 96,
    padding: 0,
    textAlignVertical: 'top',
  },
  resultLoading: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  resultLoadingText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
  },
  copyButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyButtonText: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
  },
});
