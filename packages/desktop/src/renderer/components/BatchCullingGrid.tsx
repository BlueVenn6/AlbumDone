import React, { useState, useCallback, useEffect, useRef } from 'react';
import { colors, typography, spacing, radius } from '../theme';
import type { CullingItem } from '@photo-manager/shared';
import { localFileUriToPath, useTranslation } from '@photo-manager/shared';
import { usePhotoThumbnail } from '../hooks/usePhotoThumbnail';

type Props = {
  items: CullingItem[];
  onDecide: (id: string, decision: 'keep' | 'delete') => void;
  onBulkDecide: (ids: string[], decision: 'keep' | 'delete') => void;
  onUndo: () => void;
};

export function BatchCullingGrid({ items, onDecide, onBulkDecide, onUndo }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(items.filter((i) => i.decision === 'pending').map((i) => i.photo.id)));
  }, [items]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleBulkKeep = useCallback(() => {
    onBulkDecide([...selected], 'keep');
    setSelected(new Set());
  }, [selected, onBulkDecide]);

  const handleBulkDelete = useCallback(() => {
    onBulkDecide([...selected], 'delete');
    setSelected(new Set());
  }, [selected, onBulkDecide]);

  const pending = items.filter((i) => i.decision === 'pending');
  const reviewed = items.filter((i) => i.decision !== 'pending').length;

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <span style={styles.statusText}>
            {t('culling.reviewedProgress', { reviewed, total: items.length })}
          </span>
          <button onClick={onUndo} style={styles.undoBtn} title={t('common.shortcuts.undo', { shortcut: '⌘Z' })}>
            ↩ {t('common.undo')}
          </button>
        </div>

        {selected.size > 0 ? (
          <div style={styles.selectionActions}>
            <span style={styles.selectedCount}>
              {t('culling.selectedCount', { count: selected.size })}
            </span>
            <button onClick={handleBulkDelete} style={styles.bulkDeleteBtn}>
              ✗ {t('culling.bulkDelete', { count: selected.size })}
            </button>
            <button onClick={handleBulkKeep} style={styles.bulkKeepBtn}>
              ✓ {t('culling.bulkKeep', { count: selected.size })}
            </button>
            <button onClick={clearSelection} style={styles.clearBtn}>
              {t('culling.clear')}
            </button>
          </div>
        ) : (
          <div style={styles.selectionActions}>
            <button onClick={selectAll} style={styles.selectAllBtn}>
              {t('culling.selectAllPending')}
            </button>
          </div>
        )}
      </div>

      {/* Grid */}
      <div style={styles.grid}>
        {items.map((item) => (
          <GridCell
            key={item.photo.id}
            item={item}
            isSelected={selected.has(item.photo.id)}
            onToggleSelect={() => toggleSelect(item.photo.id)}
            onKeep={() => onDecide(item.photo.id, 'keep')}
            onDelete={() => onDecide(item.photo.id, 'delete')}
          />
        ))}
      </div>
    </div>
  );
}

