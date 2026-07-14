// Desktop theme — mirrors mobile theme but uses CSS custom properties format

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
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", Roboto, "Helvetica Neue", Arial, sans-serif',
  sizes: {
    xs: '11px',
    sm: '13px',
    md: '15px',
    lg: '17px',
    xl: '22px',
    xxl: '28px',
  },
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeights: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75',
  },
} as const;

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
} as const;

export const radius = {
  sm: '4px',
  md: '10px',
  lg: '14px',
  xl: '18px',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(7,22,56,0.06)',
  md: '0 8px 20px rgba(7,22,56,0.08)',
  lg: '0 14px 34px rgba(7,22,56,0.10)',
  xl: '0 22px 56px rgba(7,22,56,0.14)',
} as const;

// CSS variables string (inject into :root)
export const CSS_VARIABLES = `
  :root {
    --color-primary: ${colors.primary};
    --color-secondary: ${colors.secondary};
    --color-tertiary: ${colors.tertiary};
    --color-neutral: ${colors.neutral};
    --color-background: ${colors.background};
    --color-surface: ${colors.surface};
    --color-surface-elevated: ${colors.surfaceElevated};
    --color-surface-hover: ${colors.surfaceHover};
    --color-border: ${colors.border};
    --color-border-faint: ${colors.borderFaint};
    --color-text: ${colors.text};
    --color-text-secondary: ${colors.textSecondary};
    --color-text-tertiary: ${colors.textTertiary};
    --color-text-on-strong: ${colors.textOnStrong};
    --color-sidebar: ${colors.sidebar};
    --color-sidebar-muted: ${colors.sidebarMuted};
    --color-sidebar-border: ${colors.sidebarBorder};
    --color-accent: ${colors.accent};
    --color-accent-dim: ${colors.accentDim};
    --color-success: ${colors.success};
    --color-success-dim: ${colors.successDim};
    --color-danger: ${colors.danger};
    --color-danger-dim: ${colors.dangerDim};
    --color-warning: ${colors.warning};
    --color-warning-dim: ${colors.warningDim};
    --font-family: ${typography.fontFamily};
    --font-size-xs: ${typography.sizes.xs};
    --font-size-sm: ${typography.sizes.sm};
    --font-size-md: ${typography.sizes.md};
    --font-size-lg: ${typography.sizes.lg};
    --font-size-xl: ${typography.sizes.xl};
    --font-size-xxl: ${typography.sizes.xxl};
    --spacing-xs: ${spacing.xs};
    --spacing-sm: ${spacing.sm};
    --spacing-md: ${spacing.md};
    --spacing-lg: ${spacing.lg};
    --spacing-xl: ${spacing.xl};
    --spacing-xxl: ${spacing.xxl};
    --radius-sm: ${radius.sm};
    --radius-md: ${radius.md};
    --radius-lg: ${radius.lg};
    --radius-xl: ${radius.xl};
    --radius-full: ${radius.full};
  }
`;

// Common CSS class utilities
export const css = {
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    border: `1px solid ${colors.border}`,
    padding: spacing.md,
  },
  button: {
    primary: {
      backgroundColor: colors.accent,
      color: colors.textOnStrong,
      borderRadius: radius.md,
      padding: `${spacing.sm} ${spacing.lg}`,
      fontSize: typography.sizes.md,
      fontWeight: typography.weights.semibold,
      cursor: 'pointer',
      border: 'none',
    },
    danger: {
      backgroundColor: colors.danger,
      color: colors.textOnStrong,
      borderRadius: radius.md,
      padding: `${spacing.sm} ${spacing.lg}`,
      fontSize: typography.sizes.md,
      fontWeight: typography.weights.semibold,
      cursor: 'pointer',
      border: 'none',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: colors.text,
      borderRadius: radius.md,
      padding: `${spacing.sm} ${spacing.lg}`,
      fontSize: typography.sizes.md,
      cursor: 'pointer',
      border: `1px solid ${colors.border}`,
    },
  },
} as const;
