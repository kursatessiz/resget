/**
 * Design language. The default family is Perfect UI (https://perfectui.dev,
 * MIT). The four former theme families (noir, nefes, saha, atolye) were
 * retired in T1 and are back as an opt-in set controlled by the super admin
 * (D7): every family speaks the Perfect UI token vocabulary, so themeCssVariables()
 * emits the same `--pui-*` variables for all of them and every component
 * keeps working. A restaurant renders a non-default family only when the super
 * admin allowed it (see THEME_FAMILY_FLAG_PREFIX and resolveAllowedThemeFamilies).
 *
 * The tenant's brand (primary color, logo) always stays the tenant's; the
 * user only chooses light, dark or system.
 */

export const THEME_FAMILY_KEYS = ['perfect', 'noir', 'nefes', 'saha', 'atolye'] as const;
export type ThemeFamilyKey = (typeof THEME_FAMILY_KEYS)[number];

/** The family every restaurant may always use and the one rendered when nothing else is allowed. */
export const DEFAULT_THEME_FAMILY: ThemeFamilyKey = 'perfect';

/** The four families that are available only when the super admin allows them. */
export const OPTIONAL_THEME_FAMILY_KEYS = ['noir', 'nefes', 'saha', 'atolye'] as const;
export type OptionalThemeFamilyKey = (typeof OPTIONAL_THEME_FAMILY_KEYS)[number];

/**
 * Keys that may be stored in the database. Equal to THEME_FAMILY_KEYS; the
 * name is kept because the API contract and stored values predate D7.
 */
export const STORED_THEME_FAMILY_KEYS = THEME_FAMILY_KEYS;
export type StoredThemeFamilyKey = ThemeFamilyKey;

export const COLOR_SCHEME_PREFERENCES = ['SYSTEM', 'LIGHT', 'DARK'] as const;
export type ColorSchemePreference = (typeof COLOR_SCHEME_PREFERENCES)[number];
export type ColorMode = 'light' | 'dark';

/** Neutral colors of one mode, in the names the apps have always used. */
export interface ThemeColors {
  /** Page background (`--pui-bg`). */
  background: string;
  /** Card and panel background; the kit draws cards on the page color. */
  surface: string;
  /** `--pui-bg-muted`: card headers, addons, striped rows. */
  surfaceMuted: string;
  /** `--pui-bg-emphasis`: pressed and selected neutrals. */
  surfaceEmphasis: string;
  border: string;
  textPrimary: string;
  /** The kit has no secondary text token; this is the text color at 80%. */
  textSecondary: string;
  textMuted: string;
}

/** Semantic color roles of Perfect UI, one value per mode. */
export interface PerfectRoleColors {
  theme: string;
  success: string;
  warn: string;
  error: string;
  muted: string;
}

export interface GradientPreset {
  key: string;
  label: string;
  angle: number;
  stops: readonly [string, string, ...string[]];
}

export interface ThemeFont {
  /** CSS font-family stack for web. */
  web: string;
  /** Font names registered on mobile (expo-google-fonts export names). */
  native: { regular: string; strong: string };
  weight: '400' | '500' | '600' | '700' | '800';
  /** em units */
  letterSpacing: number;
}

export interface ThemeFamily {
  key: ThemeFamilyKey;
  label: string;
  description: string;
  recommendedFor: string;
  /** Web fonts are self-hosted through @fontsource; kept for reference only. */
  googleFonts: readonly string[];
  fonts: { display: ThemeFont; body: ThemeFont };
  radii: { card: number; button: number; chip: number; input: number };
  /** Hairline border around cards, or elevation only. */
  cardBorder: boolean;
  cardShadow: 'none' | 'soft';
  /** Display type is set wide (font-stretch) where the platform supports it. */
  wideDisplay: boolean;
  colors: Record<ColorMode, ThemeColors>;
  roles: Record<ColorMode, PerfectRoleColors>;
  /** The gradient of the default brand color; tenants get one derived from their primary. */
  gradients: readonly [GradientPreset, ...GradientPreset[]];
}

/**
 * Perfect UI tokens, exactly as `@chrissgon/perfectui` 1.0.0
 * dist/css/core.css (`light-dark(light, dark)` pairs). Web reads them as
 * `--pui-*` variables, mobile reads the hex values.
 */
