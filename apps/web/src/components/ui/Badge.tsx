import type { HTMLAttributes } from 'react';
import { cx, look } from './types';
import type { UiTone, UiVariant } from './types';

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: UiTone; variant?: UiVariant };

/** `pui-badge` + style + color role. */
export function Badge({ tone = 'muted', variant = 'soft', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('pui-badge', look(variant, tone), className)} {...rest}>
      {children}
    </span>
  );
}
