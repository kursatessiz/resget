import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx, look } from './types';
import type { UiTone, UiVariant } from './types';

interface LookProps {
  variant?: UiVariant;
  tone?: UiTone;
  block?: boolean;
  icon?: ReactNode;
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & LookProps;

/** `pui-btn` + style + color. Primary actions are `solid theme` (flat, never a gradient). */
export function Button({
  variant = 'solid',
  tone = 'theme',
  block = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={cx('pui-btn', look(variant, tone), block && 'ui-btn-block', className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & LookProps & { href: string };

export function LinkButton({
  variant = 'solid',
  tone = 'theme',
  block = false,
  icon,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a className={cx('pui-btn', look(variant, tone), block && 'ui-btn-block', className)} {...rest}>
      {icon}
      {children}
    </a>
  );
}