export const PERFECT_UI_TOKENS = {
  colors: {
    light: {
      bg: '#ffffff',
      bgMuted: '#f3f4f6',
      bgEmphasis: '#e5e7eb',
      text: '#000000',
      textMuted: '#676d7b',
      border: '#d1d5db',
      theme: '#0092cd',
      success: '#16a34a',
      warn: '#d97706',
      error: '#dc2626',
      muted: '#6b7280',
    },
    dark: {
      bg: '#000000',
      bgMuted: '#111827',
      bgEmphasis: '#1f2937',
      text: '#ffffff',
      textMuted: '#9ca3af',
      border: '#374151',
      theme: '#07b6f0',
      success: '#22c55e',
      warn: '#f59e0b',
      error: '#ef4444',
      muted: '#9ca3af',
    },
  },
  /** px; `--pui-radius: .375rem`. Cards use 1.5x. */
  radius: 6,
  /** px; `--pui-space: .25rem`. Every gap and padding is a multiple of it. */
  space: 4,
  /** px; `--pui-font-size: .875rem`. */
  fontSize: 14,
  /** px; `--pui-border-width: 1px`. */
  borderWidth: 1,
  /** px; Lucide icons at 16px with the stroke bound to the text color. */
  iconSize: 16,
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

export type PerfectUiColorToken = keyof (typeof PERFECT_UI_TOKENS)['colors']['light'];

const L = PERFECT_UI_TOKENS.colors.light;
const D = PERFECT_UI_TOKENS.colors.dark;

const grad = (key: string, label: string, from: string, to: string): GradientPreset => ({
  key,
  label,
  angle: 135,
  stops: [from, to],
});

/**
 * Every family sets type in Inter, the only face bundled in the apps. The
 * face names are the ones the mobile app registers (apps/mobile/src/interFaces.ts).
 */
const INTER_FONTS = {
  display: {
    web: PERFECT_UI_TOKENS.fontFamily,
    native: { regular: 'Inter_600SemiBold', strong: 'Inter_700Bold' },
    weight: '700',
    letterSpacing: -0.01,
  },
  body: {
    web: PERFECT_UI_TOKENS.fontFamily,
    native: { regular: 'Inter_400Regular', strong: 'Inter_600SemiBold' },
    weight: '400',
    letterSpacing: 0,
  },
} as const satisfies ThemeFamily['fonts'];

/** The kit's status colors, reused by the optional families so success, warning and error stay recognisable. */
const KIT_STATUS = {
  light: { success: L.success, warn: L.warn, error: L.error, muted: L.muted },
  dark: { success: D.success, warn: D.warn, error: D.error, muted: D.muted },
} as const;

export const THEME_FAMILIES = {
  perfect: {
    key: 'perfect',
    label: 'Perfect UI',
    description: 'Flat, quiet and legible: one typeface (Inter), hairline cards and the business color.',
    recommendedFor: 'Every business type',
    googleFonts: ['Inter:wght@400;500;600;700'],
    fonts: INTER_FONTS,
    radii: {
      card: PERFECT_UI_TOKENS.radius * 1.5,
      button: PERFECT_UI_TOKENS.radius,
      chip: 9999,
      input: PERFECT_UI_TOKENS.radius,
    },
    cardBorder: true,
    cardShadow: 'none',
    wideDisplay: false,
    colors: {
      light: {
        background: L.bg,
        surface: L.bg,
        surfaceMuted: L.bgMuted,
        surfaceEmphasis: L.bgEmphasis,
        border: L.border,
        textPrimary: L.text,
        textSecondary: '#333333',
        textMuted: L.textMuted,
      },
      dark: {
        background: D.bg,
        surface: D.bg,
        surfaceMuted: D.bgMuted,
        surfaceEmphasis: D.bgEmphasis,
        border: D.border,
        textPrimary: D.text,
        textSecondary: '#cccccc',
        textMuted: D.textMuted,
      },
    },
    roles: {
      light: { theme: L.theme, success: L.success, warn: L.warn, error: L.error, muted: L.muted },
      dark: { theme: D.theme, success: D.success, warn: D.warn, error: D.error, muted: D.muted },
    },
    gradients: [{ key: 'perfect-brand', label: 'Perfect UI', angle: 135, stops: ['#0092cd', '#005c81'] }],
  },
  noir: {
    key: 'noir',
    label: 'Studio Noir',
    description: 'Serious, premium and editorial: black and white ground, one strong accent, hairline cards.',
    recommendedFor: 'Premium venues and fine dining',
    googleFonts: ['Inter:wght@400;500;600;700'],
    fonts: INTER_FONTS,
    radii: { card: 12, button: 24, chip: 9999, input: 12 },
    cardBorder: true,
    cardShadow: 'none',
    wideDisplay: false,
    colors: {
      light: {
        background: '#FAFAF8',
        surface: '#FFFFFF',
        surfaceMuted: '#F0EFEC',
        surfaceEmphasis: '#E4E2DC',
        border: '#E4E2DC',
        textPrimary: '#17160F',
        textSecondary: '#5F5C54',
        textMuted: '#7A776E',
      },
      dark: {
        background: '#0E0E0C',
        surface: '#171613',
        surfaceMuted: '#201F1B',
        surfaceEmphasis: '#2A2825',
        border: '#2A2825',
        textPrimary: '#F5F3EE',
        textSecondary: '#B3AFA4',
        textMuted: '#8A867B',
      },
    },
    roles: {
      light: { theme: '#c8443c', ...KIT_STATUS.light },
      dark: { theme: '#c8443c', ...KIT_STATUS.dark },
    },
    gradients: [
      grad('noir-kiremit', 'Kiremit', '#C8443C', '#7E2A24'),
      grad('noir-zumrut', 'Zumrut', '#1F6F5C', '#123D33'),
      grad('noir-gece', 'Gece mavisi', '#2B4C7E', '#17304F'),
      grad('noir-kehribar', 'Kehribar', '#B8860B', '#6B4D08'),
      grad('noir-grafit', 'Grafit', '#4A4A4A', '#141414'),
    ],
  },
  nefes: {
    key: 'nefes',
    label: 'Nefes',
    description: 'Calm and restorative: warm off-white ground, soft corners, a friendly tone.',
    recommendedFor: 'Yoga, wellness and spa, physiotherapy, music and language courses',
    googleFonts: ['Inter:wght@400;500;600;700'],
    fonts: INTER_FONTS,
    radii: { card: 20, button: 20, chip: 9999, input: 16 },
    cardBorder: false,
    cardShadow: 'soft',
    wideDisplay: false,
    colors: {
      light: {
        background: '#FBF8F4',
        surface: '#FFFFFF',
        surfaceMuted: '#F3EEE6',
        surfaceEmphasis: '#E8E0D3',
        border: '#E8E0D3',
        textPrimary: '#2B271F',
        textSecondary: '#655C4D',
        textMuted: '#7D7462',
      },
      dark: {
        background: '#14130F',
        surface: '#1D1B16',
        surfaceMuted: '#262319',
        surfaceEmphasis: '#2E2B23',
        border: '#2E2B23',
        textPrimary: '#F6F1E6',
        textSecondary: '#BDB39D',
        textMuted: '#948B75',
      },
    },
    roles: {
      light: { theme: '#6e8b6b', ...KIT_STATUS.light },
      dark: { theme: '#6e8b6b', ...KIT_STATUS.dark },
    },
    gradients: [
      grad('nefes-adacayi', 'Adacayi', '#6E8B6B', '#3F5A3D'),
      grad('nefes-seftali', 'Seftali', '#E8A87C', '#C0703F'),
      grad('nefes-gok', 'Gokyuzu', '#7C9CBF', '#4A6C8C'),
      grad('nefes-lavanta', 'Lavanta', '#B79FC9', '#7C5F94'),
      grad('nefes-bugday', 'Bugday', '#D9C08A', '#A67C3D'),
    ],
  },
  saha: {
    key: 'saha',
    label: 'Saha',
    description: 'Energetic and performance minded: sharp corners and high-contrast status chips.',
    recommendedFor: 'Tennis and padel courts, swimming schools, group fitness, kids sports',
    googleFonts: ['Inter:wght@400;500;600;700'],
    fonts: INTER_FONTS,
    radii: { card: 8, button: 8, chip: 6, input: 8 },
    cardBorder: false,
    cardShadow: 'none',
    wideDisplay: true,
    colors: {
      light: {
        background: '#FFFFFF',
        surface: '#F2F4F3',
        surfaceMuted: '#E1E5E3',
        surfaceEmphasis: '#D2D8D5',
        border: '#E1E5E3',
        textPrimary: '#131816',
        textSecondary: '#4F5B57',
        textMuted: '#66726E',
      },
      dark: {
        background: '#0C0F0E',
        surface: '#151A18',
        surfaceMuted: '#1E2523',
        surfaceEmphasis: '#2A3330',
        border: '#1E2523',
        textPrimary: '#F1F4F2',
        textSecondary: '#B4BDB7',
        textMuted: '#8F9891',
      },
    },
    roles: {
      light: { theme: '#e8622c', ...KIT_STATUS.light },
      dark: { theme: '#e8622c', ...KIT_STATUS.dark },
    },
    gradients: [
      grad('saha-turuncu', 'Turuncu', '#E8622C', '#B8401A'),
      grad('saha-yesil', 'Cim', '#1FA37A', '#0D6B4C'),
      grad('saha-mavi', 'Havuz', '#2B74B9', '#164A78'),
      grad('saha-sari', 'Sari', '#E8B92C', '#A87808'),
      grad('saha-komur', 'Komur', '#4C4C4C', '#0F0F0F'),
    ],
  },
  atolye: {
    key: 'atolye',
    label: 'Atolye',
    description: 'Warm and trustworthy: generous spacing, medium corners, suits every sector.',
    recommendedFor: 'Physiotherapy, coworking, courses and any business without a strong identity',
    googleFonts: ['Inter:wght@400;500;600;700'],
    fonts: INTER_FONTS,
    radii: { card: 16, button: 16, chip: 9999, input: 12 },
    cardBorder: true,
    cardShadow: 'soft',
    wideDisplay: false,
    colors: {
      light: {
        background: '#F7F6F4',
        surface: '#FFFFFF',
        surfaceMuted: '#ECEAE6',
        surfaceEmphasis: '#E0DDD7',
        border: '#ECEAE6',
        textPrimary: '#262319',
        textSecondary: '#5E594D',
        textMuted: '#777163',
      },
      dark: {
        background: '#121110',
        surface: '#1B1A17',
        surfaceMuted: '#252420',
        surfaceEmphasis: '#2F2D28',
        border: '#2A2824',
        textPrimary: '#F3F1EC',
        textSecondary: '#B9B3A5',
        textMuted: '#948E80',
      },
    },
    roles: {
      light: { theme: '#2f6f5e', ...KIT_STATUS.light },
      dark: { theme: '#2f6f5e', ...KIT_STATUS.dark },
    },
    gradients: [
      grad('atolye-orman', 'Orman', '#2F6F5E', '#173D33'),
      grad('atolye-kil', 'Kil', '#C0572A', '#8A3D1C'),
      grad('atolye-lacivert', 'Lacivert', '#3A5A8C', '#1F3654'),
      grad('atolye-toprak', 'Toprak', '#8A6D3A', '#5C481F'),
      grad('atolye-duman', 'Duman', '#6B6B6B', '#252525'),
    ],
  },
} as const satisfies Record<ThemeFamilyKey, ThemeFamily>;

/** A key of the five families resolves to its definition; any other value (stale, unknown) to the default. */
export function getThemeFamily(key: string | null | undefined): ThemeFamily {
  return isThemeFamilyKey(key) ? THEME_FAMILIES[key] : THEME_FAMILIES[DEFAULT_THEME_FAMILY];
}

export function isThemeFamilyKey(value: string | null | undefined): value is ThemeFamilyKey {
  return !!value && (THEME_FAMILY_KEYS as readonly string[]).includes(value);
}

/** True for every key the API stores. */
export function isStoredThemeFamilyKey(value: string | null | undefined): value is StoredThemeFamilyKey {
  return isThemeFamilyKey(value);
}

// -- Super-admin allow-list ------------------------------------------------

/**
 * The super admin decides which families a restaurant may use. The decision is
 * stored as tenant-scoped (or global) feature flags named
 * `theme_family.<key>` (no schema change); `perfect` needs no flag, it is
 * always allowed. A tenant row wins over a global row, as for every flag.
 */
export const THEME_FAMILY_FLAG_PREFIX = 'theme_family.';

export function themeFamilyFlagKey(key: OptionalThemeFamilyKey): string {
  return `${THEME_FAMILY_FLAG_PREFIX}${key}`;
}

export interface ThemeFamilyFlagRow {
  key: string;
  scope: 'TENANT' | 'GLOBAL' | 'BUSINESS_TYPE';
  enabled: boolean;
}

/**
 * Allowed families from the flag rows that apply to one restaurant. Always
 * contains the default family first; the optional ones follow in catalog order.
 */
export function resolveAllowedThemeFamilies(rows: readonly ThemeFamilyFlagRow[]): ThemeFamilyKey[] {
  const allowed: ThemeFamilyKey[] = [DEFAULT_THEME_FAMILY];
  for (const key of OPTIONAL_THEME_FAMILY_KEYS) {
    const flag = themeFamilyFlagKey(key);
    const tenant = rows.find((r) => r.key === flag && r.scope === 'TENANT');
    const global = rows.find((r) => r.key === flag && r.scope === 'GLOBAL');
    if (tenant ? tenant.enabled : global?.enabled === true) allowed.push(key);
  }
  return allowed;
}

/** True when `family` may render for a restaurant with this allow-list; the default family always may. */
export function isThemeFamilyAllowed(
  family: string | null | undefined,
  allowed: readonly string[] | null | undefined,
): boolean {
  if (!isThemeFamilyKey(family)) return false;
  return family === DEFAULT_THEME_FAMILY || (allowed ?? []).includes(family);
}
