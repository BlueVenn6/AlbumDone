import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import ViewShot, { captureRef } from 'react-native-view-shot';
import {
  buildYearReviewLayoutPlan,
  filterNonScreenshots,
  getRandomEncouragement,
  normalizeLocale,
  selectMonthlyReviewPhotos,
  useTranslation,
} from '@photo-manager/shared';
import type { MonthlyReviewPhoto, MonthlyReviewSelection } from '@photo-manager/shared';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import { colors, typography, spacing, radius, commonStyles } from '../theme';
import { loadMobileAlbumSnapshot } from '../utils/photoAlbumRepository';
import { updateScannedAlbumCount } from '../utils/albumCounts';

type Props = NativeStackScreenProps<HomeStackParamList, 'YearInReview'>;
type TimeMode = 'rolling' | 'calendar';
type MonthSlot = {
  key: string;
  monthId: number;
  uri: string | null;
  confidence: MonthlyReviewSelection['confidence'];
  score: number;
  reasons: string[];
  message?: string;
};
type CandidatePhoto = MonthlyReviewPhoto;

function toTimestampMs(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

export function YearInReviewScreen({ route }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = normalizeLocale(i18n.language);
  const albumId = route.params.albumId;

  const [timeMode, setTimeMode] = useState<TimeMode>('rolling');
  const [layout, setLayout] = useState<'vertical' | 'calendar'>('calendar');
  const [monthSlots, setMonthSlots] = useState<MonthSlot[]>([]);
  const [monthsCovered, setMonthsCovered] = useState(0);
  const [inputPhotoCount, setInputPhotoCount] = useState(0);
  const [encouragement, setEncouragement] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const collageRef = useRef<ViewShot>(null);

  const monthLabel = useCallback(
    (monthId: number) => {
      const baseDate = new Date(Math.floor(monthId / 12), monthId % 12, 1);
      const locale =
        language === 'zh-Hans' ? 'zh-CN' : language === 'zh-Hant' ? 'zh-TW' : 'en-US';
      return baseDate.toLocaleString(locale, { month: 'short' });
    },
    [language],
  );

  const resultText = useMemo(() => {
    if (monthsCovered <= 0) return '';
    return t('yearInReviewSceneResult', { months: monthsCovered });
  }, [monthsCovered, t]);

  const buildMonthlySelection = useCallback(
    async (mode: TimeMode): Promise<{
      slots: MonthSlot[];
      count: number;
      inputCount: number;
      layout: 'vertical' | 'calendar';
    }> => {
      const now = new Date();
      const candidates: CandidatePhoto[] = [];

      const snapshot = await loadMobileAlbumSnapshot(albumId);
      updateScannedAlbumCount(albumId, snapshot.count, snapshot.totalBytes);
      for (const photo of snapshot.photos) {
        const timestampMs = toTimestampMs(photo.timestamp);
        const date = new Date(timestampMs);
        if (Number.isNaN(date.getTime())) continue;
        candidates.push({
          ...photo,
          timestamp: timestampMs,
          capturedAt: timestampMs,
        });
      }

      const photoCandidates = filterNonScreenshots(candidates);
      const layoutPlan = buildYearReviewLayoutPlan(photoCandidates, mode, now);
      if (layoutPlan.layout === 'empty') {
        return { slots: [], count: 0, inputCount: 0, layout: 'vertical' };
      }

      if (layoutPlan.layout === 'vertical') {
        const byId = new Map(photoCandidates.map((photo) => [photo.id, photo]));
        const slots = layoutPlan.photoIds.flatMap((photoId, index) => {
          const photo = byId.get(photoId);
          return photo ? [{
            key: `photo:${photo.id}:${index}`,
            monthId: layoutPlan.monthIds[index]!,
            uri: photo.thumbnailUri ?? photo.uri,
            confidence: 'high' as const,
            score: 0,
            reasons: [],
          }] : [];
        });
        return {
          slots,
          count: slots.length,
          inputCount: slots.length,
          layout: 'vertical',
        };
      }

      const selectedMonthIds = new Set(layoutPlan.monthIds);
      const scopedCandidates = photoCandidates.filter((photo) => {
        const date = new Date(photo.timestamp);
        return selectedMonthIds.has(date.getFullYear() * 12 + date.getMonth());
      });
      const startMonthId = layoutPlan.monthIds[0]!;
      const start = new Date(Math.floor(startMonthId / 12), startMonthId % 12, 1);
      const selections = selectMonthlyReviewPhotos(scopedCandidates, {
        startDate: start,
        months: layoutPlan.monthIds.length,
        mode,
        allowLowConfidence: true,
        excludeLowValueImages: false,
      });

      const slots: MonthSlot[] = selections.map((selection, slotIndex) => ({
          key: `month:${layoutPlan.monthIds[slotIndex]}`,
          monthId: layoutPlan.monthIds[slotIndex]!,
          uri: selection.selectedPhoto?.uri ?? null,
          confidence: selection.selectedPhoto ? selection.confidence : 'empty',
          score: selection.score,
          reasons: selection.reasons,
          message: t('yearInReview.noPhotosThisMonth'),
        }));

      return {
        slots,
        count: selections.filter((selection) => Boolean(selection.selectedPhoto)).length,
        inputCount: scopedCandidates.length,
        layout: 'calendar',
      };
    },
    [albumId, language, t],
  );

  const handleGenerate = useCallback(async () => {
      setError('');
      setIsGenerating(true);
      setEncouragement('');
      setInputPhotoCount(0);
      try {
      const modeToUse = timeMode;
      const selection = await buildMonthlySelection(modeToUse);
      if (selection.count === 0) {
        throw new Error(t('yearInReview.errors.noReadablePhotos'));
      }

      setLayout(selection.layout);
      setMonthSlots(selection.slots);
      setMonthsCovered(selection.slots.length);
      setInputPhotoCount(selection.inputCount);
      setEncouragement(getRandomEncouragement(language));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.notSet'));
    } finally {
      setIsGenerating(false);
    }
  }, [buildMonthlySelection, language, t, timeMode]);

  const handleSave = useCallback(async () => {
    if (monthSlots.length === 0) return;
    setIsSaving(true);
    setError('');
    try {
      if (!collageRef.current) {
        throw new Error(t('common.notSet'));
      }
      const uri = await captureRef(collageRef.current, {
        format: 'jpg',
        quality: 0.92,
        result: 'tmpfile',
      });
      await CameraRoll.save(uri, { type: 'photo' });
      Alert.alert(t('yearInReviewDone'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.notSet'));
    } finally {
      setIsSaving(false);
    }
  }, [monthSlots.length, t]);

  return (
    <SafeAreaView style={commonStyles.screenBackground} edges={['bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('yearInReview.title')}</Text>
        <Text style={styles.subtitle}>{t('yearInReviewSubtitle')}</Text>

        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleButton, timeMode === 'rolling' && styles.toggleButtonActive]}
            onPress={() => setTimeMode('rolling')}
            disabled={isGenerating}
          >
            <Text style={[styles.toggleText, timeMode === 'rolling' && styles.toggleTextActive]}>
              {t('yearInReviewRolling')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, timeMode === 'calendar' && styles.toggleButtonActive]}
            onPress={() => setTimeMode('calendar')}
            disabled={isGenerating}
          >
            <Text style={[styles.toggleText, timeMode === 'calendar' && styles.toggleTextActive]}>
              {t('yearInReviewCalendar')}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[commonStyles.primaryButton, isGenerating && styles.disabledButton]}
          onPress={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <ActivityIndicator color={colors.textOnStrong} />
          ) : (
            <Text style={commonStyles.primaryButtonText}>{t('yearInReview.generate')}</Text>
          )}
        </TouchableOpacity>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {monthSlots.length > 0 && (
          <View style={styles.resultCard}>
            <Text style={styles.doneLabel}>{t('yearInReviewDone')}</Text>
            <Text style={styles.resultText}>{resultText}</Text>
            <Text style={styles.inputCountText}>
              {t('common.photoCount', { count: inputPhotoCount })}
            </Text>
            {encouragement ? <Text style={styles.encouragement}>{encouragement}</Text> : null}

            <ViewShot ref={collageRef} style={styles.collageWrap}>
              <View style={layout === 'calendar' ? styles.calendarGrid : styles.verticalGrid}>
                {monthSlots.map((slot) => (
                  <ReviewCell
                    key={slot.key}
                    slot={slot}
                    label={monthLabel(slot.monthId)}
                    calendar={layout === 'calendar'}
                    fallbackMessage={t('yearInReview.noPhotosThisMonth')}
                  />
                ))}
              </View>
            </ViewShot>

            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.disabledButton]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.saveButtonText}>{t('yearInReviewSaveImage')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReviewCell({
  slot,
  label,
  calendar,
  fallbackMessage,
}: {
  slot: MonthSlot;
  label: string;
  calendar: boolean;
  fallbackMessage: string;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <View style={calendar ? styles.calendarCell : styles.verticalCell}>
      {slot.uri && !failed ? (
        <Image
          source={{ uri: slot.uri, width: 720, height: 720 }}
          style={styles.cellImage}
          resizeMode="cover"
          resizeMethod="resize"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.cellPlaceholder}>
          <Text style={styles.cellPlaceholderText}>{slot.message ?? fallbackMessage}</Text>
        </View>
      )}
      <View style={styles.cellFooter}>
        <Text style={styles.cellLabel}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.sizes.xl,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  toggleButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  toggleText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: '500',
  },
  toggleTextActive: {
    color: colors.accent,
  },
  disabledButton: {
    opacity: 0.6,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.sizes.sm,
  },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  doneLabel: {
    color: colors.success,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  resultText: {
    color: colors.text,
    fontSize: typography.sizes.md,
    fontWeight: '600',
  },
  inputCountText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
  },
  encouragement: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
  },
  collageWrap: {
    backgroundColor: '#111',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  verticalGrid: {
    flexDirection: 'column',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: '25%',
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: '#000',
    backgroundColor: colors.surfaceElevated,
  },
  verticalCell: {
    width: '100%',
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: '#000',
    backgroundColor: colors.surfaceElevated,
  },
  cellImage: {
    width: '100%',
    height: '100%',
  },
  cellPlaceholder: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
  },
  cellPlaceholderText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  cellFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  cellLabel: {
    color: colors.textOnStrong,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
  },
  saveButton: {
    marginTop: spacing.xs,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  saveButtonText: {
    color: colors.text,
    fontSize: typography.sizes.md,
    fontWeight: '600',
  },
});
