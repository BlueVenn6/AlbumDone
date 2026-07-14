import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from '@photo-manager/shared';
import { colors, commonStyles, radius, spacing, typography } from '../theme';

type ErrorBoundaryState = {
  error: Error | null;
};

type ErrorFallbackProps = {
  error: Error;
  onRetry: () => void;
};

function ErrorFallback({ error, onRetry }: ErrorFallbackProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('appError.title')}</Text>
      <Text style={styles.message}>{error.message || t('common.unknownError')}</Text>
      <TouchableOpacity style={commonStyles.primaryButton} onPress={onRetry}>
        <Text style={commonStyles.primaryButtonText}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.xl,
    fontWeight: '800',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  message: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
