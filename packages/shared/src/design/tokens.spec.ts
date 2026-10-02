import {
  AppearancePreferenceSchema,
  DEFAULT_TENANT_THEME,
  GRADIENT_PRESET_KEYS,
  GRADIENT_SLOTS,
  TenantThemeSchema,
  brandGradient,
  contrastRatio,
  familyOfGradient,
  gradientCss,
  onColor,
  palette,
  resolveTheme,
  semanticColors,
  shade,
  themeColorScheme,
  themeCssVariables,
  themePuiMode,
} from './tokens';
import {
  DEFAULT_THEME_FAMILY,
  OPTIONAL_THEME_FAMILY_KEYS,
  PERFECT_UI_TOKENS,
  THEME_FAMILIES,
  THEME_FAMILY_KEYS,
  getThemeFamily,
  isThemeFamilyAllowed,
  resolveAllowedThemeFamilies,
  themeFamilyFlagKey,
} from './themes';

describe('design tokens (Perfect UI)', () => {
  it('names only Inter faces for the native fonts', () => {
    const { display, body } = THEME_FAMILIES.perfect.fonts;
    for (const face of [...Object.values(display.native), ...Object.values(body.native)]) {
      expect(face).toMatch(/^Inter_\d{3}[A-Za-z]+$/);
    }
  });

  it('has five families with perfect as the default and maps unknown keys to it', () => {
    expect(THEME_FAMILY_KEYS).toEqual(['perfect', 'noir', 'nefes', 'saha', 'atolye']);
    expect(DEFAULT_THEME_FAMILY).toBe('perfect');
    for (const key of THEME_FAMILY_KEYS) expect(getThemeFamily(key).key).toBe(key);
    for (const key of ['mor', '', null, undefined]) expect(getThemeFamily(key).key).toBe('perfect');
  });

  it('every optional family emits exactly the variables of the default family', () => {
    const names = Object.keys(
      themeCssVariables(resolveTheme({ tenant: null, appearance: null, systemMode: 'light' })),
    ).sort();
    for (const key of OPTIONAL_THEME_FAMILY_KEYS) {
      const theme = resolveTheme({
        tenant: { themeFamily: key, themePrimary: '#1F6F5C', allowedThemeFamilies: [key] },
        appearance: null,
        systemMode: 'light',
      });
      expect(theme.family.key).toBe(key);
      const vars = themeCssVariables(theme);
      expect(Object.keys(vars).sort()).toEqual(names);
      expect(vars['--pui-bg']).toBe(
        `light-dark(${THEME_FAMILIES[key].colors.light.background}, ${THEME_FAMILIES[key].colors.dark.background})`,
      );
      expect(vars['--font-body']).toContain('Inter');
      for (const mode of ['light', 'dark'] as const) {
        const c = THEME_FAMILIES[key].colors[mode];
        expect(contrastRatio(c.textPrimary, c.background)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(c.textSecondary, c.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.textPrimary, c.surface)).toBeGreaterThanOrEqual(7);
      }
      // Gradients stay data of the family; the gradient slots stay the only place they render.
      expect(THEME_FAMILIES[key].gradients.length).toBeGreaterThan(0);
    }
  });

  it('renders a stored family only when the super admin allowed it', () => {
    const stored = { themeFamily: 'saha', themePrimary: '#1F6F5C' };
    const resolve = (allowed?: string[] | null) =>
      resolveTheme({ tenant: { ...stored, allowedThemeFamilies: allowed }, appearance: null, systemMode: 'light' })
        .family.key;
    expect(resolve()).toBe('perfect');
    expect(resolve(null)).toBe('perfect');
    expect(resolve(['perfect'])).toBe('perfect');
    expect(resolve(['perfect', 'noir'])).toBe('perfect');
    expect(resolve(['perfect', 'saha'])).toBe('saha');
    expect(resolveTheme({ tenant: { themeFamily: 'perfect' }, appearance: null, systemMode: 'light' }).family.key).toBe(
      'perfect',
    );
  });

  it('resolves the allow-list from tenant and global flag rows, perfect always included', () => {
    expect(resolveAllowedThemeFamilies([])).toEqual(['perfect']);
    expect(themeFamilyFlagKey('noir')).toBe('theme_family.noir');
    expect(
      resolveAllowedThemeFamilies([
        { key: 'theme_family.noir', scope: 'TENANT', enabled: true },
        { key: 'theme_family.nefes', scope: 'GLOBAL', enabled: true },
        { key: 'theme_family.saha', scope: 'TENANT', enabled: false },
        { key: 'theme_family.atolye', scope: 'BUSINESS_TYPE', enabled: true },
      ]),
    ).toEqual(['perfect', 'noir', 'nefes']);
    // A tenant row beats a global row in both directions.
    expect(
      resolveAllowedThemeFamilies([
        { key: 'theme_family.noir', scope: 'GLOBAL', enabled: true },
        { key: 'theme_family.noir', scope: 'TENANT', enabled: false },
      ]),
    ).toEqual(['perfect']);
    expect(isThemeFamilyAllowed('perfect', [])).toBe(true);
    expect(isThemeFamilyAllowed('noir', ['perfect'])).toBe(false);
    expect(isThemeFamilyAllowed('noir', ['perfect', 'noir'])).toBe(true);
    expect(isThemeFamilyAllowed('mor', ['mor'])).toBe(false);
  });

  it('copies the kit core.css colors exactly', () => {
    expect(PERFECT_UI_TOKENS.colors.light).toMatchObject({
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
    });
    expect(PERFECT_UI_TOKENS.colors.dark).toMatchObject({
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
    });
    expect([PERFECT_UI_TOKENS.radius, PERFECT_UI_TOKENS.space, PERFECT_UI_TOKENS.fontSize]).toEqual([6, 4, 14]);
    expect(THEME_FAMILIES.perfect.radii).toEqual({ card: 9, button: 6, chip: 9999, input: 6 });
  });

  it('keeps exactly two gradient slots', () => {
    expect(GRADIENT_SLOTS).toEqual(['memberCard', 'packageCard']);
  });

  it('accepts the default theme and rejects free-form values', () => {
    expect(TenantThemeSchema.parse(DEFAULT_TENANT_THEME)).toEqual(DEFAULT_TENANT_THEME);
    expect(TenantThemeSchema.safeParse({ ...DEFAULT_TENANT_THEME, themePrimary: 'purple' }).success).toBe(false);
    expect(TenantThemeSchema.safeParse({ ...DEFAULT_TENANT_THEME, gradientPresetKey: 'neon' }).success).toBe(false);
    expect(TenantThemeSchema.safeParse({ ...DEFAULT_TENANT_THEME, themeFamily: 'mor' }).success).toBe(false);
  });

  it('keeps accepting stored legacy keys without rewriting them', () => {
    const legacy = { logoUrl: null, themeFamily: 'saha', themePrimary: '#1FA37A', gradientPresetKey: 'saha-yesil' };
    expect(TenantThemeSchema.parse(legacy)).toEqual(legacy);
    // The old contract still holds for legacy families: the preset must belong to the family.
    expect(TenantThemeSchema.safeParse({ ...legacy, gradientPresetKey: 'nefes-lavanta' }).success).toBe(false);
    // The current family takes any known preset key and ignores it.
    expect(
      TenantThemeSchema.safeParse({ ...legacy, themeFamily: 'perfect', gradientPresetKey: 'nefes-lavanta' }).success,
    ).toBe(true);
    expect(new Set(GRADIENT_PRESET_KEYS).size).toBe(GRADIENT_PRESET_KEYS.length);
    expect(familyOfGradient('atolye-kil')).toBe('atolye');
    expect(familyOfGradient('perfect-brand')).toBe('perfect');
  });

  it('kit neutrals keep text readable in light and dark', () => {
    for (const mode of ['light', 'dark'] as const) {
      const c = semanticColors[mode];
      for (const bg of [c.background, c.surface, c.surfaceMuted]) {
        expect(contrastRatio(c.textPrimary, bg)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(c.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.textMuted, bg)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('derives one two-stop gradient from the primary color and ignores the preset key', () => {
    expect(shade('#0092cd', 0.37)).toBe('#005c81');
    expect(brandGradient('#2B74B9').stops).toEqual(['#2b74b9', shade('#2b74b9', 0.37)]);
    expect(gradientCss('#0092CD')).toBe('linear-gradient(135deg, #0092cd, #005c81)');
    const a = resolveTheme({
      tenant: { themePrimary: '#2B74B9', gradientPresetKey: 'saha-mavi' },
      appearance: null,
      systemMode: 'light',
    });
    const b = resolveTheme({
      tenant: { themePrimary: '#2B74B9', gradientPresetKey: 'noir-grafit' },
      appearance: null,
      systemMode: 'light',
    });
    expect(a.gradient).toEqual(b.gradient);
  });

  it('resolveTheme: the user mode wins, the tenant brand always stays', () => {
    // saha is stored but not allowed here, so it renders as the default family.
    const tenant = {
      ...DEFAULT_TENANT_THEME,
      themeFamily: 'saha' as const,
      gradientPresetKey: 'saha-mavi' as const,
      themePrimary: '#2B74B9',
    };
    const bySystem = resolveTheme({ tenant, appearance: null, systemMode: 'dark' });
    expect(bySystem.family.key).toBe('perfect');
    expect(bySystem.mode).toBe('dark');
    expect(bySystem.colors.background).toBe(PERFECT_UI_TOKENS.colors.dark.bg);

    const byUser = resolveTheme({
      tenant,
      appearance: { themeFamily: 'nefes', colorScheme: 'LIGHT' },
      systemMode: 'dark',
    });
    expect(byUser.family.key).toBe('perfect');
    expect(byUser.mode).toBe('light');
    expect(byUser.colors.primary).toBe('#2B74B9');
    expect(byUser.colors.onPrimary).toBe(onColor('#2B74B9'));
  });

  it('resolveTheme never throws on stale values', () => {
    const t = resolveTheme({
      tenant: { themeFamily: 'eski' as never, gradientPresetKey: 'sage' as never, themePrimary: 'x' },
      appearance: { themeFamily: 'yok' as never },
      systemMode: null,
    });
    expect(t.family.key).toBe('perfect');
    expect(t.isDefaultPrimary).toBe(true);
    expect(t.colors.primary).toBe('#007db1');
    expect(t.colors.onPrimary).toBe(palette.white);
    expect(Object.keys(themeCssVariables(t))).toContain('--gradient-brand');
  });

  it('themeCssVariables emits the kit variables and the legacy aliases', () => {
    const tenant = resolveTheme({
      tenant: { themePrimary: '#C8443C' },
      appearance: { colorScheme: 'DARK' },
      systemMode: 'light',
    });
    const vars = themeCssVariables(tenant);
    expect(vars['--pui-theme']).toBe('#C8443C');
    expect(vars['--pui-on-theme']).toBe(onColor('#C8443C'));
    expect(vars['--pui-bg']).toBe('light-dark(#ffffff, #000000)');
    expect(vars['--pui-text-muted']).toBe('light-dark(#676d7b, #9ca3af)');
    expect(vars['--pui-radius']).toBe('0.375rem');
    expect(vars['--pui-space']).toBe('0.25rem');
    expect(vars['--pui-font-size']).toBe('0.875rem');
    expect(vars['--color-background']).toBe('var(--pui-bg)');
    expect(vars['--color-surface']).toBe('var(--pui-bg)');
    expect(vars['--color-surface-muted']).toBe('var(--pui-bg-muted)');
    expect(vars['--color-border']).toBe('var(--pui-border)');
    expect(vars['--color-text-primary']).toBe('var(--pui-text)');
    expect(vars['--color-text-muted']).toBe('var(--pui-text-muted)');
    expect(vars['--color-primary']).toBe('var(--pui-theme)');
    expect(vars['--color-on-primary']).toBe('var(--pui-on-theme)');
    expect(vars['--radius-card']).toBe('9px');
    expect(vars['--radius-button']).toBe('6px');
    expect(vars['--radius-chip']).toBe('9999px');
    expect(vars['--radius-input']).toBe('6px');
    expect(vars['--font-body']).toContain('Inter');
    expect(vars['--gradient-brand']).toBe(gradientCss('#C8443C'));

    const kitDefault = themeCssVariables(resolveTheme({ tenant: null, appearance: null, systemMode: 'light' }));
    expect(kitDefault['--pui-theme']).toBe('#007db1');
    expect(kitDefault['--pui-on-theme']).toBe(palette.white);
  });

  it('maps the light/dark/system choice to color-scheme and data-pui-mode', () => {
    expect([themeColorScheme('LIGHT'), themeColorScheme('DARK'), themeColorScheme('SYSTEM')]).toEqual([
      'light',
      'dark',
      'light dark',
    ]);
    expect([themePuiMode('LIGHT'), themePuiMode('DARK'), themePuiMode('SYSTEM')]).toEqual(['light', 'dark', undefined]);
  });

  it('appearance schema accepts follow-tenant and legacy families, rejects unknown ones', () => {
    expect(AppearancePreferenceSchema.safeParse({ themeFamily: null, colorScheme: 'SYSTEM' }).success).toBe(true);
    expect(AppearancePreferenceSchema.safeParse({ themeFamily: 'nefes', colorScheme: 'DARK' }).success).toBe(true);
    expect(AppearancePreferenceSchema.safeParse({ themeFamily: 'mor', colorScheme: 'SYSTEM' }).success).toBe(false);
  });

  it('picks a readable text color on tenant primaries', () => {
    expect(onColor('#1d4e89')).toBe(palette.white);
    expect(onColor('#e3c9a0')).toBe(palette.ink[900]);
  });
});
