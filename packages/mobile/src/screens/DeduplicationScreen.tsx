import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import { colors, typography, spacing, radius, commonStyles } from '../theme';
import {
  createPhotoTaskCheckpoint,
  getRemainingPhotoTaskDeletionIds,
  getSafeRejectedPhotoIds,
  preparePhotoTaskDeletion,
  recordPhotoTaskDeletionResult,
  resumePhotoTaskCheckpoint,
  usePhotoStore,
  type DuplicateGroup,
  type PhotoTaskBatch,
  type PhotoTaskCheckpoint,
} from '@photo-manager/shared';
import { useTranslation } from '@photo-manager/shared';
import { DedupeGroup } from '../components/DedupeGroup';
import {
  applyDeletedPhotosToStore,
  deletePhotosFromLibrary,
} from '../utils/deletePhotos';
import { getVerifiedDeletedPhotoIds } from '../utils/deleteVerification';
import {
  loadMobileAlbumSnapshot,
  removePhotosFromMobileAlbumSnapshots,
} from '../utils/photoAlbumRepository';
import { addDedupeSignaturesToPhotos } from '../utils/visualHash';
import { updateScannedAlbumCount } from '../utils/albumCounts';
import {
  deleteMobileTaskCheckpoint,
  loadMobileTaskCheckpoint,
  saveMobileTaskCheckpoint,
} from '../utils/taskCheckpointStorage';

type Props = NativeStackScreenProps<HomeStackParamList, 'Deduplication'>;

type Phase = 'setup' | 'loading' | 'results' | 'complete';
type BatchSizeOption = '50' | '100' | '200' | '500' | 'custom' | 'all';
const BATCH_SIZE_OPTIONS: BatchSizeOption[] = ['50', '100', '200', '500', 'custom', 'all'];

function getTaskBatch(option: BatchSizeOption, customValue: string, total: number): PhotoTaskBatch {
  if (option === 'all') return { mode: 'all' };
  const requested = option === 'custom'
    ? Number.parseInt(customValue, 10)
    : Number.parseInt(option, 10);
  return {
    mode: 'limited',
    limit: Number.isFinite(requested) && requested > 0
      ? Math.min(requested, total)
      : Math.min(100, total),
  };
}

function translateDedupeStatus(
  status: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (!status) return t('dedup.analyzeStatus');
  const [key, first, second] = status.split(':');
  if (key === 'dedup.status.analyzingTotal') {
    return t('dedup.status.analyzingTotal', { total: Number(first) || 0 });
  }
  if (key === 'dedup.status.analyzingProgress') {
    return t('dedup.status.analyzingProgress', {
      processed: Number(first) || 0,
      total: Number(second) || 0,
    });
  }
  if (key === 'dedup.status.found') {
    return t('dedup.status.found', { groups: Number(first) || 0 });
  }
  if (key === 'dedup.status.analyzing') return t('dedup.status.analyzing');
  if (key === 'dedup.status.finding') return t('dedup.status.finding');
  if (key === 'dedup.status.failed') return t('dedup.status.failed');
  if (key === 'dedup.status.cancelled') return t('dedup.status.cancelled');
  return status;
}

function getRejectedPhotos(group: DuplicateGroup) {
  const rejectedPhotoIds = new Set(getSafeRejectedPhotoIds(group));
  return group.photos.filter((photo) => rejectedPhotoIds.has(photo.id));
}

