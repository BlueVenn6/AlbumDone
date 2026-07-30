import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { colors, typography, spacing, radius } from '../theme';
import {
  createAlbumSnapshot,
  createPhotoTaskCheckpoint,
  getLocalizedAlbumTitle,
  getRemainingPhotoTaskDeletionIds,
  localFileUriToPath,
  preparePhotoTaskDeletion,
  recordPhotoTaskDecision,
  recordPhotoTaskDeletionResult,
  resumePhotoTaskCheckpoint,
  undoPhotoTaskDecision,
  useCullingStore,
  usePhotoStore,
  useTranslation,
} from '@photo-manager/shared';
import type {
  CullingItem,
  CullingDecision,
  Photo,
  PhotoTaskBatch,
  PhotoTaskCheckpoint,
} from '@photo-manager/shared';
import { useKeyboard, buildCullingShortcuts } from '../hooks/useKeyboard';
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

type Phase = 'preprocessing' | 'intro' | 'culling' | 'done';
type ViewMode = 'single' | 'grid';
type BatchSizeOption = '50' | '100' | '200' | '500' | 'custom' | 'all';
const BATCH_SIZE_OPTIONS: BatchSizeOption[] = ['50', '100', '200', '500', 'custom', 'all'];
const GRID_PADDING = 16;
const GRID_GAP = 16;
const GRID_MIN_CELL_WIDTH = 200;
const GRID_IMAGE_HEIGHT = 200;
const GRID_FILENAME_HEIGHT = 60;
const GRID_CELL_HEIGHT = GRID_IMAGE_HEIGHT + GRID_FILENAME_HEIGHT;
const GRID_OVERSCAN_ROWS = 1;
const DECISION_FEEDBACK_MS = 80;

function getTaskBatch(option: BatchSizeOption, customValue: string, total: number): PhotoTaskBatch {
  if (option === 'all') {
    return { mode: 'all' };
  }
  const requested = option === 'custom'
    ? Number.parseInt(customValue, 10)
    : Number.parseInt(option, 10);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, total)
    : Math.min(100, total);
  return { mode: 'limited', limit };
}

