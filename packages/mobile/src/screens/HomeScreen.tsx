import React, { useCallback, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import { colors, typography, spacing, radius, commonStyles, shadows } from '../theme';
import { usePhotoLibrary } from '../hooks/usePhotoLibrary';
import type { Album } from '@photo-manager/shared';
import { getLocalizedAlbumTitle, usePhotoStore, useTranslation } from '@photo-manager/shared';

type Props = NativeStackScreenProps<HomeStackParamList, 'Home'>;

const PAGE_HORIZONTAL_PADDING = 16;
const CARD_GAP = 12;
const MAX_PHONE_WIDTH = 430;

type ModeOption = {
  id: 'dedup' | 'culling' | 'screenshots' | 'yearInReview';
  icon: string;
  screen: 'Deduplication' | 'Culling' | 'Screenshots' | 'YearInReview';
  color: string;
  tint: string;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'dedup',
    icon: '▣',
    screen: 'Deduplication',
    color: colors.accent,
    tint: colors.accentDim,
  },
  {
    id: 'culling',
    icon: '↔',
    screen: 'Culling',
    color: colors.secondary,
    tint: '#EAF1FF',
  },
  {
    id: 'screenshots',
    icon: '⌗',
    screen: 'Screenshots',
    color: '#EA580C',
    tint: '#FFF0E6',
  },
  {
    id: 'yearInReview',
    icon: '▣',
    screen: 'YearInReview',
    color: '#D89200',
    tint: colors.warningDim,
  },
];

function formatStorageBytes(totalBytes: number | undefined): string {
  if (totalBytes === undefined || !Number.isFinite(totalBytes) || totalBytes < 0) return '--';
  if (totalBytes >= 1024 ** 3) return `${(totalBytes / 1024 ** 3).toFixed(2)} GB`;
  if (totalBytes >= 1024 ** 2) return `${Math.max(0.01, totalBytes / 1024 ** 2).toFixed(2)} MB`;
  if (totalBytes >= 1024) return `${(totalBytes / 1024).toFixed(1)} KB`;
  return `${totalBytes} B`;
}

