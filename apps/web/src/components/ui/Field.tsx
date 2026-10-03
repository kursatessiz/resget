import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './types';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
}

/** `pui-field-group` with the kit's label, input and help slots; an error marks the input invalid. */
export function TextField({ label, help, error, className, id, ...rest }: TextFieldProps) {
  return (
    <label className={cx('pui-field-group', className)} htmlFor={id}>
      <span>{label}</span>
      <input id={id} className="pui-input" aria-invalid={error ? true : undefined} {...rest} />
      {(error || help) && <small className={error ? undefined : 'ui-text-muted'}>{error ?? help}</small>}
    </label>
  );
}
