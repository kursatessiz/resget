import {
  MIN_TEXT_CONTRAST,
  ON_BRAND_DARK,
  ON_BRAND_LIGHT,
  SOLID_MAX_LIGHTNESS_SHIFT,
  deriveBrandPalette,
  deriveHover,
  oklchLightness,
  relativeLuminance,
  wcagContrast,
} from './brand';
import { palette, resolveTheme, themeCssVariables } from './tokens';
import { THEME_FAMILIES } from './themes';

const PAGE = { light: '#ffffff', dark: '#000000' } as const;

/** Hue (degrees) and saturation of a #RRGGBB color in HSL. */
function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function hueDrift(a: string, b: string): number {
  const d = Math.abs(hsl(a).h - hsl(b).h);
  return Math.min(d, 360 - d);
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const TABLE = [
  '#0092cd',
  '#ffffff',
  '#000000',
  '#ffff00',
  '#ff0000',
  '#1a1a1a',
  '#e5e7eb',
  '#c8443c',
  '#2b74b9',
  '#00ff00',
  '#ff00ff',
  '#808080',
  '#777777',
  '#07b6f0',
  '#f59e0b',
];

describe('deriveBrandPalette', () => {
  it('prefers white: #0092cd is darkened within the cap until white reaches 4.5:1', () => {
    expect(wcagContrast('#ffffff', '#0092cd')).toBeLessThan(MIN_TEXT_CONTRAST);
    const p = deriveBrandPalette('#0092cd');
    expect(p.onPrimary).toBe(ON_BRAND_LIGHT);
    expect(p.primary).toBe('#007db1');
    expect(wcagContrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(relativeLuminance(p.primary)).toBeLessThan(relativeLuminance('#0092cd'));
    expect(oklchLightness('#0092cd') - oklchLightness(p.primary)).toBeGreaterThan(0);
    expect(oklchLightness('#0092cd') - oklchLightness(p.primary)).toBeLessThanOrEqual(SOLID_MAX_LIGHTNESS_SHIFT);
    expect(hueDrift('#0092cd', p.primary)).toBeLessThanOrEqual(6);
  });

  it('uses white when it is readable and near-black (never pure black) otherwise', () => {
    expect(deriveBrandPalette('#1a1a1a').onPrimary).toBe(ON_BRAND_LIGHT);
    expect(deriveBrandPalette('#000000').onPrimary).toBe(ON_BRAND_LIGHT);
    expect(deriveBrandPalette('#c8443c').onPrimary).toBe(ON_BRAND_LIGHT);
    expect(deriveBrandPalette('#ffffff').onPrimary).toBe(ON_BRAND_DARK);
    expect(deriveBrandPalette('#ffff00').onPrimary).toBe(ON_BRAND_DARK);
    expect(deriveBrandPalette('#ffff00').primary).toBe('#ffff00');
    expect(deriveBrandPalette('#e5e7eb').onPrimary).toBe(ON_BRAND_DARK);
    expect(ON_BRAND_DARK).toBe(palette.ink[900]);
    for (const hex of TABLE) expect([ON_BRAND_LIGHT, ON_BRAND_DARK]).toContain(deriveBrandPalette(hex).onPrimary);
  });

  it('corrects a color where neither text color reaches 4.5:1 (pure red) and keeps the hue', () => {
    expect(wcagContrast('#ffffff', '#ff0000')).toBeLessThan(MIN_TEXT_CONTRAST);
    expect(wcagContrast(ON_BRAND_DARK, '#ff0000')).toBeLessThan(MIN_TEXT_CONTRAST);
    const p = deriveBrandPalette('#ff0000');
    expect(p.primary).not.toBe('#ff0000');
    expect(wcagContrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(hueDrift('#ff0000', p.primary)).toBeLessThanOrEqual(6);
    expect(Math.abs(oklchLightness(p.primary) - oklchLightness('#ff0000'))).toBeLessThanOrEqual(
      SOLID_MAX_LIGHTNESS_SHIFT,
    );
  });

  it('leaves colors that already pass untouched, in their original spelling', () => {
    for (const hex of ['#C8443C', '#1a1a1a', '#ffff00', '#000000', '#ffffff', '#e5e7eb']) {
      expect(deriveBrandPalette(hex).primary).toBe(hex);
    }
  });

  it.each(TABLE)('%s: every guarantee holds in light and dark', (hex) => {
    const base = deriveBrandPalette(hex);
    // Solid surface: readable text, bounded shift, same hue.
    expect(wcagContrast(base.onPrimary, base.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(Math.abs(oklchLightness(base.primary) - oklchLightness(hex))).toBeLessThanOrEqual(SOLID_MAX_LIGHTNESS_SHIFT);
    if (hsl(hex).s > 0.1 && hsl(hex).l > 0.05 && hsl(hex).l < 0.95)
      expect(hueDrift(hex, base.primary)).toBeLessThanOrEqual(6);
    // Hover keeps the text readable and is visibly different.
    expect(base.primaryHover).not.toBe(base.primary);
    expect(wcagContrast(base.onPrimary, base.primaryHover)).toBeGreaterThanOrEqual(
      Math.min(MIN_TEXT_CONTRAST, wcagContrast(base.onPrimary, base.primary)),
    );

    for (const mode of ['light', 'dark'] as const) {
      const p = deriveBrandPalette(hex, { mode });
      // The solid part does not depend on the mode.
      expect([p.primary, p.onPrimary, p.primaryHover]).toEqual([base.primary, base.onPrimary, base.primaryHover]);
      // Accent text reads on the page and on the subtle background built from the solid color.
      expect(wcagContrast(p.primaryText, PAGE[mode])).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(wcagContrast(p.primaryText, p.primarySubtleBg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      if (
        hsl(hex).s > 0.1 &&
        hsl(hex).l > 0.05 &&
        hsl(hex).l < 0.95 &&
        hsl(p.primaryText).l > 0.05 &&
        hsl(p.primaryText).l < 0.95
      ) {
        expect(hueDrift(hex, p.primaryText)).toBeLessThanOrEqual(6);
      }
      // Tints sit between the solid color and the page.
      for (const tint of [p.primarySubtleBg, p.primaryMuted]) expect(tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(wcagContrast(p.primarySubtleBg, PAGE[mode])).toBeLessThan(
        wcagContrast(p.primaryMuted, PAGE[mode]) + 0.0001,
      );
    }
  });

  it('is idempotent: a corrected primary is already fine', () => {
    for (const hex of TABLE) {
      const once = deriveBrandPalette(hex);
      const twice = deriveBrandPalette(once.primary);
      expect(twice.primary).toBe(once.primary);
      expect(twice.onPrimary).toBe(once.onPrimary);
    }
  });

  it('holds across a sweep of hue, saturation and lightness', () => {
    let checked = 0;
    for (let h = 0; h < 360; h += 10) {
      for (const s of [0.2, 0.5, 0.8, 1]) {
        for (const l of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
          const hex = hslToHex(h, s, l);
          const p = deriveBrandPalette(hex);
          expect(wcagContrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
          expect(Math.abs(oklchLightness(p.primary) - oklchLightness(hex))).toBeLessThanOrEqual(
            SOLID_MAX_LIGHTNESS_SHIFT + 1e-9,
          );
          expect(hueDrift(hex, p.primary)).toBeLessThanOrEqual(6);
          for (const mode of ['light', 'dark'] as const) {
            const m = deriveBrandPalette(hex, { mode });
            expect(wcagContrast(m.primaryText, PAGE[mode])).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('checks the text variants against a theme family background when given one', () => {
    const noir = THEME_FAMILIES.noir.colors.light.background;
    const p = deriveBrandPalette('#e3c9a0', { mode: 'light', background: noir });
    expect(wcagContrast(p.primaryText, noir)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('falls back to the kit brand color for an invalid input', () => {
    expect(deriveBrandPalette('purple').primary).toBe(deriveBrandPalette('#0092cd').primary);
    expect(deriveBrandPalette('#fff').primary).toBe('#007db1');
  });

  it('deriveHover turns around at the ends of the scale', () => {
    expect(deriveHover('#000000', ON_BRAND_LIGHT)).not.toBe('#000000');
    expect(deriveHover('#ffffff', ON_BRAND_DARK)).not.toBe('#ffffff');
    expect(relativeLuminance(deriveHover('#000000', ON_BRAND_LIGHT))).toBeGreaterThan(0);
  });
});

describe('brand palette in the resolved theme and the CSS variables', () => {
  it('uses the corrected solid color for --pui-theme and the gradient, onPrimary for text on it', () => {
    const theme = resolveTheme({
      tenant: { themePrimary: '#FF0000' },
      appearance: { colorScheme: 'LIGHT' },
      systemMode: 'light',
    });
    const brand = deriveBrandPalette('#FF0000');
    expect(theme.colors.primary).toBe(brand.primary);
    expect(theme.colors.onPrimary).toBe(brand.onPrimary);
    expect(wcagContrast(theme.colors.onPrimary, theme.colors.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(theme.gradient.stops[0]).toBe(brand.primary);
    const vars = themeCssVariables(theme);
    expect(vars['--pui-theme']).toBe(brand.primary);
    expect(vars['--pui-on-theme']).toBe(brand.onPrimary);
    expect(vars['--pui-theme-hover']).toBe(brand.primaryHover);
    expect(vars['--pui-theme-text']).toBe(
      `light-dark(${deriveBrandPalette('#FF0000', { mode: 'light' }).primaryText}, ${deriveBrandPalette('#FF0000', { mode: 'dark' }).primaryText})`,
    );
    expect(vars['--color-primary-text']).toBe('var(--pui-theme-text)');
  });

  it('exposes the accent text of the active mode and both modes in brand', () => {
    for (const mode of ['LIGHT', 'DARK'] as const) {
      const theme = resolveTheme({
        tenant: { themePrimary: '#ffff00' },
        appearance: { colorScheme: mode },
        systemMode: 'light',
      });
      const bg = mode === 'LIGHT' ? PAGE.light : PAGE.dark;
      expect(wcagContrast(theme.colors.primaryText, bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(theme.brand.light.primary).toBe(theme.brand.dark.primary);
    }
  });

  it('resolves the kit default color like any tenant color, with no exception', () => {
    const theme = resolveTheme({ tenant: null, appearance: { colorScheme: 'DARK' }, systemMode: 'light' });
    const vars = themeCssVariables(theme);
    expect(theme.isDefaultPrimary).toBe(true);
    expect(vars['--pui-theme']).toBe('#007db1');
    expect(vars['--pui-on-theme']).toBe(ON_BRAND_LIGHT);
    expect(wcagContrast(theme.colors.onPrimary, theme.colors.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(wcagContrast(theme.brand.light.primaryText, PAGE.light)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(wcagContrast(theme.brand.dark.primaryText, PAGE.dark)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('corrects a custom primary on the optional families the same way', () => {
    const theme = resolveTheme({
      tenant: { themeFamily: 'nefes', themePrimary: '#FF0000', allowedThemeFamilies: ['nefes'] },
      appearance: { colorScheme: 'LIGHT' },
      systemMode: 'light',
    });
    expect(theme.family.key).toBe('nefes');
    expect(wcagContrast(theme.colors.onPrimary, theme.colors.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(wcagContrast(theme.colors.primaryText, THEME_FAMILIES.nefes.colors.light.background)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
  });
});
