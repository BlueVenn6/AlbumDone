import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import type { DuplicateGroup } from '@photo-manager/shared';
import { useTranslation } from '@photo-manager/shared';
import { colors, typography, spacing, radius } from '../theme';

type Props = {
  group: DuplicateGroup;
  onSwap: (groupId: string, photoId: string) => void;
};

function translateDedupeReason(
  reason: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (reason === 'possible-duplicate') {
    return t('dedup.reasons.possibleDuplicate');
  }
  if (reason === 'highly-similar') {
    return t('dedup.reasons.highlySimilar');
  }
  if (reason === 'largest-file') {
    return t('dedup.reasons.largestFile');
  }
  if (reason === 'metadata-best') {
    return t('dedup.reasons.metadataBest');
  }
  if (reason === 'manual-selection') {
    return t('dedup.reasons.manualSelection');
  }
  return reason;
}

export const DedupeGroup = React.memo(({ group, onSwap }: Props): React.JSX.Element => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);

  const rejectedPhotoIds = new Set(
    group.rejectedPhotoIds
      ?? group.photos
        .filter((photo) => photo.id !== group.selectedPhotoId)
        .map((photo) => photo.id),
  );
  const selectedPhoto =
    group.photos.find((photo) => photo.id === group.selectedPhotoId)
    ?? group.photos.find((photo) => !rejectedPhotoIds.has(photo.id));
  const otherPhotos = group.photos.filter((photo) => photo.id !== selectedPhoto?.id);

  const handleSwap = useCallback(
    (photoId: string) => {
      onSwap(group.id, photoId);
    },
    [group.id, onSwap],
  );

  return (
    <View style={styles.container}>
      {/* Group Header */}
      <TouchableOpacity
        style={styles.header}
        onPress={() => setIsExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>
            {t('common.photoCount', { count: group.photos.length })}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {translateDedupeReason(group.reason, t)}
          </Text>
        </View>
        <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.body}>
          {/* Selected Photo (Keeper) */}
          {selectedPhoto && (
            <View style={styles.selectedSection}>
              <View style={styles.keeperBadge}>
                <Text style={styles.keeperBadgeText}>✓ {t('dedup.keepingLabel')}</Text>
              </View>
              <Image
                source={{ uri: selectedPhoto.thumbnailUri ?? selectedPhoto.uri, width: 720, height: 720 }}
                style={styles.selectedImage}
                resizeMode="cover"
                resizeMethod="resize"
              />
              <Text style={styles.selectedFilename} numberOfLines={1}>
                {selectedPhoto.filename}
              </Text>
            </View>
          )}

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>
              {group.confidence === 'possible'
                ? t('dedup.reviewLabel')
                : t('dedup.rejectedCountLabel', { count: rejectedPhotoIds.size })}
            </Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Rejected Photos */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbRow}
          >
            {otherPhotos.map((photo) => (
              <View key={photo.id} style={styles.thumbContainer}>
                <Image
                  source={{ uri: photo.thumbnailUri ?? photo.uri, width: 240, height: 240 }}
                  style={[
                    styles.thumbnail,
                    rejectedPhotoIds.has(photo.id) && styles.thumbnailRejected,
                  ]}
                  resizeMode="cover"
                  resizeMethod="resize"
                />
                <TouchableOpacity
                  style={[
                    styles.swapButton,
                    rejectedPhotoIds.has(photo.id) && styles.keepButton,
                  ]}
                  onPress={() => handleSwap(photo.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.swapButtonText,
                    rejectedPhotoIds.has(photo.id) && styles.keepButtonText,
                  ]}>
                    {rejectedPhotoIds.has(photo.id)
                      ? t('dedup.keepThisBtn')
                      : t('dedup.markDeleteBtn')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.thumbFilename} numberOfLines={1}>
                  {photo.filename}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
});
DedupeGroup.displayName = 'DedupeGroup';

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.sizes.md,
    fontWeight: '600',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chevron: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  body: {
    padding: spacing.md,
  },
  selectedSection: {
    position: 'relative',
    marginBottom: spacing.md,
  },
  keeperBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    zIndex: 1,
    backgroundColor: colors.success,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  keeperBadgeText: {
    fontSize: typography.sizes.xs,
    color: colors.textOnStrong,
    fontWeight: '700',
  },
  selectedImage: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
  },
  selectedFilename: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
  },
  thumbRow: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  thumbContainer: {
    width: 100,
    alignItems: 'center',
  },
  thumbnail: {
    width: 100,
    height: 100,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    marginBottom: spacing.xs,
  },
  thumbnailRejected: {
    opacity: 0.72,
    borderWidth: 2,
    borderColor: colors.danger,
  },
  swapButton: {
    backgroundColor: colors.dangerDim,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  keepButton: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  swapButtonText: {
    fontSize: typography.sizes.xs,
    color: colors.danger,
    fontWeight: '600',
  },
  keepButtonText: {
    color: colors.accent,
  },
  thumbFilename: {
    fontSize: 10,
    color: colors.textTertiary,
    textAlign: 'center',
    width: '100%',
  },
});
