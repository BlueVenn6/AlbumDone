import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { colors, typography, spacing, radius } from '../theme';
import {
  formatProviderRouteLabel,
  configSupportsVision,
  localFileUriToPath,
  useSettingsStore,
  usePhotoStore,
  useTranslation,
  filterScreenshots,
} from '@photo-manager/shared';
import type { Photo, CustomInstruction, LLMProvider } from '@photo-manager/shared';
import { useLoadPhotos } from '../hooks/useLoadPhotos';
import { usePhotoThumbnail } from '../hooks/usePhotoThumbnail';
import { resolveDesktopLLMRoute } from '../utils/desktopLLMClient';
import { updateAlbumCountAfterLocalDelete } from '../utils/albumCountCache';
import { updateCachedAlbumPhotosAfterDelete } from '../utils/photoSessionCache';
import { deletePhotosFromDisk } from '../utils/deletePhotos';

type ProcessedResult = {
  photoId: string;
  instruction: string;
  output: string;
  timestamp: number;
};

type CloudConfirmationState = {
  routeKey: string;
  destination: string;
  resolve: (choice: 'cancel' | 'once' | 'session') => void;
};

const SIDEBAR_ROW_HEIGHT = 60;
const SIDEBAR_OVERSCAN = 6;

function getEndpointHost(baseUrl?: string): string {
  try {
    return baseUrl ? new URL(baseUrl).host : '';
  } catch {
    return '';
  }
}

function isLocalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function isFullyLocalVisionRoute(route: { provider: LLMProvider; config: { baseUrl?: string } }): boolean {
  if (!route.config.baseUrl) {
    return false;
  }
  try {
    const parsed = new URL(route.config.baseUrl);
    return parsed.protocol === 'http:' && isLocalHost(parsed.hostname);
  } catch {
    return false;
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

function createInstructionRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `instruction_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function ScreenshotScreen(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { i18n, t } = useTranslation();
  const { albumId } = (location.state as { albumId: string; albumTitle: string }) ?? {};

  const settings = useSettingsStore();
  const { photos, removePhotosById } = usePhotoStore();
  const { loading: photosLoading, error: photosError } = useLoadPhotos(albumId, 'full');
  const [screenshots, setScreenshots] = useState<Photo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [results, setResults] = useState<ProcessedResult[]>([]);
  const [currentInstruction, setCurrentInstruction] = useState('');
  const [customInstruction, setCustomInstruction] = useState('');
  const [executing, setExecuting] = useState(false);
  const [currentOutput, setCurrentOutput] = useState('');
  const [actionError, setActionError] = useState('');
  const [phase, setPhase] = useState<'list' | 'processor' | 'summary'>('list');
  const [selectedScreenshots, setSelectedScreenshots] = useState<Set<string>>(new Set());
  const [selectedVisionProvider, setSelectedVisionProvider] = useState<LLMProvider | ''>('');
  const [cloudConfirmation, setCloudConfirmation] = useState<CloudConfirmationState | null>(null);

  const [activeImageReady, setActiveImageReady] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const activeInstructionRequestIdRef = useRef<string | null>(null);
  const cancelledInstructionRequestIdsRef = useRef(new Set<string>());
  const trustedCloudRoutesRef = useRef(new Set<string>());
  const thumbListRef = useRef<HTMLDivElement>(null);
  const thumbScrollFrameRef = useRef<number | null>(null);
  const [thumbViewport, setThumbViewport] = useState({ height: 0, scrollTop: 0 });

  const activeItem = useMemo(() =>
    screenshots.find(p => p.id === activeId) || null,
    [screenshots, activeId]
  );
  const visionProviderOptions = useMemo(
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
    [
      settings.providers,
    ],
  );
  const activeVisionRoute = useMemo(
    () => resolveDesktopLLMRoute(selectedVisionProvider || null, { requiresVision: true }),
    [
      selectedVisionProvider,
      settings.defaultTextProvider,
      settings.defaultVisionProvider,
      settings.providers,
    ],
  );
  const activeVisionLabel = activeVisionRoute
    ? formatProviderRouteLabel(activeVisionRoute)
    : null;
  const canExecuteInstruction = Boolean(activeItem && activeVisionRoute) && !executing;

  const activeCloudRouteKey = activeVisionRoute
    ? `${activeVisionRoute.provider}:${activeVisionRoute.config.baseUrl ?? ''}:${activeVisionRoute.config.model}`
    : '';
  const activeCloudDestination = activeVisionRoute
    ? getCloudDestination(activeVisionRoute, activeVisionLabel ?? activeVisionRoute.provider)
    : '';
  const activeCloudRequiresConfirmation = activeVisionRoute
    ? !isFullyLocalVisionRoute(activeVisionRoute)
    : false;

  const PRESET_INSTRUCTIONS = useMemo(() => [
    { id: 'extract_text', label: t('screenshots.instructions.extract_text'), prompt: t('screenshots.instructionPrompts.extract_text') },
    { id: 'translate_zh', label: t('screenshots.instructions.translate_zh'), prompt: t('screenshots.instructionPrompts.translate_zh') },
    { id: 'translate_en', label: t('screenshots.instructions.translate_en'), prompt: t('screenshots.instructionPrompts.translate_en') },
    { id: 'key_points', label: t('screenshots.instructions.key_points'), prompt: t('screenshots.instructionPrompts.key_points') },
    { id: 'todos', label: t('screenshots.instructions.todos'), prompt: t('screenshots.instructionPrompts.todos') },
    { id: 'formal_email', label: t('screenshots.instructions.formal_email'), prompt: t('screenshots.instructionPrompts.formal_email') },
    { id: 'casual_msg', label: t('screenshots.instructions.casual_msg'), prompt: t('screenshots.instructionPrompts.casual_msg') },
    { id: 'extract_numbers', label: t('screenshots.instructions.extract_numbers'), prompt: t('screenshots.instructionPrompts.extract_numbers') },
    { id: 'summarize', label: t('screenshots.instructions.summarize'), prompt: t('screenshots.instructionPrompts.summarize') },
    { id: 'commitments', label: t('screenshots.instructions.commitments'), prompt: t('screenshots.instructionPrompts.commitments') },
  ], [t]);

  useEffect(() => {
    if (
      selectedVisionProvider
      && !visionProviderOptions.some((option) => option.provider === selectedVisionProvider)
    ) {
      setSelectedVisionProvider('');
    }
  }, [selectedVisionProvider, visionProviderOptions]);

  const updateThumbViewport = useCallback(() => {
    const container = thumbListRef.current;
    if (!container) {
      return;
    }

    setThumbViewport((previous) => {
      const next = {
        height: container.clientHeight,
        scrollTop: container.scrollTop,
      };

      return (
        previous.height === next.height
        && previous.scrollTop === next.scrollTop
      )
        ? previous
        : next;
    });
  }, []);

  useEffect(() => {
    if (!albumId) { navigate('/'); return; }
    // 强制执行切换重置 (Hard Reset)：丢掉所有上个相册的幽灵状态
    setScreenshots([]);
    setActiveId(null);
    setActiveImageReady(false);
    setCurrentOutput('');
    setCurrentInstruction('');
    setActionError('');
    setResults([]);
  }, [albumId, navigate]);

  useEffect(() => {
    if (photosError) return;
    const albumPhotos = photos.filter((photo) => photo.albumId === albumId);
    const shots = filterScreenshots(albumPhotos);
    setScreenshots(shots);
    if (shots.length > 0 && !activeId) setActiveId(shots[0].id);
  }, [activeId, albumId, photos, photosError, photosLoading]);

  useEffect(() => {
    updateThumbViewport();

    const container = thumbListRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateThumbViewport();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateThumbViewport]);

  useEffect(() => () => {
    if (thumbScrollFrameRef.current !== null) {
      cancelAnimationFrame(thumbScrollFrameRef.current);
    }
    const requestId = activeInstructionRequestIdRef.current;
    if (requestId) {
      cancelledInstructionRequestIdsRef.current.add(requestId);
      void window.electronAPI?.screenshot.cancelInstruction(requestId);
    }
  }, []);

  // Sync data when activeId changes
  useEffect(() => {
    if (!activeId) {
      setActiveImageReady(false);
      setCurrentOutput('');
      setCurrentInstruction('');
      return;
    }

    setActionError('');
    setActiveImageReady(Boolean(activeItem));
    setIsImageLoading(Boolean(activeItem));
    setCurrentOutput('');
    setCurrentInstruction('');

    const photoResults = results.filter(r => r.photoId === activeId);
    if (photoResults.length > 0) {
      const latest = [...photoResults].sort((a, b) => b.timestamp - a.timestamp)[0];
      if (latest) {
        setCurrentOutput(latest.output);
        setCurrentInstruction(latest.instruction);
      }
    }
  }, [activeId, activeItem, results]);

  const handleThumbListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    if (thumbScrollFrameRef.current !== null) {
      cancelAnimationFrame(thumbScrollFrameRef.current);
    }

    thumbScrollFrameRef.current = requestAnimationFrame(() => {
      thumbScrollFrameRef.current = null;
      setThumbViewport((previous) => {
        const next = {
          height: container.clientHeight,
          scrollTop: container.scrollTop,
        };

        return (
          previous.height === next.height
          && previous.scrollTop === next.scrollTop
        )
          ? previous
          : next;
      });
    });
  }, []);

  const requestCloudConfirmation = useCallback(
    (routeKey: string, destination: string) =>
      new Promise<'cancel' | 'once' | 'session'>((resolve) => {
        setCloudConfirmation({ routeKey, destination, resolve });
      }),
    [],
  );

  const resolveCloudConfirmation = useCallback((choice: 'cancel' | 'once' | 'session') => {
    setCloudConfirmation((current) => {
      if (current && choice === 'session') {
        trustedCloudRoutesRef.current.add(current.routeKey);
      }
      current?.resolve(choice);
      return null;
    });
  }, []);

  const handleCancelInstruction = useCallback(() => {
    const requestId = activeInstructionRequestIdRef.current;
    if (!requestId) return;
    cancelledInstructionRequestIdsRef.current.add(requestId);
    void window.electronAPI?.screenshot.cancelInstruction(requestId);
  }, []);

  const handleExecute = useCallback(
    async (instructionOrId: string) => {
      const targetId = activeId;
      const targetItem = activeItem;
      if (!targetId || !targetItem || !instructionOrId.trim() || executing) return;

      const preset = PRESET_INSTRUCTIONS.find(p => p.id === instructionOrId);
      const instructionText = preset ? preset.prompt : instructionOrId;
      const displayLabel = preset ? preset.label : instructionOrId;

      if (!activeVisionRoute) {
        setActionError(t('screenshots.noApiKey'));
        return;
      }

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

      setCurrentInstruction(displayLabel);
      setExecuting(true);
      setCurrentOutput('');
      setActionError('');
      const requestId = createInstructionRequestId();
      activeInstructionRequestIdRef.current = requestId;
      
      try {
        const filePath = localFileUriToPath(targetItem.uri);
        const previewImage = await window.electronAPI?.fs.readImagePreviewAsBase64(filePath, 1536);
        if (!previewImage) throw new Error(t('screenshots.loadError'));
        if (cancelledInstructionRequestIdsRef.current.has(requestId)) {
          return;
        }
        const response = await window.electronAPI?.screenshot.executeInstruction({
          provider: activeVisionRoute.provider,
          baseUrl: activeVisionRoute.config.baseUrl,
          model: activeVisionRoute.config.model,
          supportsVision: activeVisionRoute.config.supportsVision,
          mode: activeVisionRoute.config.mode,
          instruction: instructionText,
          imageBase64: previewImage.base64,
          mimeType: previewImage.mimeType,
          languageCode: i18n.language,
          requestId,
        });
        const content = response?.content ?? '';
        if (!content) {
          throw new Error(t('screenshots.loadError'));
        }

        setCurrentOutput(content);
        setResults((prev) => [
          ...prev,
          { photoId: targetId, instruction: displayLabel, output: content, timestamp: Date.now() },
        ]);
      } catch (err) {
        if (cancelledInstructionRequestIdsRef.current.has(requestId)) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setActionError(message);
        setCurrentOutput(`${t('common.error')}: ${message}`);
      } finally {
        cancelledInstructionRequestIdsRef.current.delete(requestId);
        if (activeInstructionRequestIdRef.current === requestId) {
          activeInstructionRequestIdRef.current = null;
          setExecuting(false);
        }
      }
    },
    [
      PRESET_INSTRUCTIONS,
      activeCloudDestination,
      activeCloudRequiresConfirmation,
      activeCloudRouteKey,
      activeId,
      activeItem,
      activeVisionRoute,
      executing,
      i18n.language,
      requestCloudConfirmation,
      selectedVisionProvider,
      t,
    ],
  );

  const handleCopyText = async () => {
    if (!currentOutput) return;

    try {
      window.focus();
      await navigator.clipboard.writeText(currentOutput);
      alert(t('toast.copy_success'));
    } catch (err) {
      const textArea = document.createElement("textarea");
      textArea.value = currentOutput;
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        alert(t('toast.copy_success'));
      } catch (e) {
        console.error('Fallback text copy failed', e);
        alert(t('toast.copy_failed_focus_retry'));
      }
      document.body.removeChild(textArea);
    }
  };

  const toggleSelection = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedScreenshots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (ids: string[], e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (ids.length === 0) return;
    if (!window.confirm(t('common.confirmDeleteCount', { count: ids.length }))) return;

    const itemsToDelete = screenshots.filter((p) => ids.includes(p.id));

    if (window.electronAPI?.fs.deleteFiles) {
      const result = await deletePhotosFromDisk(itemsToDelete);
      if (result.errors.length > 0) {
        setActionError(result.errors.join('\n'));
      }
      if (result.deletedIds.size > 0) {
        removePhotosById(Array.from(result.deletedIds));
        updateCachedAlbumPhotosAfterDelete(albumId, result.deletedIds);
        setScreenshots((prev) => prev.filter((p) => !result.deletedIds.has(p.id)));
        setSelectedScreenshots((prev) => {
          const next = new Set(prev);
          result.deletedIds.forEach(id => next.delete(id));
          return next;
        });
        if (activeId && result.deletedIds.has(activeId)) {
          setActiveId(null);
        }
        await updateAlbumCountAfterLocalDelete(albumId, usePhotoStore.getState().photos.length);
      }
    }
  };

  const doneCount = Array.isArray(results)
    ? results.reduce(
      (acc, r) => { acc.add(r.photoId); return acc; },
      new Set<string>(),
    ).size
    : 0;
  const sidebarStartIndex = Math.max(
    0,
    Math.floor(thumbViewport.scrollTop / SIDEBAR_ROW_HEIGHT) - SIDEBAR_OVERSCAN,
  );
  const sidebarEndIndex = Math.min(
    screenshots.length,
    Math.ceil((thumbViewport.scrollTop + thumbViewport.height) / SIDEBAR_ROW_HEIGHT) + SIDEBAR_OVERSCAN,
  );
  const visibleSidebarRows = useMemo(
    () => screenshots.slice(sidebarStartIndex, sidebarEndIndex),
    [screenshots, sidebarEndIndex, sidebarStartIndex],
  );
  const firstVisibleSidebarRow = screenshots.length > 0
    ? Math.min(screenshots.length, Math.floor(thumbViewport.scrollTop / SIDEBAR_ROW_HEIGHT) + 1)
    : 0;
  const lastVisibleSidebarRow = screenshots.length > 0
    ? Math.max(
      firstVisibleSidebarRow,
      Math.min(
        screenshots.length,
        Math.ceil(
          (thumbViewport.scrollTop + Math.max(thumbViewport.height, SIDEBAR_ROW_HEIGHT))
          / SIDEBAR_ROW_HEIGHT,
        ),
      ),
    )
    : 0;

  if (phase === 'summary') {
    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          <span style={{ fontSize: '48px' }}>✓</span>
          <h2 style={styles.heading}>{t('screenshots.completeTitle')}</h2>

          <div style={{ width: '100%', marginTop: spacing.md }}>
            {Array.isArray(results) && results.length > 0 ? (
              <p style={styles.subText}>
                {t('screenshots.completeSummary', {
                  screenshots: doneCount,
                  instructions: results.length
                })}
              </p>
            ) : (
              <p style={styles.subText}>{t('common.no_results')}</p>
            )}
          </div>

          <button onClick={() => navigate('/')} style={styles.primaryBtn}>
            {t('common.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  if (photosError || screenshots.length === 0) {
    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          {photosLoading && <div style={styles.spinner} />}
          <h2 style={styles.heading}>{t('screenshots.title', { count: screenshots.length })}</h2>
          <p style={photosError ? styles.errorText : styles.subText}>
            {photosError
              ? photosError
              : photosLoading
                ? t('home.loadingShort')
                : t('home.errors.noReadablePhotos')}
          </p>
          {!photosLoading && (
            <button onClick={() => navigate('/')} style={styles.primaryBtn}>
              {t('common.backToHome')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {cloudConfirmation && (
        <div style={styles.modalOverlay}>
          <div style={styles.confirmDialog}>
            <h2 style={styles.confirmTitle}>{t('screenshots.cloudConfirmTitle')}</h2>
            <p style={styles.confirmBody}>
              {t('screenshots.cloudConfirmBody', { destination: cloudConfirmation.destination })}
            </p>
            <div style={styles.confirmActions}>
              <button
                onClick={() => resolveCloudConfirmation('cancel')}
                style={styles.confirmSecondaryBtn}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => resolveCloudConfirmation('once')}
                style={styles.confirmSecondaryBtn}
              >
                {t('screenshots.continueOnce')}
              </button>
              <button
                onClick={() => resolveCloudConfirmation('session')}
                style={styles.confirmPrimaryBtn}
              >
                {t('screenshots.trustForSession')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Left: thumbnail list */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <button onClick={() => navigate('/')} style={styles.backBtn}>←</button>
          <span style={styles.sidebarTitleBlock}>
            <span style={styles.sidebarTitle}>
                  {t('screenshots.title', { count: screenshots.length })}
            </span>
            <span style={styles.sidebarRange}>
              {t('screenshots.visibleRange', {
                start: firstVisibleSidebarRow,
                end: lastVisibleSidebarRow,
                total: screenshots.length,
              })}
            </span>
          </span>
          {doneCount > 0 && (
            <button onClick={() => setPhase('summary')} style={styles.doneBtn}>
              {t('screenshots.done')}
            </button>
          )}
        </div>
        <div ref={thumbListRef} style={styles.thumbList} onScroll={handleThumbListScroll}>
          <div style={{ ...styles.thumbViewport, height: `${screenshots.length * SIDEBAR_ROW_HEIGHT}px` }}>
            {visibleSidebarRows.map((photo, offsetIndex) => {
              const absoluteIndex = sidebarStartIndex + offsetIndex;
              const isDone = Array.isArray(results) && results.some((r) => r.photoId === photo.id);
              const isSelected = selectedScreenshots.has(photo.id);

              return (
                <ScreenshotSidebarRow
                  key={`${photo.id}-${photo.uri}`}
                  photo={photo}
                  top={absoluteIndex * SIDEBAR_ROW_HEIGHT}
                  isDone={isDone}
                  isSelected={isSelected}
                  isActive={activeId === photo.id}
                  onActivate={setActiveId}
                  onToggleSelection={toggleSelection}
                  onDelete={handleDelete}
                  deleteTitle={t('common.delete')}
                  scrollRoot={thumbListRef.current}
                />
              );
            })}
          </div>
        </div>

        {selectedScreenshots.size > 0 && (
          <div style={styles.bulkActions}>
            <button
              onClick={() => handleDelete(Array.from(selectedScreenshots))}
              style={styles.bulkDeleteBtn}
            >
              {t('common.delete')} ({selectedScreenshots.size})
            </button>
          </div>
        )}
      </div>

      {/* Right: processor */}
      <div style={styles.processor}>
        {!activeId || !activeItem ? (
          <div style={styles.noSelection}>
            <p style={styles.subText}>{t('screenshots.noSelection')}</p>
          </div>
        ) : (
          <>
            {/* Preview */}
            <div style={styles.previewArea}>
              <img
                src={activeItem.uri}
                alt={activeItem.filename}
                style={styles.previewImg}
                onLoad={() => {
                  setIsImageLoading(false);
                  setActiveImageReady(true);
                }}
                onError={() => {
                  setIsImageLoading(false);
                  setActiveImageReady(false);
                  setActionError(t('screenshots.loadError'));
                }}
              />
              {isImageLoading && (
                <div style={styles.previewLoadingOverlay}>
                  <div style={styles.spinner} />
                </div>
              )}
            </div>

            {actionError && (
              <div style={styles.errorBox}>
                {actionError}
              </div>
            )}

            {/* Instructions */}
            <div style={styles.instructionArea}>
              <div style={styles.presetGrid}>
                {PRESET_INSTRUCTIONS.map((inst) => (
                  <button
                    key={inst.id}
                    onClick={() => handleExecute(inst.id)}
                    disabled={!canExecuteInstruction}
                    title={!activeItem ? t('screenshots.loadError') : (!activeVisionLabel ? t('screenshots.noVisionModel') : '')}
                    style={{ ...styles.presetBtn, opacity: canExecuteInstruction ? 1 : 0.5 }}
                  >
                    {inst.label}
                  </button>
                ))}
                {settings.customInstructions?.map((ci: CustomInstruction) => (
                  <button
                    key={ci.id}
                    onClick={() => handleExecute(ci.prompt)}
                    disabled={!canExecuteInstruction}
                    title={!activeItem ? t('screenshots.loadError') : (!activeVisionLabel ? t('screenshots.noVisionModel') : '')}
                    style={{ ...styles.presetBtn, borderStyle: 'dashed', opacity: canExecuteInstruction ? 1 : 0.5 }}
                  >
                    {ci.name}
                  </button>
                ))}
              </div>
              {visionProviderOptions.length > 0 && (
                <select
                  value={selectedVisionProvider}
                  onChange={(event) => setSelectedVisionProvider(event.target.value)}
                  style={styles.modelSelect}
                >
                  <option value="">{t('screenshots.useDefaultModel')}</option>
                  {visionProviderOptions.map((option) => (
                    <option key={option.provider} value={option.provider}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              <div style={{
                ...styles.modelRouteBox,
                ...(activeVisionLabel ? {} : styles.modelRouteBoxWarning),
              }}>
                {activeVisionLabel
                  ? t('screenshots.usingModel', { model: activeVisionLabel })
                  : t('screenshots.noVisionModel')}
              </div>

              <div style={styles.customRow}>
                <input
                  readOnly={false}
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customInstruction.trim()) {
                      handleExecute(customInstruction);
                      setCustomInstruction('');
                    }
                  }}
                  placeholder={t('screenshots.customPlaceholder')}
                  disabled={!canExecuteInstruction}
                  style={styles.customInput}
                />
                <button
                  onClick={() => { handleExecute(customInstruction); setCustomInstruction(''); }}
                  disabled={!customInstruction.trim() || !canExecuteInstruction}
                  title={!activeVisionLabel ? t('screenshots.noVisionModel') : ''}
                  style={{ ...styles.executeBtn, opacity: (!customInstruction.trim() || !canExecuteInstruction) ? 0.5 : 1 }}
                >
                  {executing ? t('screenshots.executing') : t('screenshots.execute')}
                </button>
              </div>
            </div>

            {/* Output */}
            {(currentOutput || executing) && (
              <div style={styles.outputArea}>
                <div style={styles.outputHeader}>
                  <span style={styles.outputLabel}>{currentInstruction}</span>
                  {currentOutput && (
                    <div style={styles.routeButtons}>
                      <button
                        onClick={handleCopyText}
                        style={styles.routeBtn}
                      >
                        {t('button.copy_text')}
                      </button>
                      <button
                        onClick={() => {
                          if (!currentOutput) return;
                          try {
                            const subject = encodeURIComponent(t('screenshots.share.title'));
                            const body = encodeURIComponent(currentOutput);
                            window.open(`mailto:?subject=${subject}&body=${body}`);
                          } catch (err) {
                            console.error('Email failed:', err);
                            alert(t('toast.share_error'));
                          }
                        }}
                        style={styles.routeBtn}
                      >
                        {t('button.email')}
                      </button>
                    </div>
                  )}
                </div>
                {executing ? (
                  <div style={styles.outputLoading}>
                    <div style={styles.spinner} />
                    <span style={{ color: colors.textSecondary, fontFamily: typography.fontFamily, fontSize: typography.sizes.sm }}>
                      {t('screenshots.executing')}
                    </span>
                    <button onClick={handleCancelInstruction} style={styles.routeBtn}>
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <textarea
                    value={currentOutput}
                    onChange={(e) => setCurrentOutput(e.target.value)}
                    style={styles.outputText}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function extractLocalFilePath(uri: string): string {
  return localFileUriToPath(uri);
}

const ScreenshotSidebarRow = memo(function ScreenshotSidebarRow({
  photo,
  top,
  isDone,
  isSelected,
  isActive,
  onActivate,
  onToggleSelection,
  onDelete,
  deleteTitle,
  scrollRoot,
}: {
  photo: Photo;
  top: number;
  isDone: boolean;
  isSelected: boolean;
  isActive: boolean;
  onActivate: (photoId: string | null) => void;
  onToggleSelection: (id: string, e?: React.MouseEvent) => void;
  onDelete: (ids: string[], e?: React.MouseEvent) => Promise<void>;
  deleteTitle: string;
  scrollRoot: HTMLDivElement | null;
}) {
  const handleActivate = useCallback(() => {
    onActivate(photo.id);
  }, [onActivate, photo.id]);

  const handleToggle = useCallback((event: React.MouseEvent) => {
    onToggleSelection(photo.id, event);
  }, [onToggleSelection, photo.id]);

  const handleDeleteClick = useCallback((event: React.MouseEvent) => {
    void onDelete([photo.id], event);
  }, [onDelete, photo.id]);

  return (
    <div
      onClick={handleActivate}
      style={{
        ...styles.thumbRow,
        top: `${top}px`,
        ...(isActive ? styles.thumbItemActive : {}),
      }}
    >
      <div
        style={styles.checkboxWrap}
        onClick={handleToggle}
      >
        <div style={{
          ...styles.checkbox,
          backgroundColor: isSelected ? colors.accent : 'transparent',
          borderColor: isSelected ? colors.accent : colors.border,
        }}>
          {isSelected && <span style={styles.checkboxCheck}>✓</span>}
        </div>
      </div>
      <div style={styles.thumbWrap}>
        <ScreenshotSidebarThumb
          filePath={extractLocalFilePath(photo.uri)}
          alt={photo.filename}
          initialSrc={photo.thumbnailUri}
          scrollRoot={scrollRoot}
        />
        {isDone && <span style={styles.doneBadge}>✓</span>}
      </div>
      <span style={styles.thumbName}>{photo.filename}</span>
      <button
        onClick={handleDeleteClick}
        style={styles.deleteIconBtn}
        title={deleteTitle}
      >
        🗑
      </button>
    </div>
  );
}, (previous, next) =>
  previous.photo === next.photo
  && previous.top === next.top
  && previous.isDone === next.isDone
  && previous.isSelected === next.isSelected
  && previous.isActive === next.isActive
  && previous.scrollRoot === next.scrollRoot
);

const ScreenshotSidebarThumb = memo(function ScreenshotSidebarThumb({
  filePath,
  alt,
  initialSrc,
  scrollRoot,
}: {
  filePath: string;
  alt: string;
  initialSrc?: string;
  scrollRoot: HTMLDivElement | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const { src } = usePhotoThumbnail(filePath, shouldLoad, initialSrc);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { root: scrollRoot },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [scrollRoot]);

  return (
    <div ref={containerRef} style={styles.thumbImageFrame}>
      {src ? (
        <img src={src} alt={alt} style={styles.thumbImg} loading="lazy" decoding="async" />
      ) : (
        <div style={styles.thumbPlaceholder} />
      )}
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    background: colors.background,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.36)',
    padding: spacing.xl,
  },
  confirmDialog: {
    width: 'min(520px, 100%)',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.lg,
    padding: spacing.xl,
    boxShadow: '0 20px 50px rgba(15, 23, 42, 0.24)',
  },
  confirmTitle: {
    margin: 0,
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: typography.sizes.lg,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
  },
  confirmBody: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    lineHeight: 1.6,
    fontFamily: typography.fontFamily,
  },
  confirmActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
    flexWrap: 'wrap',
  },
  confirmSecondaryBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  confirmPrimaryBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.accent,
    border: 'none',
    borderRadius: radius.sm,
    color: colors.textOnStrong,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
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
    minWidth: '360px',
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
  },
  errorText: {
    margin: 0,
    fontSize: typography.sizes.sm,
    color: colors.danger,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    whiteSpace: 'pre-wrap',
  },
  primaryBtn: {
    padding: `${spacing.sm} ${spacing.xl}`,
    background: colors.accent,
    border: 'none',
    borderRadius: radius.md,
    color: colors.textOnStrong,
    fontSize: typography.sizes.md,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  sidebar: {
    width: '200px',
    flexShrink: 0,
    borderRight: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    background: colors.surface,
  },
  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.sm} ${spacing.md}`,
    borderBottom: `1px solid ${colors.border}`,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: colors.textSecondary,
    fontSize: '18px',
    fontWeight: '700',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  sidebarTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '600',
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  sidebarTitleBlock: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  sidebarRange: {
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.xs,
    lineHeight: 1.35,
  },
  doneBtn: {
    padding: '2px 8px',
    background: colors.accent,
    border: 'none',
    borderRadius: '999px',
    color: colors.textOnStrong,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  thumbList: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
  },
  thumbViewport: {
    position: 'relative',
    width: '100%',
  },
  thumbItem: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '6px',
    background: 'none',
    border: '1px solid transparent',
    borderRadius: radius.sm,
    cursor: 'pointer',
    textAlign: 'left',
  },
  thumbRow: {
    position: 'absolute',
    left: '4px',
    right: '4px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: '6px',
    background: 'none',
    border: '1px solid transparent',
    borderRadius: radius.sm,
    cursor: 'pointer',
    textAlign: 'left',
  },
  thumbItemActive: {
    background: colors.surfaceElevated,
    borderColor: colors.border,
  },
  thumbWrap: { position: 'relative', flexShrink: 0 },
  thumbImageFrame: {
    width: '48px',
    height: '48px',
    borderRadius: '4px',
    overflow: 'hidden',
    background: colors.surfaceElevated,
  },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    background: colors.surfaceElevated,
  },
  thumbImg: {
    width: '48px',
    height: '48px',
    objectFit: 'cover',
    borderRadius: '4px',
  },
  doneBadge: {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    width: '16px',
    height: '16px',
    background: colors.success,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    color: colors.textOnStrong,
    fontWeight: '700',
  },
  thumbName: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  processor: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'visible',
  },
  noSelection: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewArea: {
    flex: '0 0 40%',
    position: 'relative',
    background: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderBottom: `1px solid ${colors.border}`,
  },
  previewImg: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
  previewLoadingOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.25)',
    pointerEvents: 'none',
  },
  typeBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    display: 'flex',
    gap: spacing.xs,
    padding: '4px 10px',
    border: '1px solid',
    borderRadius: '999px',
    background: colors.surface,
  },
  instructionArea: {
    padding: spacing.md,
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  errorBox: {
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.sm,
    background: colors.dangerDim,
    color: colors.danger,
    border: `1px solid ${colors.danger}`,
    borderRadius: radius.md,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamily,
    whiteSpace: 'pre-wrap',
  },
  presetGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  presetBtn: {
    padding: '6px 12px',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: '999px',
    color: colors.text,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
    transition: 'background 0.1s',
  },
  modelRouteBox: {
    padding: `${spacing.xs} ${spacing.sm}`,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fontFamily,
  },
  modelSelect: {
    padding: `${spacing.xs} ${spacing.sm}`,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fontFamily,
    outline: 'none',
  },
  modelRouteBoxWarning: {
    background: colors.dangerDim,
    borderColor: colors.danger,
    color: colors.danger,
  },
  customRow: {
    display: 'flex',
    gap: spacing.sm,
  },
  customInput: {
    flex: 1,
    padding: `${spacing.xs} ${spacing.sm}`,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamily,
    outline: 'none',
  },
  executeBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.accent,
    border: 'none',
    borderRadius: radius.sm,
    color: '#FFFFFF',
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  outputArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'visible',
    position: 'relative',
    zIndex: 1,
  },
  outputHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.surface,
  },
  outputLabel: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  routeButtons: {
    display: 'flex',
    gap: spacing.xs,
  },
  routeBtn: {
    padding: '4px 10px',
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: '999px',
    color: colors.text,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  outputLoading: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  spinner: {
    width: '20px',
    height: '20px',
    borderTop: `2px solid ${colors.accent}`,
    borderRight: `2px solid ${colors.border}`,
    borderBottom: `2px solid ${colors.border}`,
    borderLeft: `2px solid ${colors.border}`,
    borderRadius: '50%',
  },
  outputText: {
    flex: 1,
    padding: spacing.md,
    background: 'transparent',
    border: 'none',
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamily,
    resize: 'none',
    outline: 'none',
    lineHeight: '1.6',
    zIndex: 10,
    userSelect: 'text',
    pointerEvents: 'auto',
  },
  checkboxWrap: {
    padding: '4px',
    cursor: 'pointer',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    border: '2px solid',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },
  checkboxCheck: {
    color: colors.textOnStrong,
    fontSize: '12px',
    fontWeight: 'bold',
  },
  deleteIconBtn: {
    padding: '4px 8px',
    background: 'none',
    border: 'none',
    color: colors.textTertiary,
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    opacity: 0.6,
    transition: 'opacity 0.15s, color 0.15s',
    ':hover': {
      opacity: 1,
      color: colors.danger,
    },
  },
  bulkActions: {
    padding: spacing.md,
    borderTop: `1px solid ${colors.border}`,
    background: colors.surface,
  },
  bulkDeleteBtn: {
    width: '100%',
    padding: `${spacing.sm} ${spacing.md}`,
    background: colors.danger,
    border: 'none',
    borderRadius: radius.md,
    color: colors.textOnStrong,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
};
