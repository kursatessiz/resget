import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';

/**
 * Perfect UI's three-class rule: every element is a shape (`pui-btn`,
 * `pui-card`...), a style and a color role. Components turn these into
 * classes so screens never write colors themselves.
 */
export type UiVariant = 'solid' | 'soft' | 'outline' | 'link';
export type UiTone = 'theme' | 'success' | 'warn' | 'error' | 'muted' | 'surface' | 'inverse';

export function cx(...values: ClassValue[]): string {
  return clsx(values);
}

export function look(variant: UiVariant, tone: UiTone): string {
  return `pui-${variant} pui-${tone}`;
}
