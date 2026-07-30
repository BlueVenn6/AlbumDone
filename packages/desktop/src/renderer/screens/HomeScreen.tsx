import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, typography, spacing, radius, shadows } from '../theme';
import {
  createAlbumSnapshot,
  getLocalizedAlbumTitle,
  usePhotoStore,
  useTranslation,
} from '@photo-manager/shared';
import {
  applyCachedAlbumCounts,
  setCachedAlbumCount,
  subscribeToAlbumCountUpdates,
} from '../utils/albumCountCache';
import { setCachedAlbumPhotos } from '../utils/photoSessionCache';

type Album = {
  id: string;
  title: string;
  photoCount: number;
  totalBytes?: number;
};

type ModeId = 'dedup' | 'culling' | 'screenshots' | 'yearInReview';

type ModeOption = {
  id: ModeId;
  icon: string;
  route: string;
  color: string;
  tint: string;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'dedup',
    icon: '▣',
    route: '/deduplication',
    color: colors.accent,
    tint: colors.accentDim,
  },
  {
    id: 'culling',
    icon: '↔',
    route: '/culling',
    color: colors.secondary,
    tint: '#EAF1FF',
  },
  {
    id: 'screenshots',
    icon: '⌗',
    route: '/screenshots',
    color: '#EA580C',
    tint: '#FFF0E6',
  },
  {
    id: 'yearInReview',
    icon: '▣',
    route: '/year-in-review',
    color: '#D89200',
    tint: colors.warningDim,
  },
];

function formatStorageBytes(totalBytes: number | undefined): string {
  if (totalBytes === undefined || !Number.isFinite(totalBytes) || totalBytes < 0) return '--';
  if (totalBytes >= 1024 ** 3) {
    return `${(totalBytes / 1024 ** 3).toFixed(2)} GB`;
  }
  if (totalBytes >= 1024 ** 2) {
    return `${Math.max(0.01, totalBytes / 1024 ** 2).toFixed(2)} MB`;
  }
  if (totalBytes >= 1024) return `${(totalBytes / 1024).toFixed(1)} KB`;
  return `${totalBytes} B`;
}

