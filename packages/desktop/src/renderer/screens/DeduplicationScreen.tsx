import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { colors, typography, spacing, radius } from '../theme';
import type { DuplicateGroup, Photo, PhotoTaskBatch, PhotoTaskCheckpoint } from '@photo-manager/shared';
import {
  createAlbumSnapshot,
  createPhotoTaskCheckpoint,
  getRemainingPhotoTaskDeletionIds,
  getSafeRejectedPhotoIds,
  getLocalizedAlbumTitle,
  localFileUriToPath,
  photoTaskBatchesMatch,
  preparePhotoTaskDeletion,
  recordPhotoTaskDeletionResult,
  resumePhotoTaskCheckpoint,
  selectDedupeSignatureCandidates,
  usePhotoStore,
  useTranslation,
} from '@photo-manager/shared';
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
): Promise<void> {
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
  const { albumId, albumTitle } = (location.state as { albumId: string; albumTitle: string }) ?? {};
  const displayAlbumTitle = getLocalizedAlbumTitle(albumTitle ?? '', t);

  const {
    photos,
    duplicateGroups,
    dedupeProgress,
    dedupeStatus,
    runDeduplication,
    cancelDeduplication,
    toggleDuplicateSelection,
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
          checkpointRef.current = null;
          setSelectedTaskCount(0);
          setPhase('setup');
          return;
        }
        const storedCheckpoint = await loadDesktopTaskCheckpoint('deduplication', albumId);
        const resumedCheckpoint = storedCheckpoint
          ? resumePhotoTaskCheckpoint(
            storedCheckpoint,
            initialSnapshot.snapshotKey,
            initialSnapshot.photos.map((photo) => photo.id),
          )
          : null;
        const matchingCheckpoint = resumedCheckpoint
          && photoTaskBatchesMatch(
            resumedCheckpoint.batch,
            analysisBatch,
            initialSnapshot.count,
          )
          ? resumedCheckpoint
          : null;
        checkpointRef.current = matchingCheckpoint ?? createPhotoTaskCheckpoint({
          id: `deduplication:${albumId}:${Date.now()}`,
          kind: 'deduplication',
          albumId,
          snapshotKey: initialSnapshot.snapshotKey,
          photoIds: initialSnapshot.photos.map((photo) => photo.id),
          batch: analysisBatch,
        });
        setSelectedTaskCount(checkpointRef.current.photoIds.length);
        analysisStarted = true;
        await saveDesktopTaskCheckpoint(checkpointRef.current);
        const taskPhotoIds = new Set(checkpointRef.current.photoIds);
        const taskPhotos = initialSnapshot.photos.filter((photo) => taskPhotoIds.has(photo.id));
        setRefinementPhase('running');
        await addDedupeSignaturesToCandidatePhotos(taskPhotos, {
          isCancelled: () => cancelled || cancelRequestedRef.current,
          onProgress: (progress) => {
            setHashProgress(progress);
            setSignatureFailureCount(progress.stage === 'visual' ? progress.failed : 0);
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
        await runDeduplication({ photoIds: checkpointRef.current.photoIds });
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
  }, [albumId, analysisBatch, photosError, photosLoading, runDeduplication]);

  const handleStartAnalysis = useCallback(() => {
    setAnalysisBatch(getTaskBatch(batchSize, customBatchSize, photos.length));
  }, [batchSize, customBatchSize, photos.length]);

  const totalToDelete = Math.max(
    0,
    duplicateGroups.reduce((sum, group) => sum + getRejectedPhotoIds(group).length, 0),
  );

  const handleConfirm = useCallback(async () => {
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
      await deleteDesktopTaskCheckpoint('deduplication', albumId);
      checkpointRef.current = null;
    }

    if (result.errors.length === 0) {
      usePhotoStore.setState({ duplicateGroups: [] });
    }
    setDeletedCount(result.deletedIds.size);
    setPhase(result.errors.length > 0 ? 'results' : 'done');
  }, [albumId, duplicateGroups, removePhotosById]);

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
    return (
      <div style={styles.centered}>
        <div style={styles.progressCard}>
          <h2 style={styles.heading}>{t('dedup.analyzingTitle')}</h2>
          <p style={styles.statusText}>{t('common.photoCount', { count: photos.length })}</p>
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
          <button onClick={handleStartAnalysis} style={styles.primaryBtn}>
            {t('dedup.startAnalysis')}
          </button>
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
          <button onClick={() => navigate('/')} style={styles.primaryBtn}>
            {t('common.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <button onClick={() => navigate('/')} style={styles.backBtn}>
          ← {displayAlbumTitle}
        </button>
        <div style={styles.summary}>
          <span style={styles.summaryText}>
            {t('dedup.groupsSummary', { groups: duplicateGroups.length, count: totalToDelete })}
          </span>
        </div>
        <button
          onClick={handleConfirm}
          disabled={totalToDelete === 0 || phase === 'confirming'}
          style={{
            ...styles.primaryBtn,
            opacity: totalToDelete === 0 ? 0.5 : 1,
          }}
        >
          {t('dedup.confirmDelete', { count: totalToDelete })}
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

      <div style={styles.groupList}>
        {duplicateGroups.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={{ fontSize: '48px' }}>{refinementPhase === 'running' ? '…' : '✓'}</span>
            <p style={styles.emptyText}>
              {refinementPhase === 'running' ? translateDedupeStatus('dedup.status.finding', t) : t('dedup.noGroups')}
            </p>
          </div>
        ) : (
          duplicateGroups.map((group) => (
            <DedupeGroupCard
              key={group.id}
              group={group}
              expanded={expandedGroups.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              onToggleSelection={(photoId) => toggleDuplicateSelection(group.id, photoId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DedupeGroupCard({
  group,
  expanded,
  onToggle,
  onToggleSelection,
}: {
  group: DuplicateGroup;
  expanded: boolean;
  onToggle: () => void;
  onToggleSelection: (photoId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const rejectedPhotoIds = new Set(getRejectedPhotoIds(group));
  const rejectedCount = rejectedPhotoIds.size;

  return (
    <div style={styles.groupCard}>
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
          <div style={styles.photoGrid}>
            {group.photos.map((photo) => {
              const isRejected = rejectedPhotoIds.has(photo.id);
              const isKept = !isRejected;
              return (
                <div
                  key={photo.id}
                  onClick={() => onToggleSelection(photo.id)}
                  style={{
                    ...styles.photoCard,
                    borderColor: isKept ? colors.success : colors.danger,
                  }}
                >
                  <DedupeThumbnail photo={photo} dimmed={!isKept} />
                  {!isKept && (
                    <div style={styles.deleteOverlay}>
                      <span style={styles.deleteIcon}>✗</span>
                    </div>
                  )}
                  <div
                    style={{
                      ...styles.decisionBadge,
                      background: isKept ? colors.success : colors.danger,
                    }}
                  >
                    {isKept ? `✓ ${t('dedup.keepingLabel')}` : t('dedup.rejectedLabel')}
                  </div>
                  <span style={styles.photoFilename}>{photo.filename}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DedupeThumbnail({ photo, dimmed }: { photo: Photo; dimmed: boolean }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const { src } = usePhotoThumbnail(localFileUriToPath(photo.uri), shouldLoad, photo.thumbnailUri);

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
    minWidth: '360px',
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
