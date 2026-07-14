import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import { colors, typography, spacing, radius, commonStyles } from '../theme';
import {
  createPhotoTaskCheckpoint,
  getRemainingPhotoTaskDeletionIds,
  preparePhotoTaskDeletion,
  recordPhotoTaskDecision,
  recordPhotoTaskDeletionResult,
  resumePhotoTaskCheckpoint,
  undoPhotoTaskDecision,
  useCullingStore,
  usePhotoStore,
  type PhotoTaskBatch,
  type PhotoTaskCheckpoint,
} from '@photo-manager/shared';
import { useTranslation } from '@photo-manager/shared';
import { SwipeablePhoto } from '../components/SwipeablePhoto';
import {
  applyDeletedPhotosToStore,
  deletePhotosFromLibrary,
} from '../utils/deletePhotos';
import { getVerifiedDeletedPhotoIds } from '../utils/deleteVerification';
import {
  loadMobileAlbumSnapshot,
  getCachedMobileAlbumSnapshot,
  removePhotosFromMobileAlbumSnapshots,
} from '../utils/photoAlbumRepository';
import { updateScannedAlbumCount } from '../utils/albumCounts';
import {
  deleteMobileTaskCheckpoint,
  loadMobileTaskCheckpoint,
  saveMobileTaskCheckpoint,
} from '../utils/taskCheckpointStorage';

type Props = NativeStackScreenProps<HomeStackParamList, 'Culling'>;

type Phase = 'intro' | 'swipe' | 'complete';
type BatchSizeOption = '50' | '100' | '200' | '500' | 'custom' | 'all';

const BATCH_SIZE_OPTIONS: BatchSizeOption[] = ['50', '100', '200', '500', 'custom', 'all'];

function resolveBatchLimit(option: BatchSizeOption, customValue: string, total: number): number {
  if (option === 'all') {
    return total;
  }
  if (option === 'custom') {
    const parsed = Number.parseInt(customValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, total) : Math.min(100, total);
  }
  return Math.min(Number.parseInt(option, 10), total);
}

function getTaskBatch(option: BatchSizeOption, customValue: string, total: number): PhotoTaskBatch {
  return option === 'all'
    ? { mode: 'all' }
    : { mode: 'limited', limit: resolveBatchLimit(option, customValue, total) };
}