export function HomeScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState('');
  const loadPhotos = usePhotoStore((state) => state.loadPhotos);
  const selectedAlbumId = usePhotoStore((state) => state.selectedAlbumId);
  const setSelectedAlbumId = usePhotoStore((state) => state.setSelectedAlbum);
  const selectedAlbumIdRef = useRef<string | null>(selectedAlbumId);

  useEffect(() => {
    selectedAlbumIdRef.current = selectedAlbumId;
  }, [selectedAlbumId]);

  const selectAlbum = useCallback((album: Album) => {
    setSelectedAlbum(album);
    if (selectedAlbumIdRef.current !== album.id) {
      selectedAlbumIdRef.current = album.id;
      setSelectedAlbumId(album.id);
    }
  }, [setSelectedAlbumId]);

  useEffect(() => {
    let isMounted = true;

    const loadAlbums = async () => {
      try {
        if (window.electronAPI) {
          const dirs = await window.electronAPI.getAlbums();
          if (!isMounted) return;
          const albumsWithCachedCounts = applyCachedAlbumCounts(dirs);
          setAlbums(albumsWithCachedCounts);
          setSelectedAlbum((current) => {
            if (!current) {
              const persistedAlbum = albumsWithCachedCounts.find(
                (album) => album.id === selectedAlbumIdRef.current,
              );
              return persistedAlbum ?? albumsWithCachedCounts[0] ?? null;
            }
            return albumsWithCachedCounts.find((album) => album.id === current.id) ?? current;
          });
          setLoading(false);
          const refreshRecentAlbumCounts = async () => {
            for (const album of dirs) {
              if (!isMounted) return;
              if (album.id === selectedAlbumIdRef.current) {
                continue;
              }
              try {
                const actualStats = await window.electronAPI.getAlbumStats(album.id);
                if (!isMounted) return;
                const currentCachedCount = applyCachedAlbumCounts([album])[0]?.photoCount;
                if (
                  actualStats.photoCount === currentCachedCount
                  && actualStats.totalBytes === album.totalBytes
                ) continue;
                const updated = await window.electronAPI.saveAlbum(
                  album.id,
                  actualStats.photoCount,
                  actualStats.totalBytes,
                );
                if (!isMounted) return;
                setCachedAlbumCount(album.id, actualStats.photoCount, actualStats.totalBytes);
                const updatedWithCachedCounts = applyCachedAlbumCounts(updated);
                setAlbums(updatedWithCachedCounts);
                setSelectedAlbum((current) => {
                  if (current?.id !== album.id) return current;
                  return updatedWithCachedCounts.find((item) => item.id === album.id) ?? {
                    ...current,
                    photoCount: actualStats.photoCount,
                    totalBytes: actualStats.totalBytes,
                  };
                });
              } catch (err) {
                console.error('[home] failed to refresh album count:', err);
              }
            }
          };
          window.setTimeout(() => {
            void refreshRecentAlbumCounts();
          }, 1200);
        } else {
          const fallbackAlbums = [
            { id: '1', title: t('common.systemFolders.downloads'), photoCount: 689 },
            { id: '2', title: t('home.allFiles'), photoCount: 4001 },
            { id: '3', title: t('common.systemFolders.camera'), photoCount: 91 },
            { id: '4', title: t('common.systemFolders.screenshots'), photoCount: 16 },
            { id: '5', title: t('common.systemFolders.favorites'), photoCount: 48 },
          ];
          setAlbums(fallbackAlbums);
          setSelectedAlbum(
            fallbackAlbums.find((album) => album.id === selectedAlbumIdRef.current)
              ?? fallbackAlbums[1]
              ?? fallbackAlbums[0]
              ?? null,
          );
          setLoading(false);
        }
      } catch (err) {
        console.error('[home] failed to load albums:', err);
        setError(err instanceof Error ? err.message : t('home.errors.loadAlbums'));
        setAlbums([]);
        setLoading(false);
      }
    };
    void loadAlbums();

    return () => {
      isMounted = false;
    };
  }, [t]);

  useEffect(() => {
    return subscribeToAlbumCountUpdates((albumId, count, totalBytes) => {
      setAlbums((current) =>
        current.map((album) =>
          album.id === albumId
            ? { ...album, photoCount: count, ...(totalBytes === undefined ? {} : { totalBytes }) }
            : album,
        ),
      );
      setSelectedAlbum((current) =>
        current?.id === albumId
          ? { ...current, photoCount: count, ...(totalBytes === undefined ? {} : { totalBytes }) }
          : current,
      );
    });
  }, []);

  const selectedTitle = selectedAlbum
    ? getLocalizedAlbumTitle(selectedAlbum.title, t)
    : t('home.allFiles');
  const selectedCount = selectedAlbum?.photoCount ?? 0;
  const selectedSize = useMemo(
    () => formatStorageBytes(selectedAlbum?.totalBytes),
    [selectedAlbum?.totalBytes],
  );

  const handleBrowseFolder = useCallback(async () => {
    if (browsing || !window.electronAPI) return;
    setBrowsing(true);
    setError('');
    try {
      const folderPath = await window.electronAPI.selectFolder();
      if (folderPath) {
        if (selectedAlbumIdRef.current !== folderPath) {
          selectedAlbumIdRef.current = folderPath;
          setSelectedAlbumId(folderPath);
        }
        const scanned = await window.electronAPI.getPhotos(folderPath, { mode: 'fast' });
        const snapshot = createAlbumSnapshot(folderPath, scanned, {
          belongsToAlbum: (photo, albumId) => photo.albumId === albumId,
        });
        setCachedAlbumPhotos(folderPath, snapshot.photos);
        loadPhotos(snapshot.photos);
        const count = snapshot.count;
        if (count === 0) {
          setError(t('home.errors.noReadablePhotos'));
        }

        const updated = await window.electronAPI.saveAlbum(folderPath, count, snapshot.totalBytes);
        setCachedAlbumCount(folderPath, count, snapshot.totalBytes);
        const updatedWithCachedCounts = applyCachedAlbumCounts(updated);
        setAlbums(updatedWithCachedCounts);
        const album = updatedWithCachedCounts.find((a) => a.id === folderPath) ?? {
          id: folderPath,
          title: folderPath.split(/[\\/]/).pop() || folderPath,
          photoCount: count,
          totalBytes: snapshot.totalBytes,
        };
        setSelectedAlbum(album);
      }
    } catch (err) {
      console.error('[home] failed to browse folder:', err);
      setError(err instanceof Error ? err.message : t('home.errors.openFolder'));
    } finally {
      setBrowsing(false);
    }
  }, [browsing, loadPhotos, setSelectedAlbumId, t]);

  const handleModeSelect = useCallback(
    (route: string) => {
      if (!selectedAlbum) return;
      navigate(route, { state: { albumId: selectedAlbum.id, albumTitle: selectedAlbum.title } });
    },
    [selectedAlbum, navigate],
  );

  return (
    <main style={styles.container}>
      <section style={styles.hero}>
        <div>
          <h1 style={styles.title}>{t('home.library')}</h1>
          <p style={styles.subtitle}>{t('home.manageFolders')}</p>
        </div>
        <button
          onClick={handleBrowseFolder}
          disabled={browsing}
          style={{ ...styles.browseBtn, opacity: browsing ? 0.68 : 1 }}
        >
          <span style={styles.buttonIcon}>■</span>
          {browsing ? t('common.loading') : t('home.browseFolder')}
        </button>
      </section>

      {error && <div style={styles.errorBox}>{error}</div>}

      <section style={styles.summaryCard}>
        <div style={styles.folderGlyph}>▰</div>
        <div style={styles.summaryPrimary}>
          <span style={styles.metaLabel}>{t('home.currentFolder')}</span>
          <strong style={styles.summaryTitle}>{selectedTitle}</strong>
          <span style={styles.summarySub}>{t('common.photoCount', { count: selectedCount })}</span>
        </div>
        <SummaryMetric icon="▣" label={t('home.totalPhotos')} value={selectedCount.toLocaleString()} />
        <SummaryMetric icon="▰" label={t('home.totalSize')} value={selectedSize} />
      </section>

      <section style={styles.modeGrid}>
        {MODE_OPTIONS.map((mode) => (
          <ModeCard
            key={mode.id}
            mode={mode}
            disabled={!selectedAlbum}
            onClick={() => handleModeSelect(mode.route)}
          />
        ))}
      </section>

      <section style={styles.foldersSection}>
        <h2 style={styles.sectionHeading}>{t('home.folders')}</h2>
        {loading ? (
          <div style={styles.loadingWrap}>
            <div style={styles.spinner} />
          </div>
        ) : (
          <div style={styles.albumList}>
            {albums.map((album) => {
              const isSelected = selectedAlbum?.id === album.id;
              const title = getLocalizedAlbumTitle(album.title, t);
              return (
                <button
                  key={album.id}
                  onClick={() => selectAlbum(album)}
                  style={{
                    ...styles.albumItem,
                    ...(isSelected ? styles.albumItemActive : {}),
                  }}
                >
                  <span style={{ ...styles.albumFolderIcon, color: isSelected ? colors.accent : colors.warning }}>
                    ▰
                  </span>
                  <span style={styles.albumInfo}>
                    <strong style={styles.albumTitle}>{title}</strong>
                    <span style={styles.albumCount}>
                      {t('common.photoCount', { count: album.photoCount })}
                    </span>
                  </span>
                  <span style={styles.albumSize}>{formatStorageBytes(album.totalBytes)}</span>
                  <span style={isSelected ? styles.selectedMark : styles.chevron}>
                    {isSelected ? '✓' : '›'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div style={styles.summaryMetric}>
      <span style={styles.metricIcon}>{icon}</span>
      <span>
        <span style={styles.metaLabel}>{label}</span>
        <strong style={styles.metricValue}>{value}</strong>
      </span>
    </div>
  );
}

function ModeCard({
  mode,
  disabled,
  onClick,
}: {
  mode: ModeOption;
  disabled: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const title =
    mode.id === 'yearInReview'
      ? t('yearInReview.title')
      : t(`home.modes.${mode.id}.title`);
  const subtitle =
    mode.id === 'yearInReview'
      ? t('yearInReviewSubtitle')
      : t(`home.modes.${mode.id}.subtitle`);
  const action =
    mode.id === 'yearInReview'
      ? t('yearInReviewAction')
      : t(`home.modes.${mode.id}.action`);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.modeCard,
        borderColor: hovered ? mode.color : colors.border,
        transform: hovered && !disabled ? 'translateY(-2px)' : 'none',
        opacity: disabled ? 0.56 : 1,
      }}
    >
      <span style={{ ...styles.modeIcon, color: mode.color, background: mode.tint }}>{mode.icon}</span>
      <strong style={{ ...styles.modeTitle, color: mode.color }}>{title}</strong>
      <span style={styles.modeSubtitle}>{subtitle}</span>
      <span style={{ ...styles.modeAction, color: mode.color, background: mode.tint }}>
        {action}
        <span>›</span>
      </span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100%',
    background: colors.background,
    overflowY: 'auto',
    padding: '44px 48px',
    fontFamily: typography.fontFamily,
  },
  hero: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginBottom: '34px',
  },
  title: {
    margin: 0,
    fontSize: '32px',
    lineHeight: '1.15',
    fontWeight: typography.weights.bold,
    color: colors.text,
  },
  subtitle: {
    margin: '10px 0 0',
    fontSize: '16px',
    color: colors.textSecondary,
  },
  browseBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    minWidth: '170px',
    padding: '13px 20px',
    background: colors.accent,
    border: 'none',
    borderRadius: radius.md,
    color: colors.textOnStrong,
    fontSize: '15px',
    fontWeight: typography.weights.bold,
    cursor: 'pointer',
    boxShadow: '0 10px 22px rgba(20,184,166,0.24)',
  },
  buttonIcon: {
    fontSize: '13px',
    lineHeight: 1,
  },
  errorBox: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    background: colors.dangerDim,
    color: colors.danger,
    border: `1px solid ${colors.danger}`,
    borderRadius: radius.md,
    fontSize: typography.sizes.sm,
  },
  summaryCard: {
    display: 'grid',
    gridTemplateColumns: '72px minmax(220px, 1fr) 210px 210px',
    alignItems: 'center',
    gap: '24px',
    minHeight: '126px',
    padding: '24px 32px',
    background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(230,248,245,0.72))',
    border: `1px solid ${colors.accent}`,
    borderRadius: radius.lg,
    boxShadow: shadows.sm,
    marginBottom: '24px',
  },
  folderGlyph: {
    width: '54px',
    height: '44px',
    borderRadius: '10px',
    background: colors.accent,
    color: colors.accent,
    boxShadow: 'inset 0 10px 20px rgba(255,255,255,0.22)',
  },
  summaryPrimary: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  metaLabel: {
    display: 'block',
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
  summaryTitle: {
    fontSize: '26px',
    color: colors.text,
    lineHeight: '1.15',
  },
  summarySub: {
    fontSize: '16px',
    color: colors.textSecondary,
  },
  summaryMetric: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    paddingLeft: '28px',
    borderLeft: `1px solid ${colors.border}`,
  },
  metricIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '7px',
    background: colors.accent,
    color: colors.textOnStrong,
    fontSize: '12px',
  },
  metricValue: {
    display: 'block',
    marginTop: '4px',
    fontSize: '20px',
    color: colors.text,
  },
  modeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: spacing.md,
    marginBottom: '24px',
  },
  modeCard: {
    minHeight: '280px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '28px 20px 20px',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.lg,
    boxShadow: shadows.md,
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, transform 0.15s ease',
  },
  modeIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '76px',
    height: '76px',
    borderRadius: '50%',
    fontSize: '31px',
    marginBottom: '22px',
  },
  modeTitle: {
    fontSize: '20px',
    lineHeight: '1.2',
    marginBottom: '14px',
  },
  modeSubtitle: {
    minHeight: '66px',
    fontSize: '15px',
    lineHeight: '1.45',
    color: colors.textSecondary,
  },
  modeAction: {
    width: '100%',
    minHeight: '40px',
    marginTop: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 14px',
    borderRadius: radius.md,
    fontSize: '14px',
    fontWeight: typography.weights.bold,
  },
  foldersSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionHeading: {
    margin: 0,
    color: colors.text,
    fontSize: '18px',
    fontWeight: typography.weights.bold,
  },
  loadingWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: `2px solid ${colors.border}`,
    borderTop: `2px solid ${colors.accent}`,
    borderRadius: '50%',
  },
  albumList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  albumItem: {
    width: '100%',
    minHeight: '74px',
    display: 'grid',
    gridTemplateColumns: '42px 1fr 110px 24px',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 22px',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    boxShadow: shadows.sm,
    cursor: 'pointer',
    color: colors.text,
    textAlign: 'left',
  },
  albumItemActive: {
    background: colors.accentDim,
    borderColor: colors.accent,
  },
  albumFolderIcon: {
    fontSize: '28px',
    lineHeight: 1,
  },
  albumInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  albumTitle: {
    color: colors.text,
    fontSize: '16px',
    fontWeight: typography.weights.bold,
  },
  albumCount: {
    color: colors.textSecondary,
    fontSize: '14px',
  },
  albumSize: {
    color: colors.textSecondary,
    fontSize: '14px',
    textAlign: 'right',
  },
  selectedMark: {
    color: colors.accent,
    fontSize: '20px',
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  chevron: {
    color: colors.textSecondary,
    fontSize: '28px',
    lineHeight: 1,
    textAlign: 'right',
  },
};
