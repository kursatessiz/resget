import { z } from 'zod';
import { ON_BRAND_DARK, ON_BRAND_LIGHT, deriveBrandPalette, wcagContrast } from './brand';
import type { BrandPalette } from './brand';
import {
  COLOR_SCHEME_PREFERENCES,
  DEFAULT_THEME_FAMILY,
  PERFECT_UI_TOKENS,
  STORED_THEME_FAMILY_KEYS,
  THEME_FAMILIES,
  getThemeFamily,
  isThemeFamilyAllowed,
} from './themes';
import type {
  ColorMode,
  GradientPreset,
  PerfectRoleColors,
  StoredThemeFamilyKey,
  ThemeColors,
  ThemeFamily,
  ThemeFamilyKey,
} from './themes';

/**
 * Design tokens shared by web and mobile: the Perfect UI tokens
 * (themes.ts, PERFECT_UI_TOKENS and the optional families) plus the tenant brand. Apps must read
 * colors, spacing, radii and type from here instead of hardcoding values.
 * resolveTheme() combines the tenant's brand with the user's light/dark
 * choice; themeCssVariables() turns the result into `--pui-*` variables.
 */

const PUI_L = PERFECT_UI_TOKENS.colors.light;

// Neutral scale of the kit (cool gray). Semantic colors are the kit's light values.
export const palette = {
  ink: {
    950: '#030712',
    900: '#111827',
    800: '#1f2937',
    700: '#374151',
    500: '#6b7280',
    300: '#d1d5db',
    200: '#e5e7eb',
    100: '#f3f4f6',
    50: '#f9fafb',
  },
  white: '#ffffff',
  black: '#000000',
  success: PUI_L.success,
  warning: PUI_L.warn,
  danger: PUI_L.error,
  info: PUI_L.theme,
} as const;

export const semanticColors = {
  light: THEME_FAMILIES.perfect.colors.light,
  dark: THEME_FAMILIES.perfect.colors.dark,
} as const;

/** Multiples of the kit's `--pui-space` (4px). */
export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

