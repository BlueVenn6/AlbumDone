import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { colors, typography, spacing, radius } from '../theme';
import type { DuplicateGroup, Photo, PhotoTaskBatch, PhotoTaskCheckpoint } from '@photo-manager/shared';
import {
  createAlbumSnapshot,
  createPhotoTaskCheckpoint,
  getRemainingPhotoTaskDeletionIds,
  getSafeRejectedPhotoIds,
  localFileUriToPath,
  preparePhotoTaskDeletion,
  recordPhotoTaskDeletionResult,
  resumePhotoTaskCheckpoint,
  selectDedupeSignatureCandidates,
  usePhotoStore,
  useTranslation,
} from '@photo-manager/shared';
import { captureDedupeReview, createDedupeAlbumProgress, getDedupeTaskRecovery, loadDedupeAlbumProgress, restoreDedupeReview, saveDedupeAlbumProgress, type DedupeAlbumProgress } from '../utils/dedupeProgressStorage';
import { useLoadPhotos } from '../hooks/useLoadPhotos';
import { usePhotoThumbnail } from '../hooks/usePhotoThumbnail';
import { updateAlbumCountAfterLocalDelete } from '../utils/albumCountCache';
import { setCachedAlbumPhotos, updateCachedAlbumPhotosAfterDelete } from '../utils/photoSessionCache';
import { deletePhotosFromDisk } from '../utils/deletePhotos';
import {
  deleteDesktopTaskCheckpoint,
  loadDesktopTaskCheckpoint,
  saveDesktopTaskCheckpoint,
} from '../utils/taskCheckpointStorage';

type Phase = 'setup' | 'analyzing' | 'results' | 'confirming' | 'done';
type RefinementPhase = 'idle' | 'running';
type BatchSizeOption = '50' | '100' | '200' | '500' | 'custom' | 'all';
type SignatureProgress = {
  stage: 'content' | 'visual';
  processed: number;
  total: number;
  failed: number;
  overallProcessed: number;
  overallTotal: number;
};
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

function translateDedupeReason(
  group: DuplicateGroup,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (group.reason === 'possible-duplicate') {
    return t('dedup.reasons.possibleDuplicate');
  }
  if (group.reason === 'highly-similar') {
    return t('dedup.reasons.highlySimilar');
  }
  if (group.reason === 'largest-file') {
    return t('dedup.reasons.largestFile');
  }
  if (group.reason === 'metadata-best') {
    return t('dedup.reasons.metadataBest');
  }
  if (group.reason === 'manual-selection') {
    return t('dedup.reasons.manualSelection');
  }
  return group.reason;
}

function getRejectedPhotoIds(group: DuplicateGroup): string[] {
  return getSafeRejectedPhotoIds(group);
}

const VISUAL_HASH_BATCH_SIZE = 256;

