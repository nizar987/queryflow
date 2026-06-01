export const Colors = {
  // Primary
  primary: '#6C63FF',
  primaryLight: '#8B85FF',
  primaryDark: '#4A42DD',

  // Secondary / Success
  secondary: '#00C896',
  secondaryLight: '#33D4AA',
  secondaryDark: '#009E76',

  // Danger / Expense
  danger: '#FF6B6B',
  dangerLight: '#FF8E8E',
  dangerDark: '#DD4A4A',

  // Warning
  warning: '#F59E0B',
  warningLight: '#FBB83F',
  warningDark: '#D97706',

  // Backgrounds (Dark theme)
  background: '#0D0D1A',
  surface: '#1A1A2E',
  surfaceSecondary: '#242438',
  surfaceTertiary: '#2E2E48',

  // Text
  textPrimary: '#F0F0FF',
  textSecondary: '#8888AA',
  textTertiary: '#5555778',
  textDisabled: '#44445A',

  // Border
  border: '#2E2E48',
  borderLight: '#3A3A55',

  // Overlay
  overlay: 'rgba(0,0,0,0.6)',
  overlayLight: 'rgba(0,0,0,0.3)',

  // Static
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',

  // Income / Expense indicators
  income: '#00C896',
  expense: '#FF6B6B',
  transfer: '#6C63FF',

  // Chart palette
  chart: [
    '#6C63FF',
    '#00C896',
    '#FF6B6B',
    '#F59E0B',
    '#3B82F6',
    '#EC4899',
    '#8B5CF6',
    '#14B8A6',
    '#F97316',
    '#06B6D4',
    '#84CC16',
    '#EF4444',
  ],
} as const;

export type ColorKey = keyof typeof Colors;
