import { StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const brandPalette = {
  primary: '#14B8A6',
  secondary: '#2563EB',
  tertiary: '#F59E0B',
  neutral: '#7D8BA0',
} as const;

export const colors = {
  primary: brandPalette.primary,
  secondary: brandPalette.secondary,
  tertiary: brandPalette.tertiary,
  neutral: brandPalette.neutral,
  background: '#F2F6FA',
  surface: '#FFFFFF',
  surfaceElevated: '#F8FBFD',
  surfaceHover: '#EEF8F6',
  border: '#D8E3EC',
  borderFaint: '#E6EDF3',
  text: '#10233F',
  textSecondary: '#65758B',
  textTertiary: '#7D8BA0',
  textOnStrong: '#FFFFFF',
  sidebar: '#071B3A',
  sidebarMuted: '#B9C6D8',
  sidebarBorder: 'rgba(255,255,255,0.12)',
  accent: brandPalette.primary,
  accentDim: '#E6F8F5',
  success: '#14B8A6',
  successDim: '#E6F8F5',
  danger: '#FF6B5E',
  dangerDim: '#FFF0EF',
  warning: brandPalette.tertiary,
  warningDim: '#FFF4DE',
  overlay: 'rgba(7,22,56,0.36)',
  overlayLight: 'rgba(7,22,56,0.14)',
} as const;

export const typography = {
  fontFamily: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 22,
    xxl: 28,
  },
  lineHeights: {
    xs: 16,
    sm: 18,
    md: 22,
    lg: 24,
    xl: 30,
    xxl: 38,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 4,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
} as const;

export const screen = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
} as const;

export const shadows = {
  sm: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

// Common shared styles
export const commonStyles = StyleSheet.create({
  flex1: { flex: 1 },
  row: { flexDirection: 'row' },
  center: { alignItems: 'center', justifyContent: 'center' },
  screenBackground: {
    flex: 1,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.textOnStrong,
    fontSize: typography.sizes.md,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: {
    color: colors.textOnStrong,
    fontSize: typography.sizes.md,
    fontWeight: '600',
  },
  successButton: {
    backgroundColor: colors.success,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successButtonText: {
    color: colors.textOnStrong,
    fontSize: typography.sizes.md,
    fontWeight: '600',
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: {
    color: colors.text,
    fontSize: typography.sizes.md,
  },
});