function normalizeVisualHashPath(filePath: string): string {
  return filePath.replace(/\//g, '\\').toLowerCase();
}

function getDesktopPhotoPath(photo: Photo): string | null {
  if (photo.path) {
    return photo.path;
  }
  try {
    return localFileUriToPath(photo.uri);
  } catch {
    return null;
  }
}

async function addDedupeSignaturesToCandidatePhotos(
  photosToHash: Photo[],
  options: {
    isCancelled?: () => boolean;
    onProgress?: (progress: SignatureProgress) => void;
  } = {},
): Promise<void | false> {
  if (
    !window.electronAPI?.fs.computeContentHashes
    || !window.electronAPI.fs.computeVisualHashes
  ) {
    throw new Error('Photo signature service is unavailable.');
  }
  if (photosToHash.length === 0) {
    return;
  }

  const signatureCandidates = selectDedupeSignatureCandidates(photosToHash);
  const contentPathByPhotoId = new Map<string, string>();
  for (const photo of signatureCandidates.content) {
    const filePath = getDesktopPhotoPath(photo);
    if (filePath) {
      contentPathByPhotoId.set(photo.id, filePath);
    }
  }

  const visualPathByPhotoId = new Map<string, string>();
  for (const photo of signatureCandidates.visual) {
    const filePath = getDesktopPhotoPath(photo);
    if (filePath) {
      visualPathByPhotoId.set(photo.id, filePath);
    }
  }

  if (contentPathByPhotoId.size === 0 && visualPathByPhotoId.size === 0) {
    return;
  }

  const contentPaths = [...new Set(contentPathByPhotoId.values())];
  const visualPaths = [...new Set(visualPathByPhotoId.values())];
  const contentHashes: Record<string, string> = {};
  const visualHashes: Record<string, string> = {};
  const contentFailedPaths = new Set<string>();
  const visualFailedPaths = new Set<string>();
  const overallTotal = contentPaths.length + visualPaths.length;
  if (contentPaths.length > 0) {
    options.onProgress?.({
      stage: 'content',
      processed: 0,
      total: contentPaths.length,
      failed: 0,
      overallProcessed: 0,
      overallTotal,
    });
  }

  for (let index = 0; index < contentPaths.length; index += VISUAL_HASH_BATCH_SIZE) {
    if (options.isCancelled?.()) {
      await window.electronAPI.fs.cancelVisualHashes?.().catch(() => null);
      return false;
    }
    const batch = contentPaths.slice(index, index + VISUAL_HASH_BATCH_SIZE);
    const result = await window.electronAPI.fs.computeContentHashes(batch);
    Object.assign(contentHashes, result.hashes);
    const completedPaths = new Set(
      Object.keys(result.hashes).map((filePath) => normalizeVisualHashPath(filePath)),
    );
    batch.forEach((filePath) => {
      if (!completedPaths.has(normalizeVisualHashPath(filePath))) contentFailedPaths.add(filePath);
    });
    const processed = Math.min(index + batch.length, contentPaths.length);
    options.onProgress?.({
      stage: 'content',
      processed,
      total: contentPaths.length,
      failed: contentFailedPaths.size,
      overallProcessed: processed,
      overallTotal,
    });
  }

  if (visualPaths.length > 0) {
    options.onProgress?.({
      stage: 'visual',
      processed: 0,
      total: visualPaths.length,
      failed: 0,
      overallProcessed: contentPaths.length,
      overallTotal,
    });
  }
  for (let index = 0; index < visualPaths.length; index += VISUAL_HASH_BATCH_SIZE) {
    if (options.isCancelled?.()) {
      await window.electronAPI.fs.cancelVisualHashes?.().catch(() => null);
      return false;
    }
    const batch = visualPaths.slice(index, index + VISUAL_HASH_BATCH_SIZE);
    const result = await window.electronAPI.fs.computeVisualHashes(batch);
    Object.assign(visualHashes, result.hashes);
    const completedPaths = new Set(
      Object.keys(result.hashes).map((filePath) => normalizeVisualHashPath(filePath)),
    );
    batch.forEach((filePath) => {
      if (!completedPaths.has(normalizeVisualHashPath(filePath))) visualFailedPaths.add(filePath);
    });
    const processed = Math.min(index + batch.length, visualPaths.length);
    options.onProgress?.({
      stage: 'visual',
      processed,
      total: visualPaths.length,
      failed: visualFailedPaths.size,
      overallProcessed: contentPaths.length + processed,
      overallTotal,
    });
  }

  const contentHashByNormalizedPath = new Map(
    Object.entries(contentHashes).map(([filePath, hash]) => [
      normalizeVisualHashPath(filePath),
      hash,
    ]),
  );
  const visualHashByNormalizedPath = new Map(
    Object.entries(visualHashes).map(([filePath, hash]) => [
      normalizeVisualHashPath(filePath),
      hash,
    ]),
  );
  const photos = usePhotoStore.getState().photos.map((photo) => {
    const contentPath = contentPathByPhotoId.get(photo.id);
    const visualPath = visualPathByPhotoId.get(photo.id);
    const contentHash = contentPath
      ? contentHashByNormalizedPath.get(normalizeVisualHashPath(contentPath))
      : undefined;
    const visualHash = visualPath
      ? visualHashByNormalizedPath.get(normalizeVisualHashPath(visualPath))
      : undefined;
    return contentHash || visualHash
      ? { ...photo, ...(contentHash ? { contentHash } : {}), ...(visualHash ? { visualHash } : {}) }
      : photo;
  });

  usePhotoStore.setState({ photos });
  const usableVisualHashCount = photos.filter((photo) => photo.visualHash?.startsWith('v2:')).length;
  if (visualPaths.length > 0 && usableVisualHashCount === 0) {
    throw new Error('Visual signatures could not be generated for this analysis.');
  }
}

export function DeduplicationScreen(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { albumId } = (location.state as { albumId: string; albumTitle: string }) ?? {};

  const {
    photos,
    duplicateGroups,
    dedupeProgress,
    dedupeStatus,
    runDeduplication,
    cancelDeduplication,
    toggleDuplicateSelection,
    keepOnlyDuplicate,
    keepAllDuplicates,
    removePhotosById,
  } = usePhotoStore();

  const [phase, setPhase] = useState<Phase>('analyzing');
  const [refinementPhase, setRefinementPhase] = useState<RefinementPhase>('idle');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [deletedCount, setDeletedCount] = useState(0);
  const [deleteFailure, setDeleteFailure] = useState<{ deleted: number; errors: string[] } | null>(null);
  const [hashProgress, setHashProgress] = useState<SignatureProgress | null>(null);
  const [signatureFailureCount, setSignatureFailureCount] = useState(0);
  const [analysisFailure, setAnalysisFailure] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState<BatchSizeOption>('100');
  const [customBatchSize, setCustomBatchSize] = useState('100');
  const [analysisBatch, setAnalysisBatch] = useState<PhotoTaskBatch | null>(null);
  const [checkedCount, setCheckedCount] = useState(0);
  const [recoveryKind, setRecoveryKind] = useState<'scan' | 'review' | null>(null);
  const analysisModeRef = useRef<'continue' | 'restart' | 'resume'>('continue');
  const albumProgressRef = useRef(createDedupeAlbumProgress(albumId));
  const progressWriteRef = useRef<Promise<void>>(Promise.resolve());
  const persistProgress = useCallback((progress: DedupeAlbumProgress) => {
    albumProgressRef.current = progress;
    const pending = progressWriteRef.current.then(() => saveDedupeAlbumProgress(progress));
    progressWriteRef.current = pending;
    return pending;
  }, []);
  const saveReview = useCallback(() => {
    if (!checkpointRef.current) return;
    void persistProgress({ ...albumProgressRef.current,
      review: captureDedupeReview(checkpointRef.current.id, usePhotoStore.getState().duplicateGroups, true),
    }).catch((error: unknown) => setAnalysisFailure(error instanceof Error ? error.message : t('common.progressSaveFailed')));
  }, [persistProgress, t]);
  const [selectedTaskCount, setSelectedTaskCount] = useState(0);
  const cancelRequestedRef = useRef(false);
  const checkpointRef = useRef<PhotoTaskCheckpoint | null>(null);

  const {
    loading: photosLoading,
    error: photosError,
    loadedCount: loadedPhotoCount,
  } = useLoadPhotos(albumId);

  useEffect(() => {
    if (!albumId) {
      navigate('/', { replace: true });
      return;
    }
    if (photosLoading || photosError) return;
    let cancelled = false;
    cancelRequestedRef.current = false;
    setHashProgress(null);
    setSignatureFailureCount(0);
    setAnalysisFailure(null);

    const run = async () => {
      setPhase('analyzing');
      let analysisStarted = false;
      let runFailed = false;
      try {
        const initialPhotos = usePhotoStore.getState().photos;
        const initialSnapshot = createAlbumSnapshot(albumId, initialPhotos);
        if (!analysisBatch) {
          await progressWriteRef.current;
          const progress = await loadDedupeAlbumProgress(albumId, initialSnapshot.photos.map((photo) => photo.id));
          const stored = await loadDesktopTaskCheckpoint('deduplication', albumId);
          if (cancelled) return;
          albumProgressRef.current = progress;
          checkpointRef.current = stored ? resumePhotoTaskCheckpoint(stored, initialSnapshot.snapshotKey,
            initialSnapshot.photos.map((photo) => photo.id)) : null;
          setCheckedCount(progress.checkedPhotoIds.length);
          setRecoveryKind(getDedupeTaskRecovery(checkpointRef.current, progress).kind);
          setPhase('setup');
          return;
        }
        await progressWriteRef.current;
        const mode = analysisModeRef.current;
        const progress = mode === 'restart' ? createDedupeAlbumProgress(albumId) : albumProgressRef.current;
        const checked = new Set(progress.checkedPhotoIds);
        const storedCheckpoint = await loadDesktopTaskCheckpoint('deduplication', albumId);
        const resumedCheckpoint = storedCheckpoint
          ? resumePhotoTaskCheckpoint(
            storedCheckpoint,
            initialSnapshot.snapshotKey,
            initialSnapshot.photos.map((photo) => photo.id),
          )
          : null;
        checkpointRef.current = mode === 'resume' ? resumedCheckpoint : createPhotoTaskCheckpoint({
          id: `deduplication:${albumId}:${Date.now()}`,
          kind: 'deduplication', albumId, snapshotKey: initialSnapshot.snapshotKey,
          photoIds: initialSnapshot.photos.filter((photo) => mode === 'restart' || !checked.has(photo.id)).map((photo) => photo.id),
          batch: analysisBatch,
        });
        if (!checkpointRef.current || checkpointRef.current.photoIds.length === 0) {
          setAnalysisBatch(null);
          setPhase('setup');
          return;
        }
        if (mode !== 'resume') await persistProgress({ ...progress, scanTaskId: checkpointRef.current.id, review: null });
        if (cancelled) return;
        setSelectedTaskCount(checkpointRef.current.photoIds.length);
        analysisStarted = true;
        await saveDesktopTaskCheckpoint(checkpointRef.current);
        const taskPhotoIds = new Set(checkpointRef.current.photoIds);
        const taskPhotos = initialSnapshot.photos.filter((photo) => taskPhotoIds.has(photo.id));
        setRefinementPhase('running');
        let contentFailures = 0;
        let signatureFailures = 0;
        await addDedupeSignaturesToCandidatePhotos(taskPhotos, {
          isCancelled: () => cancelled || cancelRequestedRef.current,
          onProgress: (progress) => {
            setHashProgress(progress);
            if (progress.stage === 'content') contentFailures = progress.failed;
            signatureFailures = contentFailures + (progress.stage === 'visual' ? progress.failed : 0);
            setSignatureFailureCount(signatureFailures);
          },
        });
        if (cancelRequestedRef.current) {
          setRefinementPhase('idle');
          setHashProgress(null);
          return;
        }
        if (cancelled) {
          return;
        }
        setRefinementPhase('idle');
        setHashProgress(null);
        await runDeduplication({ photoIds: checkpointRef.current.photoIds, initialSelection: 'keep-best' });
        if (cancelled || cancelRequestedRef.current) return;
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
        const checkpoint = checkpointRef.current;
        const savedReview = progress.review;
        if (savedReview?.taskId === checkpoint.id && (checkpoint.status !== 'deleting' || savedReview.manual)) {
          usePhotoStore.setState((state) => ({ duplicateGroups: restoreDedupeReview(state.duplicateGroups, savedReview) }));
        }
        if (!usePhotoStore.getState().error && signatureFailures === 0) {
          const groups = usePhotoStore.getState().duplicateGroups;
          await persistProgress({ ...progress, scanTaskId: null,
            checkedPhotoIds: [...new Set([...progress.checkedPhotoIds, ...checkpoint.photoIds])],
            review: groups.length > 0 ? captureDedupeReview(checkpoint.id, groups, savedReview?.manual) : null,
          });
          if (cancelled) return;
          setCheckedCount(albumProgressRef.current.checkedPhotoIds.length);
          if (groups.length === 0 && checkpoint.status !== 'deleting') {
            await deleteDesktopTaskCheckpoint('deduplication', albumId);
            checkpointRef.current = null;
          }
        }
        setRecoveryKind(getDedupeTaskRecovery(checkpointRef.current, albumProgressRef.current).kind);
      } catch (err) {
        if (!cancelled && !cancelRequestedRef.current) {
          runFailed = true;
          setAnalysisFailure(err instanceof Error ? err.message : 'Photo analysis failed.');
          setRefinementPhase('idle');
          setHashProgress(null);
        }
      } finally {
        if (cancelled || !analysisStarted) {
          return;
        }
        if (runFailed) {
          setPhase('analyzing');
          return;
        }
        if (cancelRequestedRef.current) {
          setRefinementPhase('idle');
          setHashProgress(null);
          setAnalysisBatch(null);
          setPhase('setup');
          return;
        }
        const { duplicateGroups: groups } = usePhotoStore.getState();
        setExpandedGroups(new Set(groups.map((group) => group.id)));
        setPhase('results');
      }
    };
    void run();

    return () => {
      cancelled = true;
      cancelRequestedRef.current = true;
      void window.electronAPI?.fs.cancelVisualHashes?.().catch(() => null);
    };
  }, [albumId, analysisBatch, persistProgress, photosError, photosLoading, runDeduplication]);

  const handleStartAnalysis = useCallback((mode: 'continue' | 'restart' | 'resume' = 'continue') => {
    if (mode !== 'resume' && getDedupeTaskRecovery(checkpointRef.current, albumProgressRef.current).hasPendingDeletion
      && !window.confirm(t('dedup.replaceTaskBody'))) return;
    analysisModeRef.current = mode;
    setAnalysisBatch(getTaskBatch(batchSize, customBatchSize, photos.length));
  }, [batchSize, customBatchSize, photos.length, t]);

  const returnToSetup = useCallback(() => {
    setAnalysisBatch(null);
    setPhase('setup');
  }, []);

  const totalToDelete = Math.max(
    0,
    duplicateGroups.reduce((sum, group) => sum + getRejectedPhotoIds(group).length, 0),
  );

  const handleConfirm = useCallback(async (permanent = false) => {
    if (phase === 'confirming' || totalToDelete === 0) return;
    if (!window.confirm(t('dedup.confirmSelection', { count: totalToDelete, kept: duplicateGroups.reduce((sum, group) => sum + group.photos.length, 0) - totalToDelete }))) return;
    try {
    setPhase('confirming');
    setDeleteFailure(null);
    const deleteIds = new Set<string>();
    for (const group of duplicateGroups) {
      getRejectedPhotoIds(group).forEach((id) => deleteIds.add(id));
    }
    const photosToDelete = usePhotoStore.getState().photos.filter((photo) => deleteIds.has(photo.id));
    let checkpoint = checkpointRef.current;
    if (!checkpoint) {
      const snapshot = createAlbumSnapshot(albumId, usePhotoStore.getState().photos);
      checkpoint = createPhotoTaskCheckpoint({
        id: `deduplication:${albumId}:${Date.now()}`,
        kind: 'deduplication',
        albumId,
        snapshotKey: snapshot.snapshotKey,
        photoIds: snapshot.photos.map((photo) => photo.id),
        batch: { mode: 'all' },
      });
    }
    checkpoint = preparePhotoTaskDeletion(checkpoint, [...deleteIds]);
    checkpointRef.current = checkpoint;
    await saveDesktopTaskCheckpoint(checkpoint);
    const remainingIds = new Set(getRemainingPhotoTaskDeletionIds(checkpoint));
    const pendingPhotos = photosToDelete.filter((photo) => remainingIds.has(photo.id));
    const result = await deletePhotosFromDisk(pendingPhotos, {
      mode: permanent ? 'permanent' : 'trash',
      onBatch: async ({ deletedIds, failedIds }) => {
        if (!checkpointRef.current) return;
        checkpointRef.current = recordPhotoTaskDeletionResult(checkpointRef.current, {
          committedIds: deletedIds,
          failedIds,
        });
        await saveDesktopTaskCheckpoint(checkpointRef.current);
      },
    });

    if (result.errors.length > 0) {
      console.error('[dedup] delete errors:', result.errors);
      setDeleteFailure({ deleted: result.deletedIds.size, errors: result.errors });
    }

    if (result.deletedIds.size > 0) {
      removePhotosById(Array.from(result.deletedIds));
      updateCachedAlbumPhotosAfterDelete(albumId, result.deletedIds);
    }

    const refreshed = await window.electronAPI?.getPhotos(albumId, { mode: 'fast' });
    if (refreshed) {
      const snapshot = createAlbumSnapshot(albumId, refreshed, {
        belongsToAlbum: (photo, currentAlbumId) => photo.albumId === currentAlbumId,
      });
      setCachedAlbumPhotos(albumId, snapshot.photos);
      usePhotoStore.getState().loadPhotos(snapshot.photos);
      await updateAlbumCountAfterLocalDelete(albumId, snapshot.count);
    }

    if (checkpointRef.current?.status === 'completed') {
      await persistProgress({ ...albumProgressRef.current, review: null, scanTaskId: null });
      await deleteDesktopTaskCheckpoint('deduplication', albumId);
      checkpointRef.current = null;
    }

    if (result.errors.length === 0 && !result.cancelled) {
      usePhotoStore.setState({ duplicateGroups: [] });
    }
    setDeletedCount(result.deletedIds.size);
    setPhase(result.errors.length > 0 || result.cancelled ? 'results' : 'done');
    if (permanent && result.deletedIds.size > 0) {
      window.alert(t('common.deletedStorage', { originalMB: (result.originalBytesRemoved / 1024 ** 2).toFixed(2), cacheMB: (result.cacheBytesRemoved / 1024 ** 2).toFixed(2) }));
    }
    } catch (err) {
      setDeleteFailure({ deleted: 0, errors: [err instanceof Error ? err.message : String(err)] });
      setPhase('results');
    }
  }, [albumId, duplicateGroups, persistProgress, removePhotosById, phase, t, totalToDelete]);

  const toggleGroup = useCallback((id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleCancelAnalysis = useCallback(() => {
    cancelRequestedRef.current = true;
    cancelDeduplication();
    void window.electronAPI?.fs.cancelVisualHashes?.().catch(() => null);
  }, [cancelDeduplication]);

  if (phase === 'setup') {
    const folderFullyChecked = photos.length > 0 && checkedCount >= photos.length;
    return (
      <div style={styles.centered}>
        <div style={styles.progressCard}>
          <h2 style={styles.heading}>{t('home.modes.dedup.title')}</h2>
          <p style={styles.statusText}>{t('common.photoCount', { count: photos.length })}</p>
          {checkedCount > 0 && <p style={styles.statusText}>{t('dedup.albumProgress', { checked: checkedCount, remaining: Math.max(0, photos.length - checkedCount) })}</p>}
          <label>{t('dedup.checkQuantity')}</label>
          <div style={styles.batchOptions}>
            {BATCH_SIZE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setBatchSize(option)}
                style={{
                  ...styles.batchOption,
                  ...(batchSize === option ? styles.batchOptionSelected : {}),
                }}
              >
                {option === 'all'
                  ? t('culling.batchAll')
                  : option === 'custom'
                    ? t('culling.batchCustom')
                    : option}
              </button>
            ))}
          </div>
          {batchSize === 'custom' && (
            <input
              type="number"
              min={1}
              max={photos.length}
              value={customBatchSize}
              onChange={(event) => setCustomBatchSize(event.target.value.replace(/[^0-9]/g, ''))}
              style={styles.batchInput}
            />
          )}
          <button data-testid="dedupe-start" onClick={() => handleStartAnalysis(folderFullyChecked ? 'restart' : 'continue')} style={styles.primaryBtn}>
            {t(folderFullyChecked ? 'dedup.restartCheck' : checkedCount > 0 ? 'dedup.continueCheck' : 'dedup.startCheck')}
          </button>
          {recoveryKind && <button data-testid="dedupe-resume" onClick={() => handleStartAnalysis('resume')} style={styles.cancelBtn}>{t(recoveryKind === 'review' ? 'dedup.reviewResults' : 'dedup.resumeBatch')}</button>}
          {checkedCount > 0 && !folderFullyChecked && <button data-testid="dedupe-restart" onClick={() => handleStartAnalysis('restart')} style={styles.cancelBtn}>{t('dedup.restartCheck')}</button>}
          <details style={styles.statusText}><summary>{t('dedup.batchInfo')}</summary>{t('dedup.batchScopeHint', { restart: t('dedup.restartCheck'), all: t('culling.batchAll') })}</details>
          <button onClick={() => navigate('/')} style={styles.cancelBtn}>
            {t('common.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'analyzing') {
    if (analysisFailure || photosError || (!photosLoading && photos.length === 0)) {
      return (
        <div style={styles.centered}>
          <div style={styles.progressCard}>
            <h2 style={styles.heading}>{t('dedup.analyzingTitle')}</h2>
            <p style={analysisFailure || photosError ? styles.errorText : styles.statusText}>
              {analysisFailure ?? photosError ?? t('home.errors.noReadablePhotos')}
            </p>
            <button onClick={() => navigate('/')} style={styles.cancelBtn}>
              {t('common.backToHome')}
            </button>
          </div>
        </div>
      );
    }

    const hashPercent = hashProgress && hashProgress.overallTotal > 0
      ? Math.min(100, Math.round(
        (hashProgress.overallProcessed / hashProgress.overallTotal) * 100,
      ))
      : null;
    const visibleProgress = hashPercent ?? Math.round(dedupeProgress);
    return (
      <div style={styles.centered}>
        <div style={styles.progressCard}>
          <h2 style={styles.heading}>{t('dedup.analyzingTitle')}</h2>
          <p style={styles.statusText}>
            {photosLoading
              ? t('dedup.status.scanProgress', { count: loadedPhotoCount })
              : translateDedupeStatus(dedupeStatus, t)}
          </p>
          {!photosLoading && selectedTaskCount > 0 && (
            <p style={styles.statusText}>
              {t('dedup.status.inputScope', { total: selectedTaskCount })}
            </p>
          )}
          {hashProgress && hashProgress.total > 0 && (
            <p style={styles.statusText}>
              {t(
                hashProgress.stage === 'content'
                  ? 'dedup.status.contentSignatureProgress'
                  : 'dedup.status.signatureProgress',
                {
                processed: hashProgress.processed,
                candidates: hashProgress.total,
                total: selectedTaskCount,
                },
              )}
            </p>
          )}
          {hashProgress && hashProgress.failed > 0 && (
            <p style={styles.statusText}>
              {t('dedup.status.signatureFailures', { count: hashProgress.failed })}
            </p>
          )}
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${visibleProgress}%` }} />
          </div>
          <span style={styles.progressLabel}>{visibleProgress}%</span>
          <button
            type="button"
            onClick={photosLoading ? () => navigate('/') : handleCancelAnalysis}
            style={styles.cancelBtn}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div style={styles.centered}>
        <div style={styles.progressCard}>
          <span style={{ fontSize: '48px' }}>✓</span>
          <h2 style={styles.heading}>{t('dedup.doneTitle')}</h2>
          <p style={styles.statusText}>
            {t('dedup.movedToTrash', { count: deletedCount, days: 30 })}
          </p>
          <button onClick={returnToSetup} style={styles.primaryBtn}>
            {t('dedup.chooseBatch')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <button onClick={returnToSetup} disabled={phase === 'confirming'} style={styles.backBtn}>
          ← {t('dedup.chooseBatch')}
        </button>
        <div style={styles.summary}>
          <span style={styles.summaryText}>
            {t('dedup.groupsSummary', { groups: duplicateGroups.length, count: totalToDelete })}
          </span>
        </div>
        <button
          data-testid="dedupe-confirm"
          onClick={() => handleConfirm()}
          disabled={totalToDelete === 0 || phase === 'confirming'}
          style={{
            ...styles.primaryBtn,
            opacity: totalToDelete === 0 ? 0.5 : 1,
          }}
        >
          {t('dedup.confirmDelete', { count: totalToDelete })}
        </button>
        <button onClick={() => handleConfirm(true)} disabled={totalToDelete === 0 || phase === 'confirming'} style={styles.cancelBtn}>
          {t('common.permanentDelete')}
        </button>
      </div>

      {signatureFailureCount > 0 && (
        <div style={styles.deleteErrorBox} role="status">
          {t('dedup.status.signatureFailures', { count: signatureFailureCount })}
        </div>
      )}

      {deleteFailure && (
        <div style={styles.deleteErrorBox} role="alert">
          <strong>
            {t('dedup.deletePartial', {
              deleted: deleteFailure.deleted,
              failed: deleteFailure.errors.length,
            })}
          </strong>
          <ul style={styles.deleteErrorList}>
            {deleteFailure.errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      <div style={{ padding: '12px 24px', color: colors.textSecondary }}>
        <p>{t('dedup.scanScope', { count: selectedTaskCount, total: photos.length })}</p>
        {duplicateGroups.length > 0 && <p>{t('dedup.defaultSelectionHint')}</p>}
      </div>
      <div style={{ ...styles.groupList, pointerEvents: phase === 'confirming' ? 'none' : undefined }}>
        {duplicateGroups.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={{ fontSize: '48px' }}>{refinementPhase === 'running' ? '…' : '✓'}</span>
            <p style={styles.emptyText}>
              {refinementPhase === 'running' ? translateDedupeStatus('dedup.status.finding', t) : t('dedup.noGroupsInBatch')}
            </p>
          </div>
        ) : (
          duplicateGroups.map((group) => (
            <DedupeGroupCard
              key={group.id}
              group={group}
              expanded={expandedGroups.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              onToggleSelection={(photoId) => { toggleDuplicateSelection(group.id, photoId); saveReview(); }}
              onKeepOnly={(photoId) => { keepOnlyDuplicate(group.id, photoId); saveReview(); }}
              onKeepAll={() => { keepAllDuplicates(group.id); saveReview(); }}
            />
          ))
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, padding: 16 }}>
        {checkedCount < photos.length && !analysisFailure && signatureFailureCount === 0 && <button data-testid="dedupe-next" style={styles.cancelBtn} disabled={phase === 'confirming'} onClick={() => handleStartAnalysis()}>{t('dedup.continueNextBatch')}</button>}
        {(analysisFailure || signatureFailureCount > 0) && <button style={styles.cancelBtn} onClick={() => handleStartAnalysis('resume')}>{t('common.retry')}</button>}
        <button data-testid="dedupe-choose-batch" style={styles.cancelBtn} disabled={phase === 'confirming'} onClick={returnToSetup}>{t('dedup.chooseBatch')}</button>
      </div>
    </div>
  );
}

function DedupeGroupCard({
  group,
  expanded,
  onToggle,
  onToggleSelection,
  onKeepOnly,
  onKeepAll,
}: {
  group: DuplicateGroup;
  expanded: boolean;
  onToggle: () => void;
  onToggleSelection: (photoId: string) => void;
  onKeepOnly: (photoId: string) => void;
  onKeepAll: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [previewId, setPreviewId] = useState(group.selectedPhotoId);
  const preview = group.photos.find((photo) => photo.id === previewId) ?? group.photos[0]!;
  const rejectedPhotoIds = new Set(getRejectedPhotoIds(group));
  const rejectedCount = rejectedPhotoIds.size;

  return (
    <div data-testid="dedupe-group" style={styles.groupCard}>
      <div role="button" onClick={onToggle} style={styles.groupHeader}>
        <div style={styles.groupHeaderLeft}>
          <span style={styles.groupIcon}>{expanded ? '▼' : '▶'}</span>
          <span style={styles.groupLabel}>
            {t('dedup.keepingBest', { count: group.photos.length })}
          </span>
          <span style={styles.rejectCount}>
            {t('dedup.toDelete', { count: rejectedCount })}
          </span>
        </div>
        <span style={styles.reasonBadge}>{translateDedupeReason(group, t)}</span>
      </div>

      {expanded && (
        <div style={styles.groupBody}>
          <p>{t('dedup.groupPreview', { current: group.photos.findIndex((photo) => photo.id === preview.id) + 1, total: group.photos.length })}</p>
          <GroupPreview photo={preview} />
          <button data-testid="dedupe-keep-all" style={{ ...styles.cancelBtn, margin: '16px 0' }} onClick={onKeepAll}>{t('dedup.keepGroupAll')}</button>
          <DedupePhotoGrid group={group} rejectedPhotoIds={rejectedPhotoIds} onToggleSelection={onToggleSelection} onPreview={setPreviewId} onKeepOnly={(photoId) => { setPreviewId(photoId); onKeepOnly(photoId); }} previewId={preview.id} />
        </div>
      )}
    </div>
  );
}

function DedupePhotoGrid({ group, rejectedPhotoIds, onToggleSelection, onPreview, onKeepOnly, previewId }: {
  group: DuplicateGroup;
  rejectedPhotoIds: Set<string>;
  onToggleSelection: (photoId: string) => void;
  onPreview: (photoId: string) => void;
  onKeepOnly: (photoId: string) => void;
  previewId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 800, top: 0 });
  const virtualized = group.photos.length > 24;
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport((previous) => ({ ...previous, width: element.clientWidth })));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const gap = 16;
  const columns = Math.max(1, Math.floor((viewport.width + gap) / (180 + gap)));
  const cardWidth = Math.max(1, (viewport.width - (columns - 1) * gap) / columns);
  const rowHeight = Math.ceil(cardWidth * 0.75) + 170 + gap;
  const totalHeight = Math.ceil(group.photos.length / columns) * rowHeight;
  const height = Math.min(500, totalHeight);
  const startIndex = virtualized ? Math.max(0, Math.floor(viewport.top / rowHeight) - 2) * columns : 0;
  const endIndex = virtualized ? Math.min(group.photos.length, (Math.ceil((viewport.top + height) / rowHeight) + 2) * columns) : group.photos.length;
  const visiblePhotos = group.photos.slice(startIndex, endIndex);
  return (
    <div ref={viewportRef} onScroll={(event) => {
      const top = event.currentTarget.scrollTop;
      setViewport((previous) => ({ ...previous, top }));
    }} style={virtualized ? { height, overflowY: 'auto' } : undefined}>
      <div style={virtualized ? { position: 'relative', height: totalHeight } : styles.photoGrid}>
            {visiblePhotos.map((photo, offset) => {
              const isRejected = rejectedPhotoIds.has(photo.id);
              const isKept = !isRejected;
              return (
                <div
                  key={photo.id}
                  data-testid="dedupe-thumbnail"
                  style={{
                    ...styles.photoCard,
                    ...(virtualized ? {
                      position: 'absolute',
                      top: Math.floor((startIndex + offset) / columns) * rowHeight,
                      left: ((startIndex + offset) % columns) * (cardWidth + gap),
                      width: cardWidth,
                      height: rowHeight - gap,
                    } : {}),
                    borderColor: isKept ? colors.success : colors.danger,
                  }}
                >
                  <button data-testid="dedupe-preview" onClick={() => onPreview(photo.id)}
                    aria-label={`${t('dedup.groupPreview', { current: startIndex + offset + 1, total: group.photos.length })}: ${photo.filename}`}
                    aria-pressed={photo.id === previewId} style={{ padding: 0, border: 0, borderRadius: 0, background: 'none', flexShrink: 0 }}>
                    <DedupeThumbnail photo={photo} dimmed={false} />
                  </button>
                  <div
                    style={{
                      ...styles.decisionBadge,
                      background: isKept ? colors.success : colors.danger,
                    }}
                  >
                    {isKept ? t('dedup.keepingLabel') : t('dedup.toDelete', { count: 1 })}
                  </div>
                  <span style={styles.photoFilename}>{photo.filename}</span>
                  <small style={{ minHeight: 20, textAlign: 'center', color: colors.textSecondary }}>{photo.id === previewId ? t('dedup.previewingLabel') : '\u00a0'}</small>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button data-testid="dedupe-keep-only" style={styles.cancelBtn} onClick={() => onKeepOnly(photo.id)}>{t('dedup.keepOnlyThis')}</button>
                    <button data-testid="dedupe-toggle-delete" disabled={isKept && group.photos.length - rejectedPhotoIds.size === 1}
                      style={styles.cancelBtn} onClick={() => onToggleSelection(photo.id)}>{t(isRejected ? 'dedup.keepThisBtn' : 'dedup.markDeleteBtn')}</button>
                  </div>
                </div>
              );
            })}

      </div>
    </div>
  );
}

function GroupPreview({ photo }: { photo: Photo }): React.JSX.Element {
  const { src, onLoadError } = usePhotoThumbnail(localFileUriToPath(photo.uri), true, photo.thumbnailUri, 1280, true);
  return <div style={{ height: 280, background: colors.background, borderRadius: 12, overflow: 'hidden' }}>
    {src && <img src={src} alt={photo.filename} onError={onLoadError} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
  </div>;
}

function DedupeThumbnail({ photo, dimmed }: { photo: Photo; dimmed: boolean }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const { src, onLoadError } = usePhotoThumbnail(localFileUriToPath(photo.uri), shouldLoad, photo.thumbnailUri);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || shouldLoad) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: '240px' },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [shouldLoad]);

  return (
    <div ref={containerRef} style={styles.photoImageFrame}>
      {src ? (
        <img
          src={src}
          alt={photo.filename}
          onError={onLoadError}
          loading="lazy"
          decoding="async"
          style={{
            ...styles.photoImg,
            opacity: dimmed ? 0.4 : 1,
          }}
        />
      ) : (
        <div style={styles.photoPlaceholder} />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: colors.background,
    overflow: 'hidden',
  },
  centered: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    overflowY: 'auto',
    background: colors.background,
  },
  progressCard: {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.md,
    width: 'min(520px, 100%)',
    maxHeight: '100%',
    overflowY: 'auto',
  },
  heading: {
    margin: 0,
    fontSize: typography.sizes.xl,
    fontWeight: '600',
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  statusText: {
    margin: 0,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  errorText: {
    margin: 0,
    fontSize: typography.sizes.sm,
    color: colors.danger,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    whiteSpace: 'pre-wrap',
  },
  deleteErrorBox: {
    margin: `${spacing.sm} ${spacing.lg} 0`,
    padding: spacing.sm,
    border: `1px solid ${colors.danger}`,
    borderRadius: radius.sm,
    background: colors.dangerDim,
    color: colors.danger,
    fontFamily: typography.fontFamily,
  },
  deleteErrorList: {
    maxHeight: '160px',
    margin: `${spacing.xs} 0 0`,
    paddingLeft: spacing.lg,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  progressBar: {
    width: '100%',
    height: '6px',
    background: colors.border,
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: colors.accent,
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  progressLabel: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  batchOptions: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: spacing.xs,
  },
  batchOption: {
    minHeight: '36px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    background: colors.surfaceElevated,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    cursor: 'pointer',
  },
  batchOptionSelected: {
    borderColor: colors.accent,
    background: colors.accentDim,
    color: colors.accent,
  },
  batchInput: {
    width: '100%',
    minHeight: '38px',
    boxSizing: 'border-box',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    background: colors.background,
    color: colors.text,
    padding: `0 ${spacing.sm}`,
    fontFamily: typography.fontFamily,
  },
  primaryBtn: {
    padding: `${spacing.sm} ${spacing.xl}`,
    background: colors.accent,
    border: 'none',
    borderRadius: radius.md,
    color: '#FFFFFF',
    fontSize: typography.sizes.md,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  cancelBtn: {
    padding: `${spacing.xs} ${spacing.lg}`,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  topBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    padding: `${spacing.md} ${spacing.xl}`,
    borderBottom: `1px solid ${colors.border}`,
    gap: spacing.md,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
    padding: 0,
    flexShrink: 0,
  },
  summary: { flex: 1 },
  summaryText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  groupList: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
    padding: `${spacing.md} ${spacing.xl}`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xxl,
  },
  emptyText: {
    margin: 0,
    fontSize: typography.sizes.lg,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  groupCard: {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflow: 'hidden',
    flexShrink: 0,
    contentVisibility: 'auto',
    containIntrinsicSize: '56px',
  },
  groupHeader: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.md} ${spacing.md}`,
    background: 'none',
    border: 'none',
    color: colors.text,
    fontWeight: '700',
    cursor: 'pointer',
    textAlign: 'left',
  },
  groupHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupIcon: {
    fontSize: '12px',
    color: colors.textSecondary,
    fontWeight: '700',
  },
  groupLabel: {
    fontSize: typography.sizes.sm,
    color: colors.text,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
  },
  rejectCount: {
    fontSize: typography.sizes.xs,
    color: colors.danger,
    background: colors.dangerDim,
    padding: '2px 8px',
    borderRadius: '999px',
    fontWeight: '700',
    fontFamily: typography.fontFamily,
  },
  reasonBadge: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
  },
  groupBody: {
    borderTop: `1px solid ${colors.border}`,
    padding: spacing.md,
  },
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: spacing.md,
  },
  photoCard: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    background: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: '2px',
    borderStyle: 'solid',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    outline: 'none',
    userSelect: 'none',
  },
  photoImageFrame: {
    width: '100%',
    aspectRatio: '4/3',
    background: colors.surfaceElevated,
    overflow: 'hidden',
  },
  photoImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    background: colors.surfaceElevated,
  },
  deleteOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(239, 68, 68, 0.2)', // colors.danger with alpha
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  deleteIcon: {
    fontSize: '48px',
    color: colors.danger,
    opacity: 0.8,
  },
  decisionBadge: {
    padding: '4px 8px',
    color: colors.textOnStrong,
    fontSize: '10px',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    textAlign: 'center',
    fontFamily: typography.fontFamily,
  },
  photoFilename: {
    padding: '4px 8px',
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },
};