export function CullingScreen(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { albumId, albumTitle } = (location.state as { albumId: string; albumTitle: string }) ?? {};

  const { items, allItems, currentIndex, decide, undoLast, isComplete, aiStats, goToNext, goToPrev, history } =
    useCullingStore();
  const { photos, loadPhotos, removePhotosById } = usePhotoStore();

  const [phase, setPhase] = useState<Phase>('preprocessing');
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());
  const [overlay, setOverlay] = useState<'keep' | 'delete' | null>(null);
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [trashDone, setTrashDone] = useState(false);
  const [batchSize, setBatchSize] = useState<BatchSizeOption>('100');
  const [customBatchSize, setCustomBatchSize] = useState('100');
  const initializedAlbumRef = useRef<string | null>(null);
  const checkpointRef = useRef<PhotoTaskCheckpoint | null>(null);
  const checkpointSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const {
    loading: photosLoading,
    error: photosError,
    loadedCount: loadedPhotoCount,
  } = useLoadPhotos(albumId);

  const queueCheckpointSave = useCallback((checkpoint: PhotoTaskCheckpoint) => {
    checkpointRef.current = checkpoint;
    checkpointSaveQueueRef.current = checkpointSaveQueueRef.current
      .catch(() => undefined)
      .then(() => saveDesktopTaskCheckpoint(checkpoint));
  }, []);

  useEffect(() => {
    if (!albumId) { navigate('/'); return; }
    if (photosLoading || photosError || photos.length === 0) return;

    if (initializedAlbumRef.current === albumId) return;
    initializedAlbumRef.current = albumId;
    let cancelled = false;

    const loadManualCullingItems = async () => {
      const snapshot = createAlbumSnapshot(albumId, photos, {
        belongsToAlbum: (photo, currentAlbumId) => photo.albumId === currentAlbumId,
      });
      const stored = await loadDesktopTaskCheckpoint('culling', albumId);
      const resumed = stored
        ? resumePhotoTaskCheckpoint(
          stored,
          snapshot.snapshotKey,
          snapshot.photos.map((photo) => photo.id),
        )
        : null;
      if (cancelled) return;

      if (!resumed || resumed.status === 'completed') {
        if (resumed?.status === 'completed') {
          await deleteDesktopTaskCheckpoint('culling', albumId);
        }
        checkpointRef.current = null;
        setPhase('intro');
        return;
      }
      const checkpoint = resumed;
      const photoById = new Map(snapshot.photos.map((photo) => [photo.id, photo]));
      const cullingItems: CullingItem[] = checkpoint.photoIds.flatMap((photoId) => {
        const photo = photoById.get(photoId);
        return photo ? [{
          photo,
          decision: checkpoint.decisions[photoId] ?? 'pending',
          aiDecision: 'pending' as CullingDecision,
        }] : [];
      });
      checkpointRef.current = checkpoint;
      await saveDesktopTaskCheckpoint(checkpoint);
      if (cancelled) return;
      useCullingStore.setState({
        items: cullingItems,
        allItems: cullingItems,
        currentIndex: Math.min(checkpoint.currentIndex, Math.max(0, cullingItems.length - 1)),
        isComplete: cullingItems.every((item) => item.decision !== 'pending'),
        isProcessing: false,
        error: null,
        history: [],
        aiStats: {
          autoKept: 0,
          autoDeleted: 0,
          uncertainCount: cullingItems.filter((item) => item.decision === 'pending').length,
        },
      });
      setPhase(cullingItems.every((item) => item.decision !== 'pending') ? 'done' : 'culling');
    };

    void loadManualCullingItems().catch((err: unknown) => {
      if (!cancelled) {
        useCullingStore.getState().setError(err instanceof Error ? err.message : String(err));
        setPhase('preprocessing');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [albumId, navigate, photos, photosError, photosLoading]);

  const handleStartCulling = useCallback(() => {
    const snapshot = createAlbumSnapshot(albumId, photos, {
      belongsToAlbum: (photo, currentAlbumId) => photo.albumId === currentAlbumId,
    });
    const checkpoint = createPhotoTaskCheckpoint({
      id: `culling:${albumId}:${Date.now()}`,
      kind: 'culling',
      albumId,
      snapshotKey: snapshot.snapshotKey,
      photoIds: snapshot.photos.map((photo) => photo.id),
      batch: getTaskBatch(batchSize, customBatchSize, snapshot.count),
    });
    const photoById = new Map(snapshot.photos.map((photo) => [photo.id, photo]));
    const cullingItems: CullingItem[] = checkpoint.photoIds.flatMap((photoId) => {
      const photo = photoById.get(photoId);
      return photo ? [{ photo, decision: 'pending', aiDecision: 'pending' }] : [];
    });
    useCullingStore.setState({
      items: cullingItems,
      allItems: cullingItems,
      currentIndex: 0,
      isComplete: cullingItems.length === 0,
      isProcessing: false,
      error: null,
      history: [],
      aiStats: { autoKept: 0, autoDeleted: 0, uncertainCount: cullingItems.length },
    });
    queueCheckpointSave(checkpoint);
    setPhase(cullingItems.length === 0 ? 'done' : 'culling');
  }, [albumId, batchSize, customBatchSize, photos, queueCheckpointSave]);

  const reconcileAlbum = useCallback(async () => {
    const loaded = await window.electronAPI?.getPhotos(albumId, { mode: 'fast' });
    if (!loaded) return;
    const snapshot = createAlbumSnapshot(albumId, loaded, {
      belongsToAlbum: (photo, currentAlbumId) => photo.albumId === currentAlbumId,
    });
    setCachedAlbumPhotos(albumId, snapshot.photos);
    loadPhotos(snapshot.photos);
    await updateAlbumCountAfterLocalDelete(albumId, snapshot.count);
  }, [albumId, loadPhotos]);

  const deleteWithCheckpoint = useCallback(async (photosToDelete: Photo[]) => {
    let checkpoint = checkpointRef.current;
    if (!checkpoint) {
      const snapshot = createAlbumSnapshot(albumId, usePhotoStore.getState().photos);
      checkpoint = createPhotoTaskCheckpoint({
        id: `culling:${albumId}:${Date.now()}`,
        kind: 'culling',
        albumId,
        snapshotKey: snapshot.snapshotKey,
        photoIds: snapshot.photos.map((photo) => photo.id),
        batch: { mode: 'all' },
      });
    }
    checkpoint = preparePhotoTaskDeletion(checkpoint, photosToDelete.map((photo) => photo.id));
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

    if (checkpointRef.current?.status === 'completed') {
      await deleteDesktopTaskCheckpoint('culling', albumId);
      checkpointRef.current = null;
    }
    await reconcileAlbum();
    return result;
  }, [albumId, reconcileAlbum]);

  // Transition to done when the store marks culling complete OR when the
  // current index has moved past all items (safety-net for edge cases).
  useEffect(() => {
    if (
      phase === 'culling' &&
      (isComplete || (items.length > 0 && currentIndex >= items.length))
    ) {
      setPhase('done');
    }
  }, [isComplete, phase, items.length, currentIndex]);

  const triggerDecision = useCallback(
    (decision: 'keep' | 'delete') => {
      if (phase !== 'culling' || currentIndex >= items.length) return;
      const currentItem = items[currentIndex];
      if (!currentItem) return;
      setOverlay(decision);
      overlayTimer.current = setTimeout(() => {
        setOverlay(null);
        if (checkpointRef.current) {
          queueCheckpointSave(recordPhotoTaskDecision(
            checkpointRef.current,
            currentItem.photo.id,
            decision,
          ));
        }
        decide(currentItem.photo.id, decision);
      }, DECISION_FEEDBACK_MS);
    },
    [phase, currentIndex, items, decide, queueCheckpointSave],
  );

  const handleUndo = useCallback(() => {
    const previous = history[history.length - 1];
    if (checkpointRef.current && previous) {
      queueCheckpointSave(undoPhotoTaskDecision(checkpointRef.current, previous.photoId));
    }
    undoLast();
  }, [history, queueCheckpointSave, undoLast]);

  const handleApplyDeletions = async () => {
    if (selectedForDeletion.size === 0) return;
    if (!window.confirm(t('culling.confirmTrashDetailed', { count: selectedForDeletion.size }))) return;

    setTrashing(true);
    const toDelete = items.filter(i => selectedForDeletion.has(i.photo.id));

    try {
      const result = await deleteWithCheckpoint(toDelete.map((item) => item.photo));
      if (result.errors.length > 0) {
        window.alert(result.errors.join('\n'));
      }
      if (result.fallbackTrashPaths.length > 0) {
        window.alert(t('culling.fallbackTrashNotice', {
          paths: [...new Set(result.fallbackTrashPaths)].join('\n'),
        }));
      }

      // Update store: remove deleted items
      removePhotosById(Array.from(result.deletedIds));
      const remainingItems = items.filter(i => !result.deletedIds.has(i.photo.id));
      const remainingAllItems = allItems.filter(i => !result.deletedIds.has(i.photo.id));
      updateCachedAlbumPhotosAfterDelete(albumId, result.deletedIds);
      
      useCullingStore.setState({
        items: remainingItems,
        allItems: remainingAllItems,
        currentIndex: Math.min(currentIndex, Math.max(0, remainingItems.length - 1)),
        isComplete: remainingItems.every(i => i.decision !== 'pending') && remainingItems.length > 0,
      });

      setSelectedForDeletion((previous) => {
        const next = new Set(previous);
        result.deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      
    } catch (err) {
      console.error('[culling] batch delete error:', err);
      window.alert(err instanceof Error ? err.message : t('culling.deleteFailed'));
    } finally {
      setTrashing(false);
    }
  };

  const handleExit = useCallback(() => {
    if (selectedForDeletion.size > 0) {
      if (!window.confirm(t('culling.exitWithPendingDeletions'))) return;
    }
    navigate('/');
  }, [navigate, selectedForDeletion.size, t]);

  useKeyboard(
    buildCullingShortcuts({
      onKeep: () => triggerDecision('keep'),
      onDelete: () => triggerDecision('delete'),
      onUndo: handleUndo,
      onNext: goToNext,
      onPrev: goToPrev,
      onEscape: handleExit,
    }),
    { enabled: phase === 'culling' },
  );

  const toggleSelection = useCallback((id: string) => {
    setSelectedForDeletion(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (phase === 'preprocessing') {
    if (photosError || (!photosLoading && photos.length === 0)) {
      return (
        <div style={styles.centered}>
          <div style={styles.card}>
            <h2 style={styles.heading}>{t('culling.manualTitle')}</h2>
            <p style={photosError ? styles.errorText : styles.subText}>
              {photosError ?? t('home.errors.noReadablePhotos')}
            </p>
            <button onClick={() => navigate('/')} style={styles.secondaryBtn}>
              {t('common.backToHome')}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          <div style={styles.spinnerLarge} />
          <h2 style={styles.heading}>{t('culling.manualTitle')}</h2>
          <p style={styles.subText}>{t('culling.manualDescription')}</p>
          {photosLoading && loadedPhotoCount > 0 && (
            <p style={styles.subText}>{t('common.photoCount', { count: loadedPhotoCount })}</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'intro') {
    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          <h2 style={styles.heading}>{t('culling.manualTitle')}</h2>
          <p style={styles.subText}>{t('common.photoCount', { count: photos.length })}</p>
          <div style={styles.batchSection}>
            <span style={styles.batchLabel}>{t('culling.batchSize')}</span>
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
          </div>
          <button onClick={handleStartCulling} style={styles.primaryBtn}>
            {t('culling.startCulling')}
          </button>
          <button onClick={() => navigate('/')} style={styles.secondaryBtn}>
            {t('common.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const kept = allItems.filter((i) => i.decision === 'keep').length;
    const toDelete = allItems.filter((i) => i.decision === 'delete');

    const handleConfirmDelete = async () => {
      if (!window.confirm(t('culling.confirmTrashDetailed', { count: toDelete.length }))) {
        return;
      }
      setTrashing(true);
      const result = await deleteWithCheckpoint(toDelete.map((item) => item.photo));
      if (result.errors.length > 0) {
        console.error('[culling] delete errors:', result.errors);
        window.alert(result.errors.join('\n'));
      }
      if (result.fallbackTrashPaths.length > 0) {
        window.alert(t('culling.fallbackTrashNotice', {
          paths: [...new Set(result.fallbackTrashPaths)].join('\n'),
        }));
      }
      removePhotosById(Array.from(result.deletedIds));
      updateCachedAlbumPhotosAfterDelete(albumId, result.deletedIds);
      setTrashing(false);
      setTrashDone(true);
    };

    const handleBackToHome = () => {
      navigate('/');
    };

    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          <span style={{ fontSize: '48px' }}>{trashDone ? '✓' : '✓'}</span>
          <h2 style={styles.heading}>{t('culling.completeTitle')}</h2>
          <div style={styles.statsRow}>
            <StatBadge label={t('culling.kept')} value={kept + aiStats.autoKept} color={colors.success} />
            <StatBadge label={t('culling.deleted')} value={toDelete.length + aiStats.autoDeleted} color={colors.danger} />
          </div>
          {!trashDone && toDelete.length > 0 && (
            <button
              onClick={handleConfirmDelete}
              disabled={trashing}
              style={{ ...styles.primaryBtn, background: trashing ? colors.border : colors.danger }}
            >
              {trashing ? t('common.deleting') : t('culling.confirmTrash', { count: toDelete.length })}
            </button>
          )}
          {trashDone && (
            <p style={styles.subText}>{t('culling.trashDone', { count: toDelete.length })}</p>
          )}
          <button onClick={handleBackToHome} style={styles.secondaryBtn}>
            {t('common.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  // Culling phase (照片筛选)
  if (viewMode === 'grid') {
    return (
      <GridCulling
        items={items}
        selectedIds={selectedForDeletion}
        onToggleSelection={toggleSelection}
        onApplyDeletions={handleApplyDeletions}
        isTrashing={trashing}
        onUndo={handleUndo}
        onSwitchView={() => setViewMode('single')}
        onBack={handleExit}
      />
    );
  }

  const currentItem = items[currentIndex];
  if (!currentItem) return <div style={styles.centered}><p style={styles.subText}>{t('culling.manualTitle')}</p></div>;

  return (
    <FullscreenCullingView
      items={items}
      item={currentItem}
      currentIndex={currentIndex}
      totalItems={items.length}
      overlay={overlay}
      onKeep={() => triggerDecision('keep')}
      onDelete={() => triggerDecision('delete')}
      onUndo={handleUndo}
      onSwitchView={() => setViewMode('grid')}
      albumTitle={albumTitle}
      onBack={handleExit}
    />
  );
}

function FullscreenCullingView({
  items,
  item,
  currentIndex,
  totalItems,
  overlay,
  onKeep,
  onDelete,
  onUndo,
  onSwitchView,
  albumTitle,
  onBack,
}: {
  items: CullingItem[];
  item: CullingItem;
  currentIndex: number;
  totalItems: number;
  overlay: 'keep' | 'delete' | null;
  onKeep: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onSwitchView: () => void;
  albumTitle: string;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [zoomed, setZoomed] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);
  const displayAlbumTitle = getLocalizedAlbumTitle(albumTitle, t);
  const preview = usePhotoThumbnail(
    localFileUriToPath(item.photo.uri),
    true,
    item.photo.thumbnailUri,
    1280,
    true,
  );

  useEffect(() => {
    setZoomed(false);
    setOriginalFailed(false);
  }, [item.photo.id]);

  return (
    <div style={styles.fullscreenContainer}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <button onClick={onBack} style={styles.backBtn}>← {displayAlbumTitle}</button>
        <span style={styles.progressText}>
          {t('culling.progress', { current: currentIndex + 1, total: totalItems })}
        </span>
        <div style={styles.topActions}>
          <button onClick={onUndo} style={styles.iconBtn} title={t('culling.undoHint')}>↩</button>
          <button onClick={onSwitchView} style={styles.iconBtn} title={t('culling.grid')}>⊞</button>
        </div>
      </div>

      {/* Image */}
      <div
        style={styles.imageWrap}
        onClick={() => setZoomed(!zoomed)}
      >
        {(zoomed && !originalFailed ? item.photo.uri : preview.src) ? (
          <img
            src={zoomed && !originalFailed ? item.photo.uri : preview.src ?? undefined}
            alt={item.photo.filename}
            onError={() => {
              if (zoomed) setOriginalFailed(true);
            }}
            style={{
              ...styles.fullImg,
              objectFit: 'contain',
              cursor: zoomed ? 'zoom-out' : 'zoom-in',
            }}
          />
        ) : preview.status === 'failed' ? (
          <button
            type="button"
            style={styles.secondaryBtn}
            onClick={(event) => {
              event.stopPropagation();
              preview.retry();
            }}
          >
            {t('common.retry')}
          </button>
        ) : (
          <div style={styles.spinnerLarge} />
        )}
        {[items[currentIndex - 1], items[currentIndex + 1]].map((candidate) => (
          !candidate || candidate.photo.id === item.photo.id
            ? null
            : <CullingPreviewPreloader key={candidate.photo.id} item={candidate} />
        ))}
        {/* Decision overlay */}
        {overlay && (
          <div
            style={{
              ...styles.overlay,
              background: overlay === 'keep' ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)',
            }}
          >
            <span style={styles.overlayIcon}>{overlay === 'keep' ? '✓' : '✗'}</span>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div style={styles.bottomBar}>
        <button onClick={onDelete} style={styles.deleteBtn} title={t('culling.deleteHint')}>
          ✗ {t('common.delete')}
        </button>
        <div style={styles.keyHintRow}>
          <span style={styles.keyHint}>{t('culling.deleteHint')}</span>
          <span style={styles.keyHint}>{t('culling.keepHint')}</span>
        </div>
        <button onClick={onKeep} style={styles.keepBtn} title={t('culling.keepHint')}>
          ✓ {t('common.keep')}
        </button>
      </div>
    </div>
  );
}

function CullingPreviewPreloader({ item }: { item: CullingItem }): React.JSX.Element | null {
  const { src } = usePhotoThumbnail(
    localFileUriToPath(item.photo.uri),
    true,
    item.photo.thumbnailUri,
    1280,
    true,
  );
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      decoding="async"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

function GridCulling({
  items,
  selectedIds,
  onToggleSelection,
  onApplyDeletions,
  isTrashing,
  onUndo,
  onSwitchView,
  onBack,
}: {
  items: CullingItem[];
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onApplyDeletions: () => void;
  isTrashing: boolean;
  onUndo: () => void;
  onSwitchView: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const reviewedCount = useMemo(
    () => items.reduce((count, item) => count + (item.decision !== 'pending' ? 1 : 0), 0),
    [items],
  );
  const selectedCount = selectedIds.size;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });

  const updateViewport = useCallback(() => {
    const container = scrollerRef.current;
    if (!container) {
      return;
    }

    setViewport((previous) => {
      const next = {
        width: container.clientWidth,
        height: container.clientHeight,
        scrollTop: container.scrollTop,
      };

      return (
        previous.width === next.width
        && previous.height === next.height
        && previous.scrollTop === next.scrollTop
      )
        ? previous
        : next;
    });
  }, []);

  useEffect(() => {
    updateViewport();

    const container = scrollerRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateViewport();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateViewport]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setViewport((previous) => {
        const next = {
          width: container.clientWidth,
          height: container.clientHeight,
          scrollTop: container.scrollTop,
        };

        return (
          previous.width === next.width
          && previous.height === next.height
          && previous.scrollTop === next.scrollTop
        )
          ? previous
          : next;
      });
    });
  }, []);

  const availableWidth = Math.max(GRID_MIN_CELL_WIDTH, viewport.width - (GRID_PADDING * 2));
  const columnCount = Math.max(
    1,
    Math.floor((availableWidth + GRID_GAP) / (GRID_MIN_CELL_WIDTH + GRID_GAP)),
  );
  const columnWidth = Math.max(
    GRID_MIN_CELL_WIDTH,
    Math.floor((availableWidth - (GRID_GAP * (columnCount - 1))) / columnCount),
  );
  const rowSpan = GRID_CELL_HEIGHT + GRID_GAP;
  const rowCount = Math.ceil(items.length / columnCount);
  const totalHeight = rowCount === 0
    ? GRID_PADDING * 2
    : (GRID_PADDING * 2) + (rowCount * rowSpan) - GRID_GAP;
  const viewportBottom = viewport.scrollTop + viewport.height;
  const startRow = Math.max(
    0,
    Math.floor(Math.max(0, viewport.scrollTop - GRID_PADDING) / rowSpan) - GRID_OVERSCAN_ROWS,
  );
  const endRow = Math.min(
    Math.max(0, rowCount - 1),
    Math.ceil(Math.max(0, viewportBottom - GRID_PADDING) / rowSpan) + GRID_OVERSCAN_ROWS,
  );
  const loadStartRow = Math.max(
    0,
    Math.floor(Math.max(0, viewport.scrollTop - GRID_PADDING) / rowSpan) - 1,
  );
  const loadEndRow = Math.min(
    Math.max(0, rowCount - 1),
    Math.ceil(Math.max(0, viewportBottom - GRID_PADDING) / rowSpan) + 1,
  );

  const visibleCells = useMemo(() => {
    if (items.length === 0) {
      return [] as Array<{
        item: CullingItem;
        top: number;
        left: number;
        width: number;
        shouldLoad: boolean;
      }>;
    }

    const cells: Array<{
      item: CullingItem;
      top: number;
      left: number;
      width: number;
      shouldLoad: boolean;
    }> = [];
    const startIndex = startRow * columnCount;
    const endIndex = Math.min(items.length, (endRow + 1) * columnCount);

    for (let index = startIndex; index < endIndex; index += 1) {
      const item = items[index];
      if (!item) {
        continue;
      }

      const row = Math.floor(index / columnCount);
      const column = index % columnCount;
      cells.push({
        item,
        top: GRID_PADDING + (row * rowSpan),
        left: GRID_PADDING + (column * (columnWidth + GRID_GAP)),
        width: columnWidth,
        shouldLoad: row >= loadStartRow && row <= loadEndRow,
      });
    }

    return cells;
  }, [columnCount, columnWidth, endRow, items, loadEndRow, loadStartRow, rowSpan, startRow]);

  return (
    <div style={styles.gridContainer}>
      <div style={styles.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
          <button onClick={onBack} style={styles.backBtn}>← {t('common.back')}</button>
          <span style={styles.progressText}>
            {t('culling.reviewedProgress', { reviewed: reviewedCount, total: items.length })}
          </span>
        </div>
        <div style={styles.topActions}>
          <button onClick={onUndo} style={styles.iconBtn}>↩ {t('common.undo')}</button>
          <button onClick={onSwitchView} style={styles.iconBtn}>{t('culling.fullscreen')}</button>
        </div>
      </div>

      <div ref={scrollerRef} style={styles.gridScroller} onScroll={handleScroll}>
        <div style={{ ...styles.virtualGrid, height: `${totalHeight}px` }}>
          {visibleCells.map((cell) => (
            <ThumbnailGridCell
              key={`${cell.item.photo.id}-${cell.item.photo.uri}`}
              item={cell.item}
              top={cell.top}
              left={cell.left}
              width={cell.width}
              shouldLoad={cell.shouldLoad}
              isSelected={selectedIds.has(cell.item.photo.id)}
              onToggleSelection={onToggleSelection}
            />
          ))}
        </div>
      </div>

      <div style={styles.stickyFooter}>
        <button
          onClick={onApplyDeletions}
          disabled={selectedCount === 0 || isTrashing}
          style={{
            ...styles.primaryBtn,
            background: selectedCount > 0 ? colors.danger : colors.border,
            cursor: (selectedCount > 0 && !isTrashing) ? 'pointer' : 'not-allowed',
            width: 'auto',
            minWidth: '300px',
            height: '48px',
            fontSize: '16px',
            boxShadow: (selectedCount > 0 && !isTrashing) ? '0 4px 12px rgba(239, 68, 68, 0.3)' : 'none',
          }}
        >
          {isTrashing
            ? t('common.deleting')
            : selectedCount > 0
              ? t('culling.confirmSelectedDelete', { count: selectedCount })
              : t('culling.selectPhotosToDelete')}
        </button>
      </div>
    </div>
  );
}

function extractLocalFilePath(uri: string): string {
  return localFileUriToPath(uri);
}

const ThumbnailGridCell = memo(function ThumbnailGridCell({
  item,
  top,
  left,
  width,
  shouldLoad,
  isSelected,
  onToggleSelection,
}: {
  item: CullingItem;
  top: number;
  left: number;
  width: number;
  shouldLoad: boolean;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
}) {
  const handleClick = useCallback(() => {
    onToggleSelection(item.photo.id);
  }, [item.photo.id, onToggleSelection]);

  return (
    <div
      style={{
        position: 'absolute',
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
        height: `${GRID_CELL_HEIGHT}px`,
      }}
    >
      <div
        style={{
          ...styles.gridCell,
          borderColor: isSelected ? colors.danger : colors.border,
          boxShadow: isSelected ? `inset 0 0 0 3px ${colors.danger}` : 'none',
          zIndex: isSelected ? 5 : 1,
        }}
        onClick={handleClick}
      >
        <ThumbnailImage
          filePath={extractLocalFilePath(item.photo.uri)}
          alt={item.photo.filename}
          dimmed={item.decision !== 'pending'}
          shouldLoad={shouldLoad}
          initialSrc={item.photo.thumbnailUri}
        />

        <div style={styles.filenameArea}>
          <span style={styles.filenameText}>{item.photo.filename}</span>
        </div>

        {item.decision !== 'pending' && (
          <div style={styles.gridDecisionBadge}>
            <span style={{ color: item.decision === 'keep' ? colors.success : colors.danger }}>
              {item.decision === 'keep' ? '✓' : '✗'}
            </span>
          </div>
        )}

        {isSelected && (
          <>
            <div style={styles.selectionOverlay} />
            <div style={styles.selectionIcon}>✗</div>
          </>
        )}
      </div>
    </div>
  );
}, (previous, next) =>
  previous.item === next.item
  && previous.top === next.top
  && previous.left === next.left
  && previous.width === next.width
  && previous.shouldLoad === next.shouldLoad
  && previous.isSelected === next.isSelected
);

const ThumbnailImage = memo(function ThumbnailImage({
  filePath,
  alt,
  dimmed,
  shouldLoad,
  initialSrc,
}: {
  filePath: string;
  alt: string;
  dimmed: boolean;
  shouldLoad: boolean;
  initialSrc?: string;
}) {
  const { src } = usePhotoThumbnail(filePath, shouldLoad, initialSrc);

  return (
    <div style={styles.gridImageFrame}>
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={{
            ...styles.gridImg,
            opacity: dimmed ? 0.5 : 1,
          }}
        />
      ) : (
        <div style={styles.gridImagePlaceholder} />
      )}
    </div>
  );
});

function StatBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '28px', fontWeight: '700', color, fontFamily: typography.fontFamily }}>
        {value}
      </div>
      <div style={{ fontSize: typography.sizes.xs, color: colors.textSecondary, fontFamily: typography.fontFamily }}>
        {label}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  centered: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.background,
  },
  card: {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: '400px',
    maxWidth: '520px',
  },
  heading: {
    margin: 0,
    fontSize: typography.sizes.xl,
    fontWeight: '600',
    color: colors.text,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  subText: {
    margin: 0,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: '1.5',
  },
  errorText: {
    margin: 0,
    fontSize: typography.sizes.sm,
    color: colors.danger,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
  },
  statsRow: {
    display: 'flex',
    gap: spacing.xl,
    padding: spacing.md,
  },
  batchSection: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  batchLabel: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  batchOptions: {
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
    color: colors.accent,
    background: colors.accentDim,
  },
  batchInput: {
    minHeight: '38px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    background: colors.background,
    color: colors.text,
    padding: `0 ${spacing.sm}`,
    fontFamily: typography.fontFamily,
  },
  spinnerLarge: {
    width: '40px',
    height: '40px',
    border: `3px solid ${colors.border}`,
    borderTop: `3px solid ${colors.accent}`,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  keyHints: {
    display: 'flex',
    gap: spacing.md,
  },
  hint: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    background: colors.surfaceElevated,
    padding: '4px 10px',
    borderRadius: radius.sm,
    fontFamily: 'monospace',
  },
  viewToggle: {
    display: 'flex',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  toggleBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: 'none',
    border: 'none',
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  toggleActive: {
    background: colors.surfaceElevated,
    color: colors.text,
  },
  primaryBtn: {
    padding: `${spacing.sm} ${spacing.xl}`,
    background: colors.accent,
    border: 'none',
    borderRadius: radius.md,
    color: colors.textOnStrong,
    fontSize: typography.sizes.md,
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
    width: '100%',
  },
  secondaryBtn: {
    padding: `${spacing.sm} ${spacing.xl}`,
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
    width: '100%',
  },
  fullscreenContainer: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#000',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    background: colors.background,
    borderBottom: `1px solid ${colors.border}`,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
    padding: 0,
  },
  progressText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  topActions: {
    display: 'flex',
    gap: spacing.sm,
  },
  iconBtn: {
    padding: `${spacing.xs} ${spacing.sm}`,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  imageWrap: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fullImg: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
  },
  overlayIcon: {
    fontSize: '80px',
    opacity: 0.9,
  },
  bottomBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.md} ${spacing.xl}`,
    background: colors.background,
    borderTop: `1px solid ${colors.border}`,
  },
  deleteBtn: {
    padding: `${spacing.sm} ${spacing.xl}`,
    background: colors.dangerDim,
    border: `1px solid ${colors.danger}40`,
    borderRadius: radius.md,
    color: colors.danger,
    fontSize: typography.sizes.md,
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  keepBtn: {
    padding: `${spacing.sm} ${spacing.xl}`,
    background: colors.successDim,
    border: `1px solid ${colors.success}40`,
    borderRadius: radius.md,
    color: colors.success,
    fontSize: typography.sizes.md,
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  keyHintRow: {
    display: 'flex',
    gap: spacing.md,
  },
  keyHint: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    fontFamily: typography.fontFamily,
  },
  gridContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: colors.background,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 0,
  },
  gridScroller: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  virtualGrid: {
    position: 'relative',
    width: '100%',
  },
  gridCell: {
    position: 'relative',
    background: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '260px',
    height: '260px',
    flexShrink: 0,
    cursor: 'pointer',
    transition: 'transform 0.1s ease-out, border-color 0.1s ease-out, box-shadow 0.1s ease-out',
    border: `1px solid ${colors.border}`,
  },
  gridImageFrame: {
    width: '100%',
    height: '200px',
    background: colors.surfaceElevated,
    overflow: 'hidden',
  },
  gridImagePlaceholder: {
    width: '100%',
    height: '100%',
    background: colors.surfaceElevated,
  },
  gridImg: {
    width: '100%',
    height: '200px',
    objectFit: 'cover',
    display: 'block',
  },
  filenameArea: {
    height: '60px',
    padding: '8px',
    background: colors.surface,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filenameText: {
    display: 'block',
    fontSize: '12px',
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'center',
    width: '100%',
  },
  selectionOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(239, 68, 68, 0.25)',
    pointerEvents: 'none',
    zIndex: 2,
  },
  selectionIcon: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '24px',
    height: '24px',
    background: colors.danger,
    color: colors.textOnStrong,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 'bold',
    zIndex: 3,
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
  },
  floatingActionArea: {
    position: 'absolute',
    bottom: spacing.xl,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 100,
  },
  gridDecisionBadge: {
    position: 'absolute',
    top: '8px',
    left: '8px',
    width: '24px',
    height: '24px',
    background: 'rgba(0,0,0,0.6)',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    zIndex: 2,
  },
  stickyFooter: {
    height: '80px',
    background: 'rgba(26, 26, 26, 0.9)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderTop: `1px solid ${colors.border}`,
    flexShrink: 0,
    zIndex: 100,
  },
};