export function HomeScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);
  const folderSectionYRef = useRef(0);
  const { width: windowWidth } = useWindowDimensions();
  const viewportWidth =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.innerWidth
      : windowWidth;
  const {
    albums,
    selectedAlbumId,
    setSelectedAlbum,
    isLoading,
    isImporting,
    hasPermission,
    error,
    importProgress,
    requestPermission,
    importLocalFolder,
    refresh,
  } = usePhotoLibrary();
  const storeAlbums = usePhotoStore((state) => state.albums);
  const displayAlbums = storeAlbums.length > 0 ? storeAlbums : albums;
  const contentWidth = Math.max(
    0,
    Math.min(viewportWidth || MAX_PHONE_WIDTH, MAX_PHONE_WIDTH) - PAGE_HORIZONTAL_PADDING * 2,
  );
  const modeCardWidth = Math.floor((contentWidth - CARD_GAP) / 2);
  const activeAlbum = useMemo(
    () =>
      displayAlbums.find((album) => album.id === selectedAlbumId)
      ?? displayAlbums[0]
      ?? null,
    [displayAlbums, selectedAlbumId],
  );
  const selectedCountIsExact = activeAlbum?.countIsExact !== false;
  const selectedCount = activeAlbum?.count ?? importProgress.loaded;
  const selectedCountLabel = selectedCountIsExact ? selectedCount.toLocaleString() : '...';
  const selectedTitle = activeAlbum
    ? getLocalizedAlbumTitle(activeAlbum.title, t)
    : t('home.allFiles');
  const selectedSize = selectedCountIsExact ? formatStorageBytes(activeAlbum?.totalBytes) : '--';

  const handleAlbumSelect = useCallback(
    (albumId: string) => {
      setSelectedAlbum(albumId);
    },
    [setSelectedAlbum],
  );

  const scrollToFolders = useCallback(() => {
    scrollViewRef.current?.scrollTo({
      y: Math.max(0, folderSectionYRef.current - 12),
      animated: true,
    });
  }, []);

  const handleBrowsePress = useCallback(async () => {
    if (importLocalFolder) {
      await importLocalFolder();
      return;
    }
    if (!hasPermission) {
      await requestPermission();
      scrollToFolders();
      return;
    }
    await refresh();
    scrollToFolders();
  }, [hasPermission, importLocalFolder, refresh, requestPermission, scrollToFolders]);

  const handleModePress = useCallback(
    (mode: ModeOption) => {
      const albumId = selectedAlbumId ?? activeAlbum?.id;
      if (!albumId) return;
      navigation.navigate(mode.screen, { albumId });
    },
    [activeAlbum?.id, navigation, selectedAlbumId],
  );

  if (hasPermission === null) {
    return (
      <SafeAreaView style={commonStyles.screenBackground}>
        <View style={styles.permissionContainer}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={commonStyles.screenBackground}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionEmoji}>▣</Text>
          <Text style={styles.permissionTitle}>{t('photoLibrary.permissionTitle')}</Text>
          <Text style={styles.permissionSubtitle}>{t('photoLibrary.permissionDescription')}</Text>
          <TouchableOpacity
            style={[commonStyles.primaryButton, styles.permissionButton]}
            onPress={requestPermission}
          >
            <Text style={commonStyles.primaryButtonText}>{t('photoLibrary.allowAccess')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={commonStyles.screenBackground} edges={['top']}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { width: contentWidth }]}>
          <View style={styles.headerCopy}>
            <Text style={styles.appTitle}>{t('home.title')}</Text>
            <Text style={styles.appSubtitle} numberOfLines={1}>
              {t('home.subtitle')}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.browseButton, (isLoading || isImporting) && styles.disabled]}
            onPress={handleBrowsePress}
            disabled={isLoading || isImporting}
            activeOpacity={0.78}
          >
            <Text style={styles.browseButtonText} numberOfLines={1}>
              {isImporting
                ? t('home.loadingShort')
                : Platform.OS === 'web'
                  ? t('home.browseFolderShort')
                  : t('home.selectAlbumShort')}
            </Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={[styles.errorText, { width: contentWidth }]}>{error}</Text> : null}

        <View style={[styles.summaryCard, { width: contentWidth }]}>
          <View style={styles.summaryTop}>
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryLabel}>{t('home.currentFolder')}</Text>
              <Text style={styles.summaryTitle} numberOfLines={1}>
                {selectedTitle}
              </Text>
              <Text style={styles.summarySub}>
                {selectedCountIsExact ? t('common.photoCount', { count: selectedCount }) : t('common.loading')}
              </Text>
            </View>
            <FolderGlyph />
          </View>
          <View style={styles.summaryMetrics}>
            <SummaryMetric icon="▣" label={t('home.totalPhotos')} value={selectedCountLabel} />
            <View style={styles.metricDivider} />
            <SummaryMetric icon="▰" label={t('home.totalSize')} value={selectedSize} />
          </View>
        </View>

        <View style={[styles.modeGrid, { width: contentWidth }]}>
          {MODE_OPTIONS.map((mode) => (
            <ModeCard
              key={mode.id}
              mode={mode}
              disabled={!activeAlbum}
              width={modeCardWidth}
              onPress={() => handleModePress(mode)}
            />
          ))}
        </View>

        <View
          style={[styles.folderSection, { width: contentWidth }]}
          onLayout={(event) => {
            folderSectionYRef.current = event.nativeEvent.layout.y;
          }}
        >
          <Text style={styles.sectionTitle}>{t('home.folders')}</Text>
          {isLoading ? (
            <View style={styles.folderList}>
              <ActivityIndicator color={colors.accent} size="small" style={styles.loader} />
            </View>
          ) : (
            <View style={styles.folderList}>
              {displayAlbums.length === 0 ? (
                <Text style={styles.emptyText}>{t('common.notSet')}</Text>
              ) : (
                displayAlbums.map((item, index) => (
                <AlbumItem
                  key={item.id}
                  album={item}
                  isSelected={(selectedAlbumId ?? activeAlbum?.id) === item.id}
                  isFirst={index === 0}
                  isLast={index === displayAlbums.length - 1}
                  onPress={handleAlbumSelect}
                  titleLabel={getLocalizedAlbumTitle(item.title, t)}
                  photoCountLabel={item.countIsExact === false
                    ? t('common.loading')
                    : t('common.photoCount', { count: item.count })}
                />
                ))
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
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
    <View style={styles.metric}>
      <Text style={styles.metricIcon}>{icon}</Text>
      <View>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
    </View>
  );
}

function FolderGlyph(): React.JSX.Element {
  return (
    <View style={styles.folderGlyph}>
      <View style={styles.folderGlyphTab} />
      <View style={styles.folderGlyphBody} />
    </View>
  );
}

function ModeCard({
  mode,
  disabled,
  width,
  onPress,
}: {
  mode: ModeOption;
  disabled: boolean;
  width: number;
  onPress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const title = mode.id === 'yearInReview' ? t('yearInReview.title') : t(`home.modes.${mode.id}.title`);
  const subtitle =
    mode.id === 'yearInReview' ? t('yearInReviewShortSubtitle') : t(`home.modes.${mode.id}.shortSubtitle`);

  return (
    <TouchableOpacity
      style={[styles.modeCard, { width }, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.78}
    >
      <Text style={[styles.modeIcon, { color: mode.color, backgroundColor: mode.tint }]}>
        {mode.icon}
      </Text>
      <Text style={[styles.modeTitle, { color: mode.color }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.modeSubtitle} numberOfLines={2}>{subtitle}</Text>
      <Text style={styles.modeArrow}>›</Text>
    </TouchableOpacity>
  );
}

type AlbumItemProps = {
  album: Album;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPress: (id: string) => void;
  photoCountLabel: string;
  titleLabel: string;
};

const AlbumItem = React.memo(({
  album,
  isFirst,
  isLast,
  isSelected,
  onPress,
  photoCountLabel,
  titleLabel,
}: AlbumItemProps) => (
  <TouchableOpacity
    style={[
      styles.albumItem,
      isFirst && styles.albumItemFirst,
      isLast && styles.albumItemLast,
      !isLast && styles.albumItemBorder,
      isSelected && styles.albumItemSelected,
    ]}
    onPress={() => onPress(album.id)}
    activeOpacity={0.72}
  >
    <Text style={[styles.albumIcon, isSelected && styles.albumIconSelected]}>▰</Text>
    <View style={styles.albumItemContent}>
      <Text style={styles.albumTitle} numberOfLines={1}>{titleLabel}</Text>
      <Text style={styles.albumCount}>{photoCountLabel}</Text>
    </View>
    <Text style={styles.albumSize} numberOfLines={1}>{formatStorageBytes(album.totalBytes)}</Text>
    <Text style={[styles.checkmark, isSelected && styles.checkmarkSelected]}>
      {isSelected ? '✓' : '›'}
    </Text>
  </TouchableOpacity>
));
AlbumItem.displayName = 'AlbumItem';

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 104,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  appTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: colors.text,
  },
  appSubtitle: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  browseButton: {
    width: 116,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  browseButtonText: {
    color: colors.textOnStrong,
    fontSize: 12,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.56,
  },
  errorText: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.dangerDim,
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 14,
    ...shadows.sm,
  },
  summaryTop: {
    minHeight: 90,
    paddingHorizontal: 20,
    paddingVertical: 17,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.accentDim,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 16,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 5,
  },
  summaryTitle: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    color: colors.text,
  },
  summarySub: {
    marginTop: 3,
    fontSize: 14,
    color: colors.textSecondary,
  },
  folderGlyph: {
    width: 54,
    height: 50,
    position: 'relative',
  },
  folderGlyphTab: {
    position: 'absolute',
    left: 5,
    top: 4,
    width: 24,
    height: 13,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    backgroundColor: colors.accent,
    opacity: 0.86,
  },
  folderGlyphBody: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 40,
    borderRadius: 7,
    backgroundColor: colors.accent,
  },
  summaryMetrics: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 18,
  },
  metric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  metricIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.accent,
    color: colors.textOnStrong,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 11,
    overflow: 'hidden',
  },
  metricLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  metricValue: {
    marginTop: 2,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    color: colors.text,
  },
  metricDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  modeCard: {
    minHeight: 134,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    position: 'relative',
    marginBottom: 12,
    ...shadows.sm,
  },
  modeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    textAlign: 'center',
    lineHeight: 44,
    fontSize: 22,
    overflow: 'hidden',
    marginBottom: 12,
  },
  modeTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  modeSubtitle: {
    marginTop: 5,
    paddingRight: 12,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  modeArrow: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    fontSize: 24,
    lineHeight: 24,
    color: colors.textSecondary,
  },
  folderSection: {
    gap: 9,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: colors.text,
  },
  loader: {
    marginVertical: spacing.md,
  },
  folderList: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    ...shadows.sm,
  },
  albumItem: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.surface,
  },
  albumItemFirst: {
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  albumItemLast: {
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  albumItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  albumItemSelected: {
    backgroundColor: colors.accentDim,
  },
  albumIcon: {
    width: 23,
    color: colors.textTertiary,
    fontSize: 19,
  },
  albumIconSelected: {
    color: colors.accent,
  },
  albumItemContent: {
    flex: 1,
    minWidth: 0,
  },
  albumTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.text,
    fontWeight: '800',
  },
  albumCount: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  albumSize: {
    width: 70,
    textAlign: 'right',
    fontSize: 12,
    color: colors.textSecondary,
  },
  checkmark: {
    width: 16,
    textAlign: 'right',
    color: colors.textSecondary,
    fontSize: 20,
  },
  checkmarkSelected: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '800',
  },
  separator: {
    height: 0,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    padding: spacing.lg,
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  permissionEmoji: {
    fontSize: 64,
    marginBottom: spacing.lg,
    color: colors.accent,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  permissionSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  permissionButton: {
    paddingHorizontal: spacing.xxl,
  },
});
