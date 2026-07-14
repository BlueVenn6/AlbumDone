import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Modal,
} from 'react-native';
import type { Photo } from '@photo-manager/shared';
import { useTranslation } from '@photo-manager/shared';
import { colors, typography, spacing, radius } from '../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type Props = {
  photo: Photo;
};

export const SwipeablePhoto = React.memo(
  ({ photo }: Props): React.JSX.Element => {
    const { t } = useTranslation();
    const [isZoomed, setIsZoomed] = useState(false);
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
      setImageFailed(false);
    }, [photo.uri]);

    return (
      <>
        <View style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => setIsZoomed(true)}
            style={styles.imageContainer}
          >
            {imageFailed ? (
              <View style={styles.imageFallback}>
                <Text style={styles.imageFallbackTitle}>{t('screenshots.loadError')}</Text>
                <Text style={styles.imageFallbackText} numberOfLines={2}>
                  {photo.filename}
                </Text>
              </View>
            ) : (
              <Image
                source={{ uri: photo.thumbnailUri ?? photo.uri, width: 1280, height: 1280 }}
                style={styles.image}
                resizeMode="contain"
                resizeMethod="resize"
                onError={() => setImageFailed(true)}
              />
            )}
          </TouchableOpacity>

          <View style={styles.infoBar}>
            <Text style={styles.filename} numberOfLines={1}>
              {photo.filename}
            </Text>
            <Text style={styles.dimensions}>
              {photo.width} x {photo.height}
            </Text>
          </View>
        </View>

        {/* Zoom Modal */}
        <Modal
          visible={isZoomed}
          transparent
          animationType="fade"
          onRequestClose={() => setIsZoomed(false)}
        >
          <TouchableOpacity
            style={styles.zoomModal}
            onPress={() => setIsZoomed(false)}
            activeOpacity={1}
          >
            <Image
              source={{ uri: photo.uri, width: 1600, height: 1600 }}
              style={styles.zoomedImage}
              resizeMode="contain"
              resizeMethod="resize"
              onError={() => setImageFailed(true)}
            />
            <Text style={styles.zoomHint}>{t('common.done')}</Text>
          </TouchableOpacity>
        </Modal>
      </>
    );
  },
);
SwipeablePhoto.displayName = 'SwipeablePhoto';

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#111',
    marginHorizontal: spacing.md,
    marginVertical: 80,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: '#0B0B0B',
  },
  imageFallbackTitle: {
    color: colors.textOnStrong,
    fontSize: typography.sizes.md,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  imageFallbackText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  filename: {
    flex: 1,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  dimensions: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
  },
  zoomModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomedImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.85,
  },
  zoomHint: {
    position: 'absolute',
    bottom: 60,
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
  },
});
