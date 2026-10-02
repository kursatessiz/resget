import { PERFECT_UI_TOKENS } from './themes';
import type { ColorMode } from './themes';

/**
 * Automatic contrast correction for the business primary color.
 *
 * The owner picks any #RRGGBB; every part of the UI that would fall under the
 * WCAG 2 AA threshold for normal text (4.5:1) is adjusted automatically,
 * without turning the brand into something else: lightness is stepped in
 * OKLCH (hue and chroma kept, chroma only reduced to stay inside sRGB) and
 * the shift is capped. Nothing is left for the owner to be warned about.
 *
 * All functions are pure and take plain hex strings, so web and mobile use
 * the same results (themeCssVariables(), resolveTheme()).
 */

/** WCAG 2 AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;

/** Near-black text on light brand colors: the ink token of the neutral scale, never pure black. */
export const ON_BRAND_DARK = '#111827';
export const ON_BRAND_LIGHT = '#ffffff';

/** Largest OKLCH lightness shift applied to the primary used on solid surfaces (0..1 scale: 0.18 = 18 percent). */
export const SOLID_MAX_LIGHTNESS_SHIFT = 0.18;
/** Link and accent text may move further: they must reach 4.5:1 on the page, the hue is what stays. */
const TEXT_MAX_LIGHTNESS_SHIFT = 0.7;
const STEP = 0.005;
/** Share of the primary in the subtle (badge, selected row) and muted (disabled, tint) backgrounds. */
const SUBTLE_SHARE = 0.12;
const MUTED_SHARE = 0.4;
/** Share of the solid primary kept in the hover state (the rest blends toward black or white). */
const HOVER_SHARE = 0.88;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_PRIMARY = PERFECT_UI_TOKENS.colors.light.theme;

export interface BrandPalette {
  /** The primary as used on solid surfaces (buttons, member and package cards); corrected when needed. */
  primary: string;
  /** Text and icons on `primary`: white or near-black, at least 4.5:1. */
  onPrimary: string;
  /** Solid hover state; keeps `onPrimary` at 4.5:1 or better. */
  primaryHover: string;
  /** The primary blended toward the page color: disabled solids and tints (decorative, no text guarantee). */
  primaryMuted: string;
  /** Faint background for badges and selected rows; `primaryText` reaches 4.5:1 on it. */
  primarySubtleBg: string;
  /** The primary as link and accent text: at least 4.5:1 on the page and on `primarySubtleBg`. */
  primaryText: string;
}

export interface BrandPaletteOptions {
  /** Which page background the text variants are checked against. Default `light`. */
  mode?: ColorMode;
  /** Overrides the page background of the mode (a theme family's own background). */
  background?: string;
}

// -- color math -----------------------------------------------------------------

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
}

function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const toLinear = (c8: number): number => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number): number => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 2 relative luminance of a #RRGGBB color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two #RRGGBB colors (1..21). */
export function wcagContrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** OKLCH lightness (0..1) of a #RRGGBB color; exposed so the correction bound is testable. */
export function oklchLightness(hex: string): number {
  return toOklch(hex).l;
}

function toOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

/** Linear sRGB of an OKLCH color, or null when it falls outside the sRGB gamut. */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] | null {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb: [number, number, number] = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const eps = 1e-6;
  return rgb.every((v) => v >= -eps && v <= 1 + eps) ? rgb : null;
}

/** Hex of an OKLCH color; chroma is reduced (hue and lightness kept) until it fits sRGB. */
function fromOklch(color: Oklch): string {
  let rgb = oklchToLinear(color);
  if (!rgb) {
    let lo = 0;
    let hi = color.c;
    let best = oklchToLinear({ ...color, c: 0 }) ?? [color.l, color.l, color.l];
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      const candidate = oklchToLinear({ ...color, c: mid });
      if (candidate) {
        best = candidate;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    rgb = best;
  }
  return rgbToHex(rgb.map((v) => fromLinear(Math.max(0, Math.min(1, v)))) as unknown as Rgb);
}

/** Mixes two colors in sRGB; `share` is the part of `a`. */
function mix(a: string, b: string, share: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar * share + br * (1 - share), ag * share + bg * (1 - share), ab * share + bb * (1 - share)]);
}

/** HSL hue (degrees) and saturation of a #RRGGBB color; used only to guard the brand hue. */
function hslHue(hex: string): { h: number; s: number } {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + (max - d) - 1)) };
}

/** Largest HSL hue drift (degrees) a lightness shift may cause; rounding to 8-bit channels can nudge dark colors. */
const MAX_HUE_DRIFT = 5;

/**
 * Steps lightness from `start` by STEP in `direction` (1 lighter, -1 darker)
 * until `ok` holds, up to `cap` in total. Returns null when the cap is hit first.
 */
