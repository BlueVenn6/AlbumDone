import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getReviewSummary, nextMonthEncouragement, pathToLocalFileUri, localFileUriToPath, pickMonthEncouragements,
  replaceReviewPhoto, useTranslation, type ReviewMonth, type YearReviewTimeMode,
} from '@photo-manager/shared';
import { colors } from '../theme';

export function YearInReviewScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const { state } = useLocation();
  const albumId = (state as { albumId?: string } | null)?.albumId;
  const { t, i18n } = useTranslation();
  const [timeMode, setTimeMode] = useState<YearReviewTimeMode>('rolling');
  const [months, setMonths] = useState<ReviewMonth[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [choosingMonth, setChoosingMonth] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const summary = getReviewSummary(months);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  // A language change updates every empty card, including already generated results.
  useEffect(() => {
    setMonths(current => current.map((month, index) => ({
      ...month, quote: pickMonthEncouragements(locale, 12, () => 0.5)[index]!,
    })));
    setOutputPath('');
  }, [locale]);
  const label = (id: number) => new Date(Math.floor(id / 12), id % 12, 1)
    .toLocaleDateString(locale, { year: 'numeric', month: 'long' });

  async function generate() {
    if (!albumId || !window.electronAPI) { setError('yearInReview.errors.selectFolder'); return; }
    setBusy(true); setError(''); setOutputPath(''); setChoosingMonth(null);
    try {
      const photos = await window.electronAPI.getPhotos(albumId, { mode: 'fast' });
      const result = await window.electronAPI.yearInReview.prepare(photos, timeMode);
      if (!result.some(month => month.photo)) { setMonths([]); setError('yearInReview.noPhotosInRange'); }
      else { setMonths(result); setFailedImages(new Set()); }
    } catch (err) { console.error(err); setError('yearInReview.errors.generateFailed'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!window.electronAPI || failedImages.size > 0) return;
    setBusy(true); setError('');
    try { setOutputPath((await window.electronAPI.yearInReview.export(months)).outputPath); }
    catch (err) { console.error(err); setError('yearInReview.errors.saveFailed'); }
    finally { setBusy(false); }
  }
  function update(next: ReviewMonth[]) { setMonths(next); setOutputPath(''); }
  const choosing = months.find(month => month.monthId === choosingMonth);
  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <button onClick={() => navigate(-1)}>{t('common.back')}</button>
        <h1 style={{ margin: 0, fontSize: 28 }}>{t('yearInReview.title')}</h1>
      </header>
      <p>{t('yearInReview.intro')}</p>
      <div style={styles.actions}>
        {(['rolling', 'previousYear'] as const).map(mode => <button key={mode}
          aria-pressed={timeMode === mode} disabled={busy} onClick={() => {
            setTimeMode(mode); setMonths([]); setOutputPath(''); setChoosingMonth(null);
          }}>{t(mode === 'rolling' ? 'yearInReview.last12Months' : 'yearInReview.previousYear')}</button>)}
        <button className="primary-action" disabled={busy} onClick={() => void generate()}>
          {t(busy ? 'common.loading' : 'yearInReview.generate')}
        </button>
      </div>
      {error && <p role="alert">{t(error)}</p>}
      {months.length > 0 && <>
        <p role="status">{t('yearInReview.coverage', { months: summary.covered, empty: summary.empty })}</p>
        <div style={styles.actions}>
          <button disabled={busy} onClick={() => {
            const quotes = pickMonthEncouragements(locale, months.length);
            update(months.map((month, index) => ({ ...month, quote: quotes[index]! })));
          }}>{t('yearInReview.shuffleCards')}</button>
          <button className="primary-action" disabled={busy || failedImages.size > 0} onClick={() => void save()}>{t('common.save')}</button>
        </div>
        <div data-testid="year-review-months" style={styles.grid}>
          {months.map(month => <article key={month.key} data-month={month.monthId} style={styles.card}>
            <h2 style={{ fontSize: 17, margin: '0 0 12px', overflowWrap: 'anywhere' }}>{label(month.monthId)}</h2>
            {month.photo ? <>
              <img src={pathToLocalFileUri(localFileUriToPath(month.photo.uri))} alt={month.photo.filename}
                style={styles.photo} onLoad={() => setFailedImages(current => {
                  const next = new Set(current); next.delete(month.key); return next;
                })} onError={() => setFailedImages(current => new Set(current).add(month.key))} />
              {failedImages.has(month.key) && <p role="alert">{t('yearInReview.imageFailed')}</p>}
              <button disabled={busy} onClick={() => setChoosingMonth(month.monthId)}>
                {t('yearInReview.choosePhoto', { month: label(month.monthId) })}
              </button>
            </> : <button style={styles.quote} disabled={busy} onClick={() => update(months.map(item =>
              item.key === month.key ? { ...item, quote: nextMonthEncouragement(locale, item.quote) } : item
            ))} aria-label={t('yearInReview.changeQuote')}>
              <span>{month.quote}</span>
              <small>{t('yearInReview.noPhotosThisMonth')}</small>
            </button>}
          </article>)}
        </div>
        {choosing && <section role="dialog" aria-modal="true" aria-label={t('yearInReview.choosePhoto', { month: label(choosing.monthId) })} style={styles.dialog}>
          <div style={styles.dialogBody}>
            <h2>{t('yearInReview.choosePhoto', { month: label(choosing.monthId) })}</h2>
            <p>{t('yearInReview.candidateHint')}</p>
            <div style={styles.grid}>{choosing.candidates.map(photo => <button key={photo.id} onClick={() => {
              update(replaceReviewPhoto(months, choosing.monthId, photo.id)); setChoosingMonth(null);
            }} aria-pressed={choosing.photo?.id === photo.id}>
              <img src={pathToLocalFileUri(localFileUriToPath(photo.uri))} alt={photo.filename} style={styles.photo} />
              {choosing.photo?.id === photo.id && <span>{t('yearInReview.selected')}</span>}
            </button>)}</div>
            <button onClick={() => setChoosingMonth(null)}>{t('common.cancel')}</button>
          </div>
        </section>}
        {outputPath && <div style={{ marginTop: 24 }} role="status">
          <p>{t('yearInReviewDone')}</p>
          <button onClick={async () => {
            const result = await window.electronAPI!.app.openPath(outputPath);
            if (!result.success) setError('yearInReview.errors.openFileFailed');
          }}>{t('yearInReviewOpenFile')}</button>
          <p style={{ overflowWrap: 'anywhere' }}>{outputPath}</p>
        </div>}
      </>}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100%', overflowY: 'auto', padding: 28, color: colors.text, background: colors.background },
  header: { display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 12, margin: '20px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 },
  card: { minWidth: 0, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 16 },
  photo: { display: 'block', width: '100%', height: 210, objectFit: 'contain', marginBottom: 12, background: '#101820' },
  quote: { width: '100%', minHeight: 260, padding: 22, display: 'flex', flexDirection: 'column', gap: 20,
    alignItems: 'center', justifyContent: 'center', background: '#e4f6f2', color: '#23776c', fontSize: 20, lineHeight: 1.6 },
  dialog: { position: 'fixed', inset: 0, background: '#0009', padding: 40, zIndex: 100, overflowY: 'auto' },
  dialogBody: { maxWidth: 1000, margin: '0 auto', padding: 24, borderRadius: 16, background: colors.surface },
};
