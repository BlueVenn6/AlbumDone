import React, { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Photo, YearInReviewResult } from '@photo-manager/shared';
import { colors, typography, spacing, radius } from '../theme';
import { getRandomEncouragement, normalizeLocale, usePhotoStore, useTranslation } from '@photo-manager/shared';
import { getCachedAlbumPhotos, setCachedAlbumPhotos } from '../utils/photoSessionCache';

type RouteState = {
  albumId?: string;
  albumTitle?: string;
};

type TimeMode = 'rolling' | 'calendar';

function photosBelongToAlbum(photos: Photo[], albumId: string): boolean {
  return photos.length > 0 && photos.every((photo) => photo.albumId === albumId);
}

export function YearInReviewScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n, t } = useTranslation();
  const { albumId } = (location.state as RouteState) ?? {};
  const storePhotos = usePhotoStore((state) => state.photos);

  const [isGenerating, setIsGenerating] = useState(false);
  const [analyzingCount, setAnalyzingCount] = useState(0);
  const [result, setResult] = useState<YearInReviewResult | null>(null);
  const [error, setError] = useState('');
  const [encouragement, setEncouragement] = useState('');
  const [timeMode, setTimeMode] = useState<TimeMode>('rolling');

  const resultText = useMemo(() => {
    if (!result) return '';
    if (result.mode === 'scene') {
      return t('yearInReviewSceneResult', { months: result.monthsCovered });
    }
    return t('yearInReviewPersonResult', { months: result.monthsCovered });
  }, [result, t]);

  const handleGenerate = useCallback(async () => {
    if (!albumId || !window.electronAPI?.yearInReview?.generate || !window.electronAPI?.getPhotos) {
      setError(t('yearInReview.errors.selectFolder'));
      return;
    }

    setIsGenerating(true);
    setError('');
    setResult(null);
    setEncouragement('');
    setAnalyzingCount(0);

    try {
      const cachedPhotos = photosBelongToAlbum(storePhotos, albumId)
        ? storePhotos
        : getCachedAlbumPhotos(albumId);
      if (cachedPhotos && cachedPhotos.length > 0) {
        setAnalyzingCount(cachedPhotos.filter((photo) => photo.albumId === albumId).length);
      }
      const allPhotos = await window.electronAPI.getPhotos(albumId, { mode: 'fast' });
      setCachedAlbumPhotos(albumId, allPhotos);
      const photos = Array.from(
        new Set(
          allPhotos
            .filter((photo: Photo) => photo.albumId === albumId)
            .map((photo) => JSON.stringify({
              uri: photo.uri,
              filename: photo.filename,
              timestamp: photo.timestamp,
              width: photo.width,
              height: photo.height,
              fileSize: photo.fileSize,
              isScreenshot: photo.isScreenshot,
              thumbnailUri: photo.thumbnailUri,
            }))
            .filter((item) => item.length > 0),
        ),
      ).map((item) => JSON.parse(item) as {
        uri: string;
        filename: string;
        timestamp?: number;
        width?: number;
        height?: number;
        fileSize?: number;
        isScreenshot?: boolean;
        thumbnailUri?: string;
      });

      if (photos.length === 0) {
        throw new Error(t('yearInReview.errors.noReadablePhotos'));
      }

      setAnalyzingCount(photos.length);
      const generated = await window.electronAPI.yearInReview.generate(photos, timeMode);
      if (!generated.outputPath || generated.monthsCovered <= 0) {
        throw new Error(t('yearInReview.errors.notEnoughPhotos'));
      }
      setResult(generated);

      if (generated.mode === 'scene') {
        setEncouragement(getRandomEncouragement(normalizeLocale(i18n.language)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('yearInReview.errors.generateFailed'));
    } finally {
      setIsGenerating(false);
    }
  }, [albumId, i18n.language, storePhotos, t, timeMode]);

  const handleOpenFile = useCallback(async () => {
    if (!result?.outputPath || !window.electronAPI?.app?.openPath) {
      return;
    }

    const openResult = await window.electronAPI.app.openPath(result.outputPath);
    if (!openResult.success) {
      setError(openResult.error ?? t('yearInReview.errors.openFileFailed'));
    }
  }, [result?.outputPath, t]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backButton} onClick={() => navigate(-1)}>
          ← {t('common.back')}
        </button>
        <h1 style={styles.title}>{t('yearInReview.title')}</h1>
        <p style={styles.subtitle}>{t('yearInReviewSubtitle')}</p>
      </div>

      <div style={styles.panel}>
        <div style={styles.modeToggle}>
          <button
            style={{
              ...styles.modeToggleButton,
              ...(timeMode === 'rolling' ? styles.modeToggleButtonActive : {}),
            }}
            onClick={() => setTimeMode('rolling')}
            disabled={isGenerating}
          >
            {t('yearInReview.last12Months')}
          </button>
          <button
            style={{
              ...styles.modeToggleButton,
              ...(timeMode === 'calendar' ? styles.modeToggleButtonActive : {}),
            }}
            onClick={() => setTimeMode('calendar')}
            disabled={isGenerating}
          >
            {t('yearInReview.thisYear')}
          </button>
        </div>

        <button
          style={{
            ...styles.generateButton,
            opacity: isGenerating ? 0.6 : 1,
            cursor: isGenerating ? 'not-allowed' : 'pointer',
          }}
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? t('common.loading') : t('yearInReview.generate')}
        </button>

        {isGenerating && (
          <div style={styles.progressBox}>
            <div style={styles.spinner} />
            <span style={styles.progressText}>{t('yearInReview.analyzingPhotos', { count: analyzingCount })}</span>
          </div>
        )}

        {error && <div style={styles.errorBox}>{error}</div>}

        {result && (
          <div style={styles.resultBox}>
            <div style={styles.resultLabel}>{t('yearInReviewDone')}</div>
            <div style={styles.resultText}>{resultText}</div>
            {result.mode === 'scene' && encouragement && (
              <div style={styles.encouragementText}>{encouragement}</div>
            )}
            <div style={styles.resultPath}>{result.outputPath}</div>
            {result.moments && result.moments.length > 0 && (
              <div style={styles.momentList}>
                {result.moments.map((moment) => (
                  <div key={`${moment.month}-${moment.coverPhoto.id}`} style={styles.momentItem}>
                    <div style={styles.momentHeader}>
                      <span>{moment.month}</span>
                      <span>{moment.score}</span>
                    </div>
                    <div style={styles.momentTitle}>{moment.momentTitle}</div>
                    <div style={styles.momentWhy}>{moment.whySelected.join(t('yearInReview.reasonsSeparator'))}</div>
                  </div>
                ))}
              </div>
            )}
            {result.emptyMonths && result.emptyMonths.length > 0 && (
              <div style={styles.emptyMonths}>
                {t('yearInReview.emptyMonths', { months: result.emptyMonths.join(t('yearInReview.reasonsSeparator')) })}
              </div>
            )}
            <button style={styles.openFileButton} onClick={handleOpenFile}>
              {t('yearInReviewOpenFile')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: colors.background,
    overflowY: 'auto',
  },
  header: {
    padding: `${spacing.xl} ${spacing.xl} ${spacing.md}`,
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  backButton: {
    width: 'fit-content',
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.surface,
    color: colors.textSecondary,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
    cursor: 'pointer',
  },
  title: {
    margin: 0,
    color: colors.text,
    fontSize: typography.sizes.xxl,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
  },
  subtitle: {
    margin: 0,
    color: colors.textSecondary,
    fontSize: typography.sizes.md,
    fontFamily: typography.fontFamily,
  },
  panel: {
    padding: spacing.xl,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
    maxWidth: '900px',
  },
  modeToggle: {
    display: 'flex',
    gap: spacing.sm,
  },
  modeToggleButton: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.surface,
    color: colors.textSecondary,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
    cursor: 'pointer',
  },
  modeToggleButtonActive: {
    background: colors.accentDim,
    color: colors.textSecondary,
    border: `1px solid ${colors.accent}80`,
  },
  generateButton: {
    width: 'fit-content',
    padding: `${spacing.sm} ${spacing.xl}`,
    background: colors.accent,
    color: '#FFFFFF',
    border: 'none',
    borderRadius: radius.md,
    fontSize: typography.sizes.md,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
  },
  progressBox: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.sizes.md,
    fontFamily: typography.fontFamily,
  },
  spinner: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: `2px solid ${colors.border}`,
    borderTopColor: colors.accent,
    animation: 'spin 1s linear infinite',
  },
  progressText: {
    color: colors.textSecondary,
  },
  errorBox: {
    padding: spacing.md,
    background: colors.dangerDim,
    color: colors.danger,
    borderRadius: radius.md,
    border: `1px solid ${colors.danger}`,
    fontFamily: typography.fontFamily,
  },
  resultBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
    padding: spacing.lg,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.lg,
  },
  resultLabel: {
    color: colors.success,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
    fontFamily: typography.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  resultText: {
    color: colors.text,
    fontSize: typography.sizes.lg,
    fontWeight: '600',
    fontFamily: typography.fontFamily,
    lineHeight: 1.45,
  },
  encouragementText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.md,
    fontFamily: typography.fontFamily,
    lineHeight: 1.6,
    borderLeft: `3px solid ${colors.accent}`,
    paddingLeft: spacing.md,
  },
  resultPath: {
    color: colors.textTertiary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamily,
    wordBreak: 'break-all',
  },
  momentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  },
  momentItem: {
    padding: spacing.sm,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
  },
  momentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    color: colors.textTertiary,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fontFamily,
  },
  momentTitle: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
    marginTop: '4px',
  },
  momentWhy: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamily,
    marginTop: '4px',
  },
  emptyMonths: {
    color: colors.textTertiary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamily,
  },
  openFileButton: {
    width: 'fit-content',
    marginTop: spacing.xs,
    padding: `${spacing.sm} ${spacing.lg}`,
    background: colors.surfaceElevated,
    color: colors.textSecondary,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    fontSize: typography.sizes.md,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
    cursor: 'pointer',
  },
};