/** sm is the kit's `--pui-radius`, md the card radius (1.5x). */
export const radii = {
  sm: PERFECT_UI_TOKENS.radius,
  md: PERFECT_UI_TOKENS.radius * 1.5,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const typography = {
  fontFamily: {
    sans: PERFECT_UI_TOKENS.fontFamily,
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  size: { xs: 12, sm: PERFECT_UI_TOKENS.fontSize, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 36 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { tight: 1.2, normal: 1.5 },
} as const;

/**
 * The only places a gradient may be rendered. Everything else, including
 * primary buttons and header bands, is flat (`pui-solid pui-theme`).
 */
export const GRADIENT_SLOTS = ['memberCard', 'packageCard'] as const;
export type GradientSlot = (typeof GRADIENT_SLOTS)[number];

/**
 * Gradient preset keys that may be stored on a restaurant. Since T1 the value is
 * accepted and ignored: the gradient is derived from the primary color.
 * The legacy catalog is kept so stored values and old clients stay valid.
 */
export const GRADIENT_PRESET_KEYS_BY_FAMILY = {
  perfect: ['perfect-brand'],
  noir: ['noir-kiremit', 'noir-zumrut', 'noir-gece', 'noir-kehribar', 'noir-grafit'],
  nefes: ['nefes-adacayi', 'nefes-seftali', 'nefes-gok', 'nefes-lavanta', 'nefes-bugday'],
  saha: ['saha-turuncu', 'saha-yesil', 'saha-mavi', 'saha-sari', 'saha-komur'],
  atolye: ['atolye-orman', 'atolye-kil', 'atolye-lacivert', 'atolye-toprak', 'atolye-duman'],
} as const satisfies Record<StoredThemeFamilyKey, readonly string[]>;

export type GradientPresetKey = (typeof GRADIENT_PRESET_KEYS_BY_FAMILY)[StoredThemeFamilyKey][number];

export const GRADIENT_PRESET_KEYS = Object.values(
  GRADIENT_PRESET_KEYS_BY_FAMILY,
).flat() as readonly GradientPresetKey[];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The preset key a restaurant gets when it switches to `family`: the family's first one (the schema ties a non-default family to its own presets). */
export function gradientKeyForFamily(family: StoredThemeFamilyKey): GradientPresetKey {
  return GRADIENT_PRESET_KEYS_BY_FAMILY[family][0];
}

/** The stored family of a preset key, or null for an unknown key. */
export function familyOfGradient(key: string): StoredThemeFamilyKey | null {
  for (const family of STORED_THEME_FAMILY_KEYS) {
    if ((GRADIENT_PRESET_KEYS_BY_FAMILY[family] as readonly string[]).includes(key)) return family;
  }
  return null;
}

/**
 * Everything a tenant may customise: logo and primary color. The family and
 * gradient fields are still validated as before (legacy keys allowed, a
 * legacy gradient must belong to its legacy family) so the API contract is
 * unchanged, but neither changes what renders.
 */
export const TenantThemeSchema = z
  .object({
    logoUrl: z.string().url().nullable(),
    themeFamily: z.enum(STORED_THEME_FAMILY_KEYS),
    themePrimary: z.string().regex(HEX, 'Renk #RRGGBB formatında olmalı'),
    gradientPresetKey: z.enum(GRADIENT_PRESET_KEYS as [GradientPresetKey, ...GradientPresetKey[]]),
  })
  .refine((t) => t.themeFamily === DEFAULT_THEME_FAMILY || familyOfGradient(t.gradientPresetKey) === t.themeFamily, {
    path: ['gradientPresetKey'],
    message: 'Gradyan seçilen tema ailesine ait olmalı',
  });
export type TenantTheme = z.infer<typeof TenantThemeSchema>;

/**
 * A tenant theme as the API delivers it to clients: the stored values plus
 * the families the super admin allowed for this restaurant (D7). A client that
 * lacks the list renders the default family.
 */
export type TenantThemeView = TenantTheme & { allowedThemeFamilies?: ThemeFamilyKey[] };

export const UpdateTenantThemeSchema = TenantThemeSchema;
export type UpdateTenantThemeInput = TenantTheme;

export const DEFAULT_TENANT_THEME: TenantTheme = {
  logoUrl: null,
  themeFamily: DEFAULT_THEME_FAMILY,
  themePrimary: '#0092CD',
  gradientPresetKey: 'perfect-brand',
};

/** A user's own appearance choice. The family is legacy and ignored when rendering. */
export const AppearancePreferenceSchema = z.object({
  themeFamily: z.enum(STORED_THEME_FAMILY_KEYS).nullable(),
  colorScheme: z.enum(COLOR_SCHEME_PREFERENCES),
});
export type AppearancePreference = z.infer<typeof AppearancePreferenceSchema>;

export const DEFAULT_APPEARANCE: AppearancePreference = { themeFamily: null, colorScheme: 'SYSTEM' };

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(i, i + 2), 16);
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Mixes a #RRGGBB color toward black by `amount` (0..1). */
export function shade(hex: string, amount: number): string {
  const k = 1 - amount;
  return toHex(channel(hex, 1) * k, channel(hex, 3) * k, channel(hex, 5) * k);
}

/** The single brand gradient: the primary color into a 37% darker shade, at 135deg. */
export function brandGradient(primary: string): GradientPreset {
  const from = HEX.test(primary) ? primary.toLowerCase() : DEFAULT_TENANT_THEME.themePrimary.toLowerCase();
  return { key: 'perfect-brand', label: 'Perfect UI', angle: 135, stops: [from, shade(from, 0.37)] };
}

/**
 * Text color on the brand gradient: white when it stays readable over the
 * whole gradient (large text on the light end, body text on the dark end),
 * otherwise the darkest ink.
 */
export function onGradient(gradient: GradientPreset): string {
  const [from] = gradient.stops;
  const to = gradient.stops[gradient.stops.length - 1];
  return contrastRatio(palette.white, from) >= 3 && contrastRatio(palette.white, to) >= 4.5
    ? palette.white
    : ON_BRAND_DARK;
}

/** CSS value for web. Mobile passes `brandGradient(primary).stops` to its gradient component. */
export function gradientCss(primary: string): string {
  const { angle, stops } = brandGradient(primary);
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

/** What resolveTheme() accepts: stored rows, API payloads or form state, validated or not. */
export interface TenantThemeInput {
  logoUrl?: string | null;
  themeFamily?: string | null;
  themePrimary?: string | null;
  gradientPresetKey?: string | null;
  /** Families the super admin allowed; the stored family renders only when it is in here (the default always renders). */
  allowedThemeFamilies?: readonly string[] | null;
}

export interface ResolvedTheme {
  family: ThemeFamily;
  mode: ColorMode;
  /**
   * `primary` is the brand color as used on solid surfaces, already corrected
   * for contrast (see brand.ts); `onPrimary` the text on it; the rest are
   * the other values of the brand palette for this mode.
   */
  colors: ThemeColors & {
    primary: string;
    onPrimary: string;
    primaryHover: string;
    primaryMuted: string;
    primarySubtleBg: string;
    /** Link and accent text: reaches 4.5:1 on the page background. */
    primaryText: string;
  };
  /** The brand palette of both modes (web emits it as light-dark() pairs). */
  brand: Record<ColorMode, BrandPalette>;
  roles: PerfectRoleColors;
  /** Derived from the primary color; only for GRADIENT_SLOTS. */
  gradient: GradientPreset;
  logoUrl: string | null;
  /** True when the tenant keeps the kit's default color (informational; it is corrected like any other color). */
  isDefaultPrimary: boolean;
}

/**
 * The theme a screen renders: the Perfect UI family, the user's mode (or
 * the OS mode) and always the tenant's primary color and logo. Unknown or
 * stale values fall back to defaults instead of throwing.
 */
export function resolveTheme(params: {
  tenant: TenantThemeInput | null | undefined;
  appearance: Partial<AppearancePreference> | null | undefined;
  systemMode: ColorMode | null | undefined;
}): ResolvedTheme {
  const tenant = {
    logoUrl: params.tenant?.logoUrl ?? null,
    themePrimary: params.tenant?.themePrimary ?? DEFAULT_TENANT_THEME.themePrimary,
  };
  const appearance = { ...DEFAULT_APPEARANCE, ...(params.appearance ?? {}) };
  const requestedFamily = params.tenant?.themeFamily;
  // A stored family the super admin has not allowed renders as the default family.
  const family = getThemeFamily(
    isThemeFamilyAllowed(requestedFamily, params.tenant?.allowedThemeFamilies) ? requestedFamily : DEFAULT_THEME_FAMILY,
  );
  const mode: ColorMode =
    appearance.colorScheme === 'LIGHT'
      ? 'light'
      : appearance.colorScheme === 'DARK'
        ? 'dark'
        : (params.systemMode ?? 'light');
  const valid = typeof tenant.themePrimary === 'string' && HEX.test(tenant.themePrimary);
  // True when the tenant keeps the kit's default color. It gets no special treatment: the default goes
  // through the same contrast rule as every other color (brand.ts).
  const isDefaultPrimary =
    !valid || tenant.themePrimary.toLowerCase() === DEFAULT_TENANT_THEME.themePrimary.toLowerCase();
  const chosen = valid ? tenant.themePrimary : DEFAULT_TENANT_THEME.themePrimary;
  const brandOf = (m: ColorMode): BrandPalette =>
    deriveBrandPalette(chosen, { mode: m, background: family.colors[m].background });
  const brand = { light: brandOf('light'), dark: brandOf('dark') };
  const current = brand[mode];
  return {
    family,
    mode,
    colors: {
      ...family.colors[mode],
      primary: current.primary,
      onPrimary: current.onPrimary,
      primaryHover: current.primaryHover,
      primaryMuted: current.primaryMuted,
      primarySubtleBg: current.primarySubtleBg,
      primaryText: current.primaryText,
    },
    brand,
    roles: { ...family.roles[mode], theme: current.primary },
    // The gradient starts from the corrected solid color so the cards and buttons agree.
    gradient: brandGradient(current.primary),
    logoUrl: tenant.logoUrl ?? null,
    isDefaultPrimary,
  };
}

/** `light-dark()` pair of one color of a family. */
function pair(family: ThemeFamily, pick: (colors: ThemeColors, roles: PerfectRoleColors) => string): string {
  return `light-dark(${pick(family.colors.light, family.roles.light)}, ${pick(family.colors.dark, family.roles.dark)})`;
}

/**
 * CSS custom properties for a web theme root (the `style` of a wrapper).
 *
 * Neutrals and roles are emitted as the kit's `light-dark()` pairs, so the
 * wrapper's `color-scheme` (set from the user's light/dark/system choice)
 * picks the mode. `--pui-theme` is the tenant primary; the kit default
 * keeps its own light/dark pair. The `--color-*`, `--font-*`,
 * `--radius-*` and `--gradient-brand` names are aliases kept for screens
 * that were not yet moved to the component library.
 */
export function themeCssVariables(theme: ResolvedTheme): Record<string, string> {
  const f = theme.family;
  const lightDark = (light: string, dark: string): string => (light === dark ? light : `light-dark(${light}, ${dark})`);
  const b = theme.brand;
  // The solid brand color is mode independent for a custom primary; the kit default keeps its light/dark pair.
  const brand = lightDark(b.light.primary, b.dark.primary);
  const flatSurface = (['light', 'dark'] as const).every((m) => f.colors[m].surface === f.colors[m].background);
  const vars: Record<string, string> = {
    '--pui-bg': pair(f, (c) => c.background),
    '--pui-bg-muted': pair(f, (c) => c.surfaceMuted),
    '--pui-bg-emphasis': pair(f, (c) => c.surfaceEmphasis),
    '--pui-text': pair(f, (c) => c.textPrimary),
    '--pui-text-muted': pair(f, (c) => c.textMuted),
    '--pui-border': pair(f, (c) => c.border),
    '--pui-theme': brand,
    '--pui-success': pair(f, (_c, r) => r.success),
    '--pui-warn': pair(f, (_c, r) => r.warn),
    '--pui-error': pair(f, (_c, r) => r.error),
    '--pui-muted': pair(f, (_c, r) => r.muted),
    '--pui-radius': `${f.radii.input / 16}rem`,
    '--pui-space': `${PERFECT_UI_TOKENS.space / 16}rem`,
    '--pui-font-size': `${PERFECT_UI_TOKENS.fontSize / 16}rem`,
    '--pui-border-width': `${PERFECT_UI_TOKENS.borderWidth}px`,
    // Text on the brand color: the kit uses the page color; a tenant color gets a contrast-checked one.
    '--pui-on-theme': b.light.onPrimary,
    '--pui-theme-hover': lightDark(b.light.primaryHover, b.dark.primaryHover),
    '--pui-theme-muted': lightDark(b.light.primaryMuted, b.dark.primaryMuted),
    '--pui-theme-subtle': lightDark(b.light.primarySubtleBg, b.dark.primarySubtleBg),
    // Link and accent text of the brand color: corrected to 4.5:1 on the page of each mode.
    '--pui-theme-text': lightDark(b.light.primaryText, b.dark.primaryText),
    '--color-background': 'var(--pui-bg)',
    '--color-surface': flatSurface ? 'var(--pui-bg)' : pair(f, (c) => c.surface),
    '--color-surface-muted': 'var(--pui-bg-muted)',
    '--color-surface-emphasis': 'var(--pui-bg-emphasis)',
    '--color-border': 'var(--pui-border)',
    '--color-text-primary': 'var(--pui-text)',
    '--color-text-secondary': 'color-mix(in oklab, var(--pui-text) 80%, transparent)',
    '--color-text-muted': 'var(--pui-text-muted)',
    '--color-primary': 'var(--pui-theme)',
    '--color-on-primary': 'var(--pui-on-theme)',
    '--color-primary-text': 'var(--pui-theme-text)',
    '--color-primary-hover': 'var(--pui-theme-hover)',
    '--color-success': 'var(--pui-success)',
    '--color-warning': 'var(--pui-warn)',
    '--color-danger': 'var(--pui-error)',
    '--gradient-brand': gradientCss(theme.gradient.stops[0]),
    '--gradient-brand-on': onGradient(theme.gradient),
    '--font-display': f.fonts.display.web,
    '--font-body': f.fonts.body.web,
    '--radius-card': `${f.radii.card}px`,
    '--radius-button': `${f.radii.button}px`,
    '--radius-chip': `${f.radii.chip}px`,
    '--radius-input': `${f.radii.input}px`,
  };
  return vars;
}

/** The `color-scheme` a theme root sets: a fixed mode, or both for "follow the OS". */
export function themeColorScheme(
  colorScheme: AppearancePreference['colorScheme'] | null | undefined,
): 'light' | 'dark' | 'light dark' {
  return colorScheme === 'LIGHT' ? 'light' : colorScheme === 'DARK' ? 'dark' : 'light dark';
}

/** The `data-pui-mode` a theme root sets; undefined lets the OS decide. */
export function themePuiMode(
  colorScheme: AppearancePreference['colorScheme'] | null | undefined,
): ColorMode | undefined {
  return colorScheme === 'LIGHT' ? 'light' : colorScheme === 'DARK' ? 'dark' : undefined;
}

/** WCAG relative luminance contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  return wcagContrast(a, b);
}

/** Text color for content on top of a tenant's primary color: white, or near-black when white is not readable. */
export function onColor(background: string): string {
  return contrastRatio(background, ON_BRAND_LIGHT) >= 4.5 ? ON_BRAND_LIGHT : ON_BRAND_DARK;
}