function shiftUntil(start: string, direction: 1 | -1, ok: (hex: string) => boolean, cap: number): string | null {
  const base = toOklch(start);
  for (let n = 1; n * STEP <= cap + 1e-9; n += 1) {
    const l = Math.max(0, Math.min(1, base.l + direction * n * STEP));
    const hex = fromOklch({ ...base, l });
    // Chroma reduction and rounding can move the realised lightness a hair; the cap is on what is rendered.
    if (Math.abs(toOklch(hex).l - base.l) > cap) break;
    const from = hslHue(start);
    const to = hslHue(hex);
    const drift = Math.min(Math.abs(from.h - to.h), 360 - Math.abs(from.h - to.h));
    if (ok(hex) && (from.s < 0.1 || drift <= MAX_HUE_DRIFT)) return hex;
    if (l === 0 || l === 1) break;
  }
  return null;
}

/**
 * Hover state of a solid surface: blends toward the extreme that raises
 * contrast with the text on it (black under light text, white under dark
 * text); where that changes nothing (black, white) it turns around. Contrast
 * with the text never drops below 4.5:1, or below what the solid itself has
 * when that is already lower. The result always differs from the solid.
 */
export function deriveHover(solid: string, onSolid: string): string {
  const floor = Math.min(MIN_TEXT_CONTRAST, wcagContrast(onSolid, solid));
  const order = relativeLuminance(onSolid) > 0.5 ? ['#000000', '#ffffff'] : ['#ffffff', '#000000'];
  return (
    order
      .map((extreme) => mix(solid, extreme, HOVER_SHARE))
      .find((hex) => hex !== solid && wcagContrast(onSolid, hex) >= floor) ?? solid
  );
}

// -- the palette ----------------------------------------------------------------

/**
 * The brand palette of one primary color. See the field docs of BrandPalette
 * for what each value guarantees; an invalid input falls back to the kit's
 * default brand color. The solid primary (`primary`, `onPrimary`,
 * `primaryHover`) does not depend on the mode; `primaryText`, `primaryMuted`
 * and `primarySubtleBg` are blended with the page color of the given mode.
 */
export function deriveBrandPalette(primaryHex: string, options: BrandPaletteOptions = {}): BrandPalette {
  const input = HEX6.test(primaryHex) ? primaryHex : FALLBACK_PRIMARY;
  const mode: ColorMode = options.mode ?? 'light';
  const page =
    options.background && HEX6.test(options.background) ? options.background : PERFECT_UI_TOKENS.colors[mode].bg;

  // Solid surface, white text preferred: (1) keep the color when white reaches 4.5:1; (2) otherwise darken it
  // in OKLCH until white does, within SOLID_MAX_LIGHTNESS_SHIFT; (3) when the cap is not enough (very light
  // colors) use near-black text, on the color itself or lightened slightly if it still falls short.
  let primary = input;
  let onColor = ON_BRAND_LIGHT;
  if (wcagContrast(ON_BRAND_LIGHT, input) < MIN_TEXT_CONTRAST) {
    const darkened = shiftUntil(
      input,
      -1,
      (hex) => wcagContrast(ON_BRAND_LIGHT, hex) >= MIN_TEXT_CONTRAST,
      SOLID_MAX_LIGHTNESS_SHIFT,
    );
    if (darkened) {
      primary = darkened;
    } else {
      onColor = ON_BRAND_DARK;
      if (wcagContrast(ON_BRAND_DARK, input) < MIN_TEXT_CONTRAST) {
        primary =
          shiftUntil(
            input,
            1,
            (hex) => wcagContrast(ON_BRAND_DARK, hex) >= MIN_TEXT_CONTRAST,
            SOLID_MAX_LIGHTNESS_SHIFT,
          ) ?? input;
      }
    }
  }
  const on = { color: onColor, ratio: wcagContrast(onColor, primary) };

  const primaryHover = deriveHover(primary, on.color);

  const primarySubtleBg = mix(primary, page, SUBTLE_SHARE);
  const primaryMuted = mix(primary, page, MUTED_SHARE);

  // Accent text: starts from the owner's color (not the solid one) and moves toward the page contrast,
  // darker on a light page and lighter on a dark one; it must hold on the page and on the subtle background.
  const textOk = (hex: string) =>
    wcagContrast(hex, page) >= MIN_TEXT_CONTRAST && wcagContrast(hex, primarySubtleBg) >= MIN_TEXT_CONTRAST;
  const pageIsLight = relativeLuminance(page) > 0.18;
  let primaryText = input;
  if (!textOk(primaryText)) {
    primaryText =
      shiftUntil(input, pageIsLight ? -1 : 1, textOk, TEXT_MAX_LIGHTNESS_SHIFT) ??
      (pageIsLight ? ON_BRAND_DARK : ON_BRAND_LIGHT);
  }

  return { primary, onPrimary: on.color, primaryHover, primaryMuted, primarySubtleBg, primaryText };
}
