import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { colors, typography, spacing, radius } from '../theme';
import type { CullingItem } from '@photo-manager/shared';
import { localFileUriToPath, useTranslation } from '@photo-manager/shared';
import { usePhotoThumbnail } from '../hooks/usePhotoThumbnail';

type Props = {
  items: CullingItem[];
  currentIndex: number;
  overlay: 'keep' | 'delete' | null;
  onKeep: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onJumpTo: (index: number) => void;
};

const STRIP_ITEM_HEIGHT = 154;
const STRIP_OVERSCAN = 2;
const PREVIEW_SIZE = 1280;

export function FullscreenCulling({
  items,
  currentIndex,
  overlay,
  onKeep,
  onDelete,
  onUndo,
  onJumpTo,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [zoomed, setZoomed] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);
  const [stripScrollTop, setStripScrollTop] = useState(0);
  const [stripHeight, setStripHeight] = useState(600);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const currentItem = items[currentIndex];
  const currentFilePath = currentItem ? localFileUriToPath(currentItem.photo.uri) : '';
  const preview = usePhotoThumbnail(
    currentFilePath,
    Boolean(currentItem),
    currentItem?.photo.thumbnailUri,
    PREVIEW_SIZE,
    true,
  );

  useEffect(() => {
    setZoomed(false);
    setOriginalFailed(false);
    const strip = stripRef.current;
    if (!strip) return;
    const itemTop = currentIndex * STRIP_ITEM_HEIGHT;
    const itemBottom = itemTop + STRIP_ITEM_HEIGHT;
    if (itemTop < strip.scrollTop) {
      strip.scrollTop = itemTop;
    } else if (itemBottom > strip.scrollTop + strip.clientHeight) {
      strip.scrollTop = itemBottom - strip.clientHeight;
    }
  }, [currentIndex]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const updateHeight = () => setStripHeight(strip.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  const visibleItems = useMemo(() => {
    const start = Math.max(0, Math.floor(stripScrollTop / STRIP_ITEM_HEIGHT) - STRIP_OVERSCAN);
    const end = Math.min(
      items.length,
      Math.ceil((stripScrollTop + stripHeight) / STRIP_ITEM_HEIGHT) + STRIP_OVERSCAN,
    );
    return items.slice(start, end).map((item, offset) => ({
      item,
      index: start + offset,
    }));
  }, [items, stripHeight, stripScrollTop]);

  const handleImageClick = useCallback(() => {
    setZoomed((z) => !z);
  }, []);

  if (!currentItem) return <div />;

  return (
    <div style={styles.container}>
      {/* Left: full preview */}
      <div style={styles.previewPane} onClick={handleImageClick}>
        {(zoomed && !originalFailed ? currentItem.photo.uri : preview.src) ? (
          <img
            src={zoomed && !originalFailed ? currentItem.photo.uri : preview.src ?? undefined}
            alt={currentItem.photo.filename}
            onError={() => {
              if (zoomed) setOriginalFailed(true);
            }}
            style={{
              ...styles.previewImg,
              cursor: zoomed ? 'zoom-out' : 'zoom-in',
              objectFit: 'contain',
            }}
          />
        ) : preview.status === 'failed' ? (
          <button
            type="button"
            style={styles.previewError}
            onClick={(event) => {
              event.stopPropagation();
              preview.retry();
            }}
          >
            {t('common.retry')}
          </button>
        ) : (
          <div style={styles.previewLoading} />
        )}

        {items.slice(Math.max(0, currentIndex - 2), currentIndex + 3).map((item) => (
          item.photo.id === currentItem.photo.id
            ? null
            : <PreviewPreloader key={item.photo.id} item={item} />
        ))}

        {/* Decision overlay */}
        {overlay && (
          <div
            style={{
              ...styles.overlay,
              background: overlay === 'keep' ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)',
            }}
          >
            <span style={styles.overlayIcon}>{overlay === 'keep' ? '✓' : '✗'}</span>
          </div>
        )}

        {/* Bottom action buttons */}
        <div style={styles.bottomButtons}>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={styles.deleteBtn}
          >
            ✗ {t('common.delete')}
            <span style={styles.keyHint}>←</span>
          </button>
          <div style={styles.centerInfo}>
            <span style={styles.filename}>{currentItem.photo.filename}</span>
            <span style={styles.progress}>
              {t('culling.progress', { current: currentIndex + 1, total: items.length })}
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onKeep(); }}
            style={styles.keepBtn}
          >
            <span style={styles.keyHint}>→</span>
            {t('common.keep')} ✓
          </button>
        </div>
      </div>

      {/* Right: thumbnail strip */}
      <div style={styles.strip}>
        <div style={styles.stripHeader}>
          <button onClick={onUndo} style={styles.undoBtn} title={t('common.shortcuts.undo', { shortcut: '⌘Z' })}>
            ↩
          </button>
        </div>

        <div
          ref={stripRef}
          style={styles.thumbnails}
          onScroll={(event) => setStripScrollTop(event.currentTarget.scrollTop)}
        >
          <div style={{ ...styles.stripCanvas, height: `${items.length * STRIP_ITEM_HEIGHT}px` }}>
          {visibleItems.map(({ item, index: idx }) => (
            <button
              key={item.photo.id}
              onClick={() => onJumpTo(idx)}
              style={{
                ...styles.thumb,
                position: 'absolute',
                top: `${idx * STRIP_ITEM_HEIGHT}px`,
                ...(idx === currentIndex ? styles.thumbActive : {}),
              }}
            >
              <StripThumbnail item={item} />
              {item.decision !== 'pending' && (
                <div style={styles.thumbBadge}>
                  <span style={{ color: item.decision === 'keep' ? colors.success : colors.danger, fontSize: '10px' }}>
                    {item.decision === 'keep' ? '✓' : '✗'}
                  </span>
                </div>
              )}
            </button>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewPreloader({ item }: { item: CullingItem }): null {
  usePhotoThumbnail(
    localFileUriToPath(item.photo.uri),
    true,
    item.photo.thumbnailUri,
    PREVIEW_SIZE,
    true,
  );
  return null;
}

function StripThumbnail({ item }: { item: CullingItem }): React.JSX.Element {
  const { src } = usePhotoThumbnail(localFileUriToPath(item.photo.uri), true, item.photo.thumbnailUri);
  return src ? (
    <img
      src={src}
      alt={item.photo.filename}
      style={{
        ...styles.thumbImg,
        opacity: item.decision !== 'pending' ? 0.4 : 1,
      }}
    />
  ) : (
    <div style={styles.thumbPlaceholder} />
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    background: '#000',
  },
  previewPane: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    cursor: 'zoom-in',
  },
  previewImg: {
    maxWidth: '100%',
    maxHeight: '100%',
    userSelect: 'none',
  },
  previewLoading: {
    width: '48px',
    height: '48px',
    border: `3px solid ${colors.border}`,
    borderTopColor: colors.accent,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  previewError: {
    padding: `${spacing.sm} ${spacing.lg}`,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    cursor: 'pointer',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    transition: 'background 0.15s',
  },
  overlayIcon: {
    fontSize: '100px',
    opacity: 0.85,
  },
  bottomButtons: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.md} ${spacing.xl}`,
    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
  },
  deleteBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.sm} ${spacing.xl}`,
    background: colors.dangerDim,
    border: `1px solid ${colors.danger}50`,
    borderRadius: radius.md,
    color: colors.danger,
    fontSize: typography.sizes.md,
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  keepBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.sm} ${spacing.xl}`,
    background: colors.successDim,
    border: `1px solid ${colors.success}50`,
    borderRadius: radius.md,
    color: colors.success,
    fontSize: typography.sizes.md,
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  keyHint: {
    padding: '1px 6px',
    background: 'rgba(255,255,255,0.1)',
    borderRadius: '4px',
    fontSize: typography.sizes.xs,
    fontFamily: 'monospace',
  },
  centerInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  },
  filename: {
    fontSize: typography.sizes.sm,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: typography.fontFamily,
  },
  progress: {
    fontSize: typography.sizes.xs,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: typography.fontFamily,
  },
  strip: {
    width: '160px',
    flexShrink: 0,
    background: colors.surface,
    borderLeft: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  stripHeader: {
    padding: spacing.sm,
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    justifyContent: 'center',
  },
  undoBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: '16px',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  thumbnails: {
    flex: 1,
    overflowY: 'auto',
    position: 'relative',
  },
  stripCanvas: {
    position: 'relative',
    width: '100%',
  },
  thumb: {
    position: 'relative',
    left: '4px',
    right: '4px',
    height: '150px',
    background: 'none',
    border: '2px solid transparent',
    borderRadius: radius.sm,
    padding: 0,
    cursor: 'pointer',
    overflow: 'hidden',
    flexShrink: 0,
  },
  thumbActive: {
    borderColor: colors.accent,
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    background: colors.surfaceElevated,
  },
  thumbBadge: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    width: '18px',
    height: '18px',
    background: 'rgba(0,0,0,0.7)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
