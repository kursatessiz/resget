import { useColorScheme } from 'react-native';
import { PERFECT_UI_TOKENS, radii, semanticColors, spacing, typography } from '@resget/shared';

/**
 * The app draws from the same tokens as the web (packages/shared/src/design):
 * the kit's semantic colours per mode, the spacing scale and the radii. No
 * colour, radius or font is defined here.
 */
export interface Theme {
  mode: 'light' | 'dark';
  colors: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    border: string;
    theme: string;
    onTheme: string;
    success: string;
    warn: string;
    error: string;
  };
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
}

export function useTheme(): Theme {
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const c = semanticColors[mode];
  const roles = PERFECT_UI_TOKENS.colors[mode];
  return {
    mode,
    colors: {
      background: c.background,
      surface: c.surface,
      text: c.textPrimary,
      muted: c.textMuted,
      border: c.border,
      theme: roles.theme,
      onTheme: PERFECT_UI_TOKENS.colors.light.bg,
      success: roles.success,
      warn: roles.warn,
      error: roles.error,
    },
    spacing,
    radii,
    typography,
  };
}