export function DeduplicationScreen({ route, navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { albumId } = route.params;
  const [phase, setPhase] = useState<Phase>('loading');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletedCount, setDeletedCount] = useState(0);
  const [batchSize, setBatchSize] = useState<BatchSizeOption>('100');
  const [customBatchSize, setCustomBatchSize] = useState('100');
  const [analysisBatch, setAnalysisBatch] = useState<PhotoTaskBatch | null>(null);
  const [signatureFailureCount, setSignatureFailureCount] = useState(0);
  const checkpointRef = useRef<PhotoTaskCheckpoint | null>(null);
  const cancelRequestedRef = useRef(false);

  const {
    photos,
    duplicateGroups,
    dedupeProgress,
    dedupeStatus,
    isLoading,
    error,
    runDeduplication,
    cancelDeduplication,
    toggleDuplicateSelection,
    clearPendingDeletion,
  } = usePhotoStore();

  useEffect(() => {
    let cancelled = false;
    const startDedup = async () => {
      cancelRequestedRef.current = false;
      setPhase('loading');
      setSignatureFailureCount(0);
      try {
        const snapshot = await loadMobileAlbumSnapshot(albumId, {
          onProgress: ({ loaded }) => {
            usePhotoStore.setState({
              dedupeProgress: Math.min(35, Math.max(3, Math.round(loaded / 50))),
              dedupeStatus: `dedup.status.analyzingTotal:${loaded}`,
            });
          },
          shouldCancel: () => cancelled,
        });

        if (cancelled) {
          return;
        }

        updateScannedAlbumCount(albumId, snapshot.count, snapshot.totalBytes);
        usePhotoStore.getState().loadPhotos(snapshot.photos);

        const storedCheckpoint = await loadMobileTaskCheckpoint('deduplication', albumId);
        const resumedCheckpoint = storedCheckpoint
          ? resumePhotoTaskCheckpoint(
            storedCheckpoint,
            snapshot.snapshotKey,
            snapshot.photos.map((photo) => photo.id),
          )
          : null;
        if (!resumedCheckpoint && !analysisBatch) {
          checkpointRef.current = null;
          setPhase('setup');
          return;
        }
        checkpointRef.current = resumedCheckpoint ?? createPhotoTaskCheckpoint({
          id: `deduplication:${albumId}:${Date.now()}`,
          kind: 'deduplication',
          albumId,
          snapshotKey: snapshot.snapshotKey,
          photoIds: snapshot.photos.map((photo) => photo.id),
          batch: analysisBatch ?? { mode: 'all' },
        });
        await saveMobileTaskCheckpoint(checkpointRef.current);

        const taskPhotoIds = new Set(checkpointRef.current.photoIds);
        const taskPhotos = snapshot.photos.filter((photo) => taskPhotoIds.has(photo.id));
        const photosWithHashes = await addDedupeSignaturesToPhotos(taskPhotos, {
          shouldCancel: () => cancelled || cancelRequestedRef.current,
          onProgress: (processed, total, _phase, failed) => {
            const ratio = total > 0 ? processed / total : 1;
            setSignatureFailureCount(failed);
            usePhotoStore.setState({
              dedupeProgress: Math.min(70, 35 + Math.round(ratio * 35)),
              dedupeStatus: `dedup.status.analyzingProgress:${processed}:${total}`,
            });
          },
        });
        const hashedById = new Map(photosWithHashes.map((photo) => [photo.id, photo]));
        usePhotoStore.getState().loadPhotos(
          snapshot.photos.map((photo) => hashedById.get(photo.id) ?? photo),
        );
      } catch (err) {
        if (cancelRequestedRef.current) {
          setPhase('results');
          return;
        }
        if (!cancelled) {
          usePhotoStore.getState().setError(
            err instanceof Error ? err.message : t('common.unknownError'),
          );
          setPhase('results');
        }
        return;
      }

      if (cancelRequestedRef.current || cancelled) {
        setPhase('results');
        return;
      }

      const activeTaskPhotoIds = checkpointRef.current?.photoIds;
      await runDeduplication(activeTaskPhotoIds ? { photoIds: activeTaskPhotoIds } : {});
      if (checkpointRef.current?.status === 'deleting') {
        const pendingIds = new Set(getRemainingPhotoTaskDeletionIds(checkpointRef.current));
        usePhotoStore.setState((state) => ({
          duplicateGroups: state.duplicateGroups.map((group) => ({
            ...group,
            rejectedPhotoIds: group.photos
              .filter((photo) => pendingIds.has(photo.id))
              .map((photo) => photo.id),
          })),
        }));
      }
      if (!cancelled) {
        setPhase('results');
      }
    };
    void startDedup();

    return () => {
      cancelled = true;
      cancelRequestedRef.current = true;
      cancelDeduplication();
    };
  }, [albumId, analysisBatch, cancelDeduplication, runDeduplication, t]);

  const handleStartAnalysis = useCallback(() => {
    setAnalysisBatch(getTaskBatch(batchSize, customBatchSize, photos.length));
  }, [batchSize, customBatchSize, photos.length]);

  const handleSwap = useCallback(
    (groupId: string, photoId: string) => {
      toggleDuplicateSelection(groupId, photoId);
    },
    [toggleDuplicateSelection],
  );

  const handleConfirmDelete = useCallback(() => {
    const toDelete = duplicateGroups.flatMap((group) => getRejectedPhotos(group));
    if (toDelete.length === 0 || isDeleting) {
      return;
    }

    Alert.alert(
      t('dedup.doneTitle'),
      t('dedup.confirmDelete', { count: toDelete.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dedup.toDelete', { count: toDelete.length }),
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              let checkpoint = checkpointRef.current;
              if (!checkpoint) {
                const snapshot = await loadMobileAlbumSnapshot(albumId);
                checkpoint = createPhotoTaskCheckpoint({
                  id: `deduplication:${albumId}:${Date.now()}`,
                  kind: 'deduplication',
                  albumId,
                  snapshotKey: snapshot.snapshotKey,
                  photoIds: snapshot.photos.map((photo) => photo.id),
                  batch: { mode: 'all' },
                });
              }
              checkpoint = preparePhotoTaskDeletion(checkpoint, toDelete.map((photo) => photo.id));
              checkpointRef.current = checkpoint;
              await saveMobileTaskCheckpoint(checkpoint);
              const remainingIds = new Set(getRemainingPhotoTaskDeletionIds(checkpoint));
              const pendingPhotos = toDelete.filter((photo) => remainingIds.has(photo.id));
              const result = await deletePhotosFromLibrary(pendingPhotos);
              let verifiedDeletedIds = new Set<string>();

              try {
                const reconciled = await loadMobileAlbumSnapshot(albumId, { force: true });
                verifiedDeletedIds = getVerifiedDeletedPhotoIds(result.deletedIds, reconciled.photos);
                const failedIds = pendingPhotos
                  .map((photo) => photo.id)
                  .filter((photoId) => !verifiedDeletedIds.has(photoId));
                if (checkpointRef.current) {
                  checkpointRef.current = recordPhotoTaskDeletionResult(checkpointRef.current, {
                    committedIds: [...verifiedDeletedIds],
                    failedIds,
                  });
                  await saveMobileTaskCheckpoint(checkpointRef.current);
                }
                if (failedIds.length > 0 && result.errors.length === 0) {
                  result.errors.push(t('culling.deleteFailed'));
                }
                updateScannedAlbumCount(albumId, reconciled.count, reconciled.totalBytes);
                usePhotoStore.getState().loadPhotos(reconciled.photos);
              } catch (reconcileError) {
                result.errors.push(
                  reconcileError instanceof Error ? reconcileError.message : t('common.unknownError'),
                );
              }

              const deletedPhotos = toDelete.filter((photo) => verifiedDeletedIds.has(photo.id));
              if (deletedPhotos.length > 0) {
                removePhotosFromMobileAlbumSnapshots(verifiedDeletedIds);
                applyDeletedPhotosToStore(deletedPhotos);
              }

              if (result.errors.length > 0) {
                Alert.alert(
                  t('common.error'),
                  result.errors.join('\n') || t('culling.deleteFailed'),
                );
              }

              if (checkpointRef.current?.status === 'completed') {
                await deleteMobileTaskCheckpoint('deduplication', albumId);
                checkpointRef.current = null;
              }

              setDeletedCount(deletedPhotos.length);
              setPhase(result.errors.length > 0 ? 'results' : 'complete');
            } catch (error) {
              Alert.alert(
                t('common.error'),
                error instanceof Error ? error.message : t('culling.deleteFailed'),
              );
              setPhase('results');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ],
    );
  }, [duplicateGroups, isDeleting, t]);

  const handleDone = useCallback(() => {
    clearPendingDeletion();
    navigation.goBack();
  }, [clearPendingDeletion, navigation]);

  const totalDuplicates = duplicateGroups.reduce(
    (sum, group) => sum + getRejectedPhotos(group).length,
    0,
  );

  if (error) {
    return (
      <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
        <View style={styles.centerContainer}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorTitle}>{t('dedup.analyzingTitle')}</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity
            style={[commonStyles.primaryButton, styles.retryButton]}
            onPress={async () => {
              setPhase('loading');
              try {
                const snapshot = await loadMobileAlbumSnapshot(albumId, { force: true });
                const taskIds = checkpointRef.current?.photoIds
                  ?? snapshot.photos.map((photo) => photo.id);
                const taskIdSet = new Set(taskIds);
                const taskPhotos = snapshot.photos.filter((photo) => taskIdSet.has(photo.id));
                const photosWithHashes = await addDedupeSignaturesToPhotos(taskPhotos);
                updateScannedAlbumCount(albumId, snapshot.count, snapshot.totalBytes);
                const hashedById = new Map(photosWithHashes.map((photo) => [photo.id, photo]));
                usePhotoStore.getState().loadPhotos(
                  snapshot.photos.map((photo) => hashedById.get(photo.id) ?? photo),
                );
                await runDeduplication({ photoIds: taskIds });
                if (!usePhotoStore.getState().error) {
                  setPhase('results');
                }
              } catch (err) {
                usePhotoStore.getState().setError(
                  err instanceof Error ? err.message : t('common.unknownError'),
                );
                setPhase('results');
              }
            }}
          >
          <Text style={commonStyles.primaryButtonText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'setup') {
    return (
      <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
        <View style={styles.centerContainer}>
          <Text style={styles.loadingTitle}>{t('dedup.analyzingTitle')}</Text>
          <Text style={styles.progressText}>{t('common.photoCount', { count: photos.length })}</Text>
          <View style={styles.batchSection}>
            <Text style={styles.batchLabel}>{t('culling.batchSize')}</Text>
            <View style={styles.batchOptions}>
              {BATCH_SIZE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.batchOption, batchSize === option && styles.batchOptionSelected]}
                  onPress={() => setBatchSize(option)}
                >
                  <Text style={[
                    styles.batchOptionText,
                    batchSize === option && styles.batchOptionTextSelected,
                  ]}>
                    {option === 'all'
                      ? t('culling.batchAll')
                      : option === 'custom'
                        ? t('culling.batchCustom')
                        : option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {batchSize === 'custom' ? (
              <TextInput
                style={styles.batchInput}
                value={customBatchSize}
                onChangeText={(value) => setCustomBatchSize(value.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="100"
                placeholderTextColor={colors.textTertiary}
                maxLength={5}
              />
            ) : null}
          </View>
          <TouchableOpacity
            style={[commonStyles.primaryButton, styles.retryButton]}
            onPress={handleStartAnalysis}
          >
            <Text style={commonStyles.primaryButtonText}>{t('dedup.startAnalysis')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[commonStyles.ghostButton, styles.retryButton]}
            onPress={() => navigation.goBack()}
          >
            <Text style={commonStyles.ghostButtonText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'loading') {
    return (
      <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingTitle}>
            {translateDedupeStatus(dedupeStatus, t)}
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${dedupeProgress}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>{dedupeProgress}%</Text>
          {signatureFailureCount > 0 ? (
            <Text style={styles.errorMessage}>
              {t('dedup.status.signatureFailures', { count: signatureFailureCount })}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[commonStyles.ghostButton, styles.retryButton]}
            onPress={() => {
              cancelRequestedRef.current = true;
              cancelDeduplication();
              setPhase('results');
            }}
          >
            <Text style={commonStyles.ghostButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'complete') {
    return (
      <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
        <View style={styles.centerContainer}>
          <Text style={styles.completeEmoji}>✅</Text>
          <Text style={styles.completeTitle}>{t('dedup.doneTitle')}</Text>
          <Text style={styles.completeSubtitle}>
            {t('dedup.deletedFromLibrary', { count: deletedCount })}
          </Text>
          <TouchableOpacity
            style={[commonStyles.primaryButton, styles.doneButton]}
            onPress={handleDone}
          >
            <Text style={commonStyles.primaryButtonText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Results phase
  return (
    <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
      <View style={styles.container}>
        {/* Summary */}
        <View style={styles.summaryCard}>
          {signatureFailureCount > 0 ? (
            <Text style={styles.errorMessage}>
              {t('dedup.status.signatureFailures', { count: signatureFailureCount })}
            </Text>
          ) : null}
          {duplicateGroups.length === 0 ? (
            <>
              <Text style={styles.summaryEmoji}>🎉</Text>
              <Text style={styles.summaryTitle}>{t('dedup.noGroups')}</Text>
            <Text style={styles.summarySubtitle}>
                {t('dedup.noGroupsSubtitle')}
            </Text>
            </>
          ) : (
            <>
              <Text style={styles.summaryTitle}>
                {t('dedup.groupsSummary', { groups: duplicateGroups.length, count: totalDuplicates })}
              </Text>
              <Text style={styles.summarySubtitle}>
                {t('dedup.toDelete', { count: totalDuplicates })}
              </Text>
            </>
          )}
        </View>

        {/* Duplicate Groups List */}
        {duplicateGroups.length > 0 && (
          <FlatList
            data={duplicateGroups}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <DedupeGroup group={item} onSwap={handleSwap} />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.groupSeparator} />}
          />
        )}

        {/* Bottom Action */}
        {duplicateGroups.length > 0 && (
          <View style={styles.bottomAction}>
            <TouchableOpacity
              style={commonStyles.dangerButton}
              onPress={handleConfirmDelete}
              disabled={isDeleting || totalDuplicates === 0}
            >
              <Text style={commonStyles.dangerButtonText}>
                {isDeleting
                  ? t('common.deleting')
                  : t('dedup.confirmDelete', { count: totalDuplicates })}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {duplicateGroups.length === 0 && (
          <View style={styles.bottomAction}>
            <TouchableOpacity
              style={commonStyles.primaryButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={commonStyles.primaryButtonText}>{t('common.back')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  loadingTitle: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  progressBar: {
    width: '80%',
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    marginTop: spacing.lg,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.full,
  },
  progressText: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  batchSection: {
    width: '100%',
    maxWidth: 360,
    marginVertical: spacing.lg,
  },
  batchLabel: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  batchOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  batchOption: {
    minWidth: 72,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
  },
  batchOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  batchOptionText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
  },
  batchOptionTextSelected: {
    color: colors.accent,
  },
  batchInput: {
    minHeight: 44,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: colors.surface,
    margin: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryEmoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  summaryTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  summarySubtitle: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  groupSeparator: {
    height: spacing.md,
  },
  bottomAction: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  errorMessage: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  retryButton: {
    paddingHorizontal: spacing.xxl,
  },
  completeEmoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  completeTitle: {
    fontSize: typography.sizes.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  completeSubtitle: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  doneButton: {
    paddingHorizontal: spacing.xxl,
  },
});