function GridCell({
  item,
  isSelected,
  onToggleSelect,
  onKeep,
  onDelete,
}: {
  item: CullingItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  onKeep: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const [shouldLoadThumbnail, setShouldLoadThumbnail] = useState(false);
  const isPending = item.decision === 'pending';
  const filePath = extractLocalFilePath(item.photo.uri);
  const { src } = usePhotoThumbnail(filePath, shouldLoadThumbnail, item.photo.thumbnailUri);

  useEffect(() => {
    const element = cellRef.current;
    if (!element || shouldLoadThumbnail) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoadThumbnail(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: '360px' },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [shouldLoadThumbnail]);

  return (
    <div
      ref={cellRef}
      style={{
        ...styles.cell,
        ...(isSelected ? styles.cellSelected : {}),
        opacity: isPending ? 1 : 0.5,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {src ? (
        <img src={src} alt={item.photo.filename} style={styles.cellImg} loading="lazy" decoding="async" />
      ) : (
        <div style={styles.cellPlaceholder} />
      )}

      {/* Decision badge */}
      {!isPending && (
        <div style={{
          ...styles.decisionBadge,
          background: item.decision === 'keep' ? colors.successDim : colors.dangerDim,
          borderColor: item.decision === 'keep' ? colors.success : colors.danger,
        }}>
          <span style={{ color: item.decision === 'keep' ? colors.success : colors.danger }}>
            {item.decision === 'keep' ? '✓' : '✗'}
          </span>
        </div>
      )}

      {/* Select checkbox */}
      {isPending && (
        <button
          onClick={onToggleSelect}
          style={{
            ...styles.checkbox,
            background: isSelected ? colors.accent : 'rgba(0,0,0,0.5)',
            borderColor: isSelected ? colors.accent : 'rgba(255,255,255,0.3)',
          }}
        >
          {isSelected && <span style={{ color: colors.textOnStrong, fontSize: '10px', fontWeight: '700' }}>✓</span>}
        </button>
      )}

      {/* Hover action buttons */}
      {hovered && isPending && !isSelected && (
        <div style={styles.hoverActions}>
          <button onClick={onDelete} style={styles.hoverDelete} title={t('culling.deleteHint')}>
            ✗
          </button>
          <button onClick={onKeep} style={styles.hoverKeep} title={t('culling.keepHint')}>
            ✓
          </button>
        </div>
      )}

      {/* AI suggestion badge */}
      {item.aiDecision !== 'pending' && isPending && (
        <div style={styles.aiSuggestion}>
          <span style={{
            fontSize: '10px',
            color: item.aiDecision === 'keep' ? colors.success : colors.danger,
            fontFamily: typography.fontFamily,
          }}>
            {t('culling.aiSuggestion', { decision: item.aiDecision })}
          </span>
        </div>
      )}
    </div>
  );
}

function extractLocalFilePath(uri: string): string {
  return localFileUriToPath(uri);
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: colors.background,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.surface,
  },
  toolbarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  undoBtn: {
    padding: `${spacing.xs} ${spacing.sm}`,
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  selectionActions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  selectedCount: {
    fontSize: typography.sizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  bulkDeleteBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.dangerDim,
    border: `1px solid ${colors.danger}50`,
    borderRadius: radius.sm,
    color: colors.danger,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  bulkKeepBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.successDim,
    border: `1px solid ${colors.success}50`,
    borderRadius: radius.sm,
    color: colors.success,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  clearBtn: {
    padding: `${spacing.xs} ${spacing.sm}`,
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  selectAllBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  grid: {
    flex: 1,
    overflowY: 'auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '2px',
    padding: '2px',
  },
  cell: {
    position: 'relative',
    aspectRatio: '1',
    overflow: 'hidden',
    cursor: 'pointer',
  },
  cellSelected: {
    boxShadow: `inset 0 0 0 2px ${colors.accent}`,
  },
  cellImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  cellPlaceholder: {
    width: '100%',
    height: '100%',
    background: colors.surfaceElevated,
    display: 'block',
  },
  decisionBadge: {
    position: 'absolute',
    top: '6px',
    left: '6px',
    width: '24px',
    height: '24px',
    border: '1px solid',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
  },
  checkbox: {
    position: 'absolute',
    top: '6px',
    left: '6px',
    width: '20px',
    height: '20px',
    border: '1.5px solid',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    appearance: 'none',
    outline: 'none',
    boxShadow: 'none',
  },
  hoverActions: {
    position: 'absolute',
    bottom: '8px',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  hoverDelete: {
    padding: '5px 14px',
    background: colors.dangerDim,
    border: `1px solid ${colors.danger}`,
    borderRadius: '999px',
    color: colors.danger,
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  hoverKeep: {
    padding: '5px 14px',
    background: colors.successDim,
    border: `1px solid ${colors.success}`,
    borderRadius: '999px',
    color: colors.success,
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  aiSuggestion: {
    position: 'absolute',
    bottom: '6px',
    right: '6px',
    padding: '2px 6px',
    background: 'rgba(0,0,0,0.6)',
    borderRadius: '4px',
  },
};