export function CullingScreen({ route, navigation }: Props): React.JSX.Element | null {
  const { t } = useTranslation();
  const { albumId } = route.params;
  const [phase, setPhase] = useState<Phase>('intro');
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasAppliedDeletion, setHasAppliedDeletion] = useState(false);
  const [deletedCount, setDeletedCount] = useState(0);
  const [isScanning, setIsScanning] = useState(true);
  const [scanCount, setScanCount] = useState(0);
  const [scanError, setScanError] = useState('');
  const [batchSize, setBatchSize] = useState<BatchSizeOption>('100');
  const [customBatchSize, setCustomBatchSize] = useState('100');
  const skipNextBackPromptRef = useRef(false);
  const checkpointRef = useRef<PhotoTaskCheckpoint | null>(null);
  const checkpointSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const { photos } = usePhotoStore();
  const {
    items,
    currentIndex,
    isComplete,
    history,
    decide,
    undoLast,
    getKeptPhotos,
    getDeletedPhotos,
    reset,
  } = useCullingStore();

  const currentItem = items[currentIndex];

  const queueCheckpointSave = useCallback((checkpoint: PhotoTaskCheckpoint) => {
    checkpointRef.current = checkpoint;
    checkpointSaveQueueRef.current = checkpointSaveQueueRef.current
      .catch(() => undefined)
      .then(() => saveMobileTaskCheckpoint(checkpoint));
  }, []);

  useEffect(() => {
    reset();
  }, [reset]);

  useEffect(() => {
    let cancelled = false;

    const scan = async () => {
      setIsScanning(true);
      setScanError('');
      try {
        const snapshot = await loadMobileAlbumSnapshot(albumId, {
          onProgress: ({ loaded }) => {
            if (!cancelled) {
              setScanCount(loaded);
            }
          },
          shouldCancel: () => cancelled,
        });

        if (!cancelled) {
          updateScannedAlbumCount(albumId, snapshot.count, snapshot.totalBytes);
          usePhotoStore.getState().loadPhotos(snapshot.photos);
          const stored = await loadMobileTaskCheckpoint('culling', albumId);
          const resumed = stored
            ? resumePhotoTaskCheckpoint(
              stored,
              snapshot.snapshotKey,
              snapshot.photos.map((photo) => photo.id),
            )
            : null;
          if (cancelled) {
            return;
          }
          if (resumed && resumed.status !== 'completed') {
            const photoById = new Map(snapshot.photos.map((photo) => [photo.id, photo]));
            const cullingItems = resumed.photoIds.flatMap((photoId) => {
              const photo = photoById.get(photoId);
              return photo ? [{
                photo,
                decision: resumed.decisions[photoId] ?? 'pending',
                aiDecision: 'pending' as const,
              }] : [];
            });
            checkpointRef.current = resumed;
            useCullingStore.setState({
              items: cullingItems,
              allItems: cullingItems,
              currentIndex: Math.min(resumed.currentIndex, Math.max(0, cullingItems.length - 1)),
              isProcessing: false,
              isComplete: cullingItems.every((item) => item.decision !== 'pending'),
              error: null,
              history: [],
              aiStats: {
                autoKept: 0,
                autoDeleted: 0,
                uncertainCount: cullingItems.filter((item) => item.decision === 'pending').length,
              },
            });
            setPhase(cullingItems.every((item) => item.decision !== 'pending') ? 'complete' : 'swipe');
          } else if (stored?.status === 'completed') {
            await deleteMobileTaskCheckpoint('culling', albumId);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setScanError(err instanceof Error ? err.message : t('common.unknownError'));
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

  const handleStart = useCallback(() => {
    if (isScanning || scanError) {
      return;
    }

    const batchLimit = resolveBatchLimit(batchSize, customBatchSize, photos.length);
    const cullingItems = photos.slice(0, batchLimit).map((photo) => ({
      photo,
      decision: 'pending' as const,
      aiDecision: 'pending' as const,
    }));

    useCullingStore.setState({
      items: cullingItems,
      allItems: cullingItems,
      currentIndex: 0,
      isProcessing: false,
      isComplete: cullingItems.length === 0,
      error: null,
      history: [],
      aiStats: { autoKept: 0, autoDeleted: 0, uncertainCount: cullingItems.length },
    });

    const snapshot = getCachedMobileAlbumSnapshot(albumId);
    if (snapshot) {
      const checkpoint = createPhotoTaskCheckpoint({
        id: `culling:${albumId}:${Date.now()}`,
        kind: 'culling',
        albumId,
        snapshotKey: snapshot.snapshotKey,
        photoIds: snapshot.photos.map((photo) => photo.id),
        batch: getTaskBatch(batchSize, customBatchSize, photos.length),
      });
      queueCheckpointSave(checkpoint);
    }

    setPhase(cullingItems.length === 0 ? 'complete' : 'swipe');
  }, [albumId, batchSize, customBatchSize, isScanning, photos, queueCheckpointSave, scanError]);

  const deleteMarkedPhotos = useCallback(async () => {
    const toDelete = getDeletedPhotos();
    if (toDelete.length === 0 || isDeleting || hasAppliedDeletion) {
      return true;
    }

    setIsDeleting(true);
    try {
      let checkpoint = checkpointRef.current;
      if (checkpoint) {
        checkpoint = preparePhotoTaskDeletion(checkpoint, toDelete.map((photo) => photo.id));
        await saveMobileTaskCheckpoint(checkpoint);
        checkpointRef.current = checkpoint;
      }
      const remainingIds = checkpoint
        ? new Set(getRemainingPhotoTaskDeletionIds(checkpoint))
        : new Set(toDelete.map((photo) => photo.id));
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
        setDeletedCount(deletedPhotos.length);
      }

      if (result.errors.length > 0) {
        Alert.alert(
          t('common.error'),
          result.errors.join('\n') || t('culling.deleteFailed'),
        );
      }

      const deletionComplete = pendingPhotos.length === verifiedDeletedIds.size;
      setHasAppliedDeletion(deletionComplete);
      if (checkpointRef.current?.status === 'completed') {
        await deleteMobileTaskCheckpoint('culling', albumId);
        checkpointRef.current = null;
      }
      return deletionComplete && result.errors.length === 0;
    } catch (err) {
      Alert.alert(
        t('common.error'),
        err instanceof Error ? err.message : t('culling.deleteFailed'),
      );
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [albumId, getDeletedPhotos, hasAppliedDeletion, isDeleting, t]);

  const handleApplyDeletion = useCallback(async () => {
    const toDelete = getDeletedPhotos();
    if (toDelete.length === 0 || isDeleting || hasAppliedDeletion) {
      navigation.goBack();
      return;
    }

    Alert.alert(
      t('culling.confirmTrash', { count: toDelete.length }),
      t('culling.confirmBatchDelete', { count: toDelete.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteMarkedPhotos();
          },
        },
      ],
    );
  }, [deleteMarkedPhotos, getDeletedPhotos, hasAppliedDeletion, isDeleting, navigation, t]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      const pendingDeleteCount = getDeletedPhotos().length;
      if (
        pendingDeleteCount === 0
        || hasAppliedDeletion
        || skipNextBackPromptRef.current
      ) {
        skipNextBackPromptRef.current = false;
        return;
      }

      event.preventDefault();
      Alert.alert(
        t('culling.exitPendingTitle'),
        t('culling.exitPendingBody', { count: pendingDeleteCount }),
        [
          { text: t('culling.continueCulling'), style: 'cancel' },
          {
            text: t('culling.exitWithoutDeleting'),
            style: 'destructive',
            onPress: () => {
              skipNextBackPromptRef.current = true;
              navigation.dispatch(event.data.action);
            },
          },
          {
            text: t('culling.deleteAndExit'),
            onPress: async () => {
              const success = await deleteMarkedPhotos();
              if (success) {
                skipNextBackPromptRef.current = true;
                navigation.dispatch(event.data.action);
              }
            },
          },
        ],
      );
    });

    return unsubscribe;
  }, [deleteMarkedPhotos, getDeletedPhotos, hasAppliedDeletion, navigation, t]);

  const handleKeep = useCallback(() => {
    if (!currentItem) return;
    if (checkpointRef.current) {
      queueCheckpointSave(recordPhotoTaskDecision(checkpointRef.current, currentItem.photo.id, 'keep'));
    }
    decide(currentItem.photo.id, 'keep');
    if (isComplete || currentIndex >= items.length - 1) {
      setPhase('complete');
    }
  }, [currentItem, decide, isComplete, currentIndex, items.length, queueCheckpointSave]);

  const handleDelete = useCallback(() => {
    if (!currentItem) return;
    if (checkpointRef.current) {
      queueCheckpointSave(recordPhotoTaskDecision(checkpointRef.current, currentItem.photo.id, 'delete'));
    }
    decide(currentItem.photo.id, 'delete');
    if (isComplete || currentIndex >= items.length - 1) {
      setPhase('complete');
    }
  }, [currentItem, decide, isComplete, currentIndex, items.length, queueCheckpointSave]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    if (checkpointRef.current && previous) {
      queueCheckpointSave(undoPhotoTaskDecision(checkpointRef.current, previous.photoId));
    }
    undoLast();
    if (phase === 'complete') setPhase('swipe');
  }, [history, phase, queueCheckpointSave, undoLast]);

  useEffect(() => {
    if (isComplete && phase === 'swipe') {
      setPhase('complete');
    }
  }, [isComplete, phase]);

  // Intro Phase
  if (phase === 'intro') {
    return (
      <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
        <View style={styles.centerContainer}>
          <Text style={styles.introEmoji}>✂️</Text>
          <Text style={styles.introTitle}>{t('culling.manualTitle')}</Text>
          <Text style={styles.introDescription}>
            {t('culling.manualDescription')}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{isScanning ? scanCount : photos.length}</Text>
              <Text style={styles.statLabel}>
                {t('common.photoCount', { count: isScanning ? scanCount : photos.length })}
              </Text>
            </View>
          </View>
          {isScanning ? (
            <ActivityIndicator color={colors.accent} size="small" style={styles.scanIndicator} />
          ) : null}
          {scanError ? <Text style={styles.scanError}>{scanError}</Text> : null}
          <View style={styles.batchSection}>
            <Text style={styles.batchLabel}>{t('culling.batchSize')}</Text>
            <View style={styles.batchOptions}>
              {BATCH_SIZE_OPTIONS.map((option) => {
                const isSelected = batchSize === option;
                const label = option === 'all'
                  ? t('culling.batchAll')
                  : option === 'custom'
                    ? t('culling.batchCustom')
                    : option;

                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.batchOption, isSelected && styles.batchOptionSelected]}
                    onPress={() => setBatchSize(option)}
                    activeOpacity={0.78}
                  >
                    <Text style={[
                      styles.batchOptionText,
                      isSelected && styles.batchOptionTextSelected,
                    ]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
            style={[
              commonStyles.primaryButton,
              styles.startButton,
              (isScanning || Boolean(scanError)) && styles.disabledButton,
            ]}
            onPress={handleStart}
            disabled={isScanning || Boolean(scanError)}
          >
            <Text style={commonStyles.primaryButtonText}>
              {isScanning ? t('home.loadingShort') : t('culling.startCulling')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Complete Phase
  if (phase === 'complete') {
    const kept = getKeptPhotos();
    const deleted = getDeletedPhotos();

    return (
      <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
        <View style={styles.centerContainer}>
          <Text style={styles.completeEmoji}>🎉</Text>
          <Text style={styles.completeTitle}>{t('culling.completeTitle')}</Text>

          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { borderColor: colors.success + '60' }]}>
              <Text style={[styles.statCardNumber, { color: colors.success }]}>
                {kept.length}
              </Text>
              <Text style={styles.statCardLabel}>{t('culling.kept')}</Text>
            </View>
            <View style={[styles.statCard, { borderColor: colors.danger + '60' }]}>
              <Text style={[styles.statCardNumber, { color: colors.danger }]}>
                {deleted.length}
              </Text>
              <Text style={styles.statCardLabel}>{t('culling.deleted')}</Text>
            </View>
          </View>

          <Text style={styles.statsDetail}>
            {t('culling.reviewSummary', { reviewed: kept.length + deleted.length })}
          </Text>

          {hasAppliedDeletion && (
            <Text style={styles.deletedStatus}>
              {t('culling.deletedFromLibrary', { count: deletedCount })}
            </Text>
          )}

          {history.length > 0 && (
            <TouchableOpacity style={commonStyles.ghostButton} onPress={handleUndo}>
              <Text style={commonStyles.ghostButtonText}>{t('common.undo')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              deleted.length > 0 && !hasAppliedDeletion
                ? commonStyles.dangerButton
                : commonStyles.primaryButton,
              styles.finishButton,
              isDeleting && styles.disabledButton,
            ]}
            onPress={deleted.length > 0 && !hasAppliedDeletion ? handleApplyDeletion : () => navigation.goBack()}
            disabled={isDeleting}
          >
            <Text
              style={
                deleted.length > 0 && !hasAppliedDeletion
                  ? commonStyles.dangerButtonText
                  : commonStyles.primaryButtonText
              }
            >
              {isDeleting
                ? t('common.deleting')
                : deleted.length > 0 && !hasAppliedDeletion
                  ? t('culling.confirmTrash', { count: deleted.length })
                  : t('common.done')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Swipe Phase
  if (!currentItem) return null;

  const pendingCount = items.filter((i) => i.decision === 'pending').length;
  const totalDecided = items.length - pendingCount;

  return (
    <View style={styles.swipeContainer}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity
          style={styles.undoButton}
          onPress={handleUndo}
          disabled={history.length === 0}
        >
          <Text style={[styles.undoText, history.length === 0 && styles.undoDisabled]}>
            ↩ {t('common.undo')}
          </Text>
        </TouchableOpacity>

        <Text style={styles.progressText}>
          {t('culling.progress', { current: totalDecided, total: items.length })}
        </Text>

        <View style={styles.headerRight} />
      </SafeAreaView>

      {/* Photo */}
      {currentItem ? (
        <SwipeablePhoto
          photo={currentItem.photo}
        />
      ) : (
        <View style={styles.noPhotoContainer}>
          <Text style={styles.noPhotoText}>{t('common.notSet')}</Text>
        </View>
      )}

      {/* Bottom Buttons */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={handleDelete}
        >
          <Text style={styles.actionButtonText}>✕ {t('culling.deleteHint')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.keepButton]}
          onPress={handleKeep}
        >
          <Text style={styles.keepButtonText}>✓ {t('culling.keepHint')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  swipeContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  undoButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: radius.full,
    minWidth: 80,
  },
  undoText: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: '500',
    textAlign: 'center',
  },
  undoDisabled: {
    opacity: 0.3,
  },
  progressText: {
    color: colors.text,
    fontSize: typography.sizes.md,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  headerRight: {
    width: 80,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.8)',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    backgroundColor: colors.dangerDim,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  keepButton: {
    backgroundColor: colors.successDim,
    borderWidth: 1,
    borderColor: colors.success,
  },
  actionButtonText: {
    color: colors.danger,
    fontSize: typography.sizes.lg,
    fontWeight: '700',
  },
  keepButtonText: {
    color: colors.success,
    fontSize: typography.sizes.lg,
    fontWeight: '700',
  },
  noPhotoContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noPhotoText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.lg,
  },
  introEmoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  introTitle: {
    fontSize: typography.sizes.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  introDescription: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: typography.sizes.xxl,
    fontWeight: '700',
    color: colors.accent,
  },
  statLabel: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  startButton: {
    paddingHorizontal: spacing.xxl,
  },
  scanIndicator: {
    marginBottom: spacing.md,
  },
  scanError: {
    color: colors.danger,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  batchSection: {
    width: '100%',
    maxWidth: 360,
    marginBottom: spacing.lg,
  },
  batchLabel: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  batchOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  batchOption: {
    minWidth: 56,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  batchOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  batchOptionText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
  },
  batchOptionTextSelected: {
    color: colors.accent,
  },
  batchInput: {
    minHeight: 42,
    marginTop: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: typography.sizes.md,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  completeEmoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  completeTitle: {
    fontSize: typography.sizes.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
  },
  statCardNumber: {
    fontSize: typography.sizes.xxl,
    fontWeight: '700',
  },
  statCardLabel: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statsDetail: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  deletedStatus: {
    color: colors.success,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  finishButton: {
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.lg,
  },
  disabledButton: {
    opacity: 0.6,
  },
});
