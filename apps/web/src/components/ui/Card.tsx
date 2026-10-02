import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './types';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  /** Right side of the header: an action or a badge. */
  aside?: ReactNode;
}

/** `pui-card` with the kit's header and content slots. Never nest a card inside a card. */
export function Card({ title, aside, className, children, ...rest }: CardProps) {
  return (
    <section className={cx('pui-card', className)} {...rest}>
      {(title || aside) && (
        <header className="pui-card-header flex items-center justify-between gap-3">
          <h2 className="ui-heading">{title}</h2>
          {aside}
        </header>
      )}
      <div className="pui-card-content">{children}</div>
    </section>
  );
}
