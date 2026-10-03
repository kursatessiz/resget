import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './types';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  help?: ReactNode;
}

/** `pui-field-group` with the kit's select styling. */
export function SelectField({ label, help, className, id, children, ...rest }: SelectFieldProps) {
  return (
    <label className={cx('pui-field-group', className)} htmlFor={id}>
      <span>{label}</span>
      <select id={id} className="pui-input" {...rest}>
        {children}
      </select>
      {help && <small className="ui-text-muted">{help}</small>}
    </label>
  );
}

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  help?: ReactNode;
}

export function TextAreaField({ label, help, className, id, ...rest }: TextAreaFieldProps) {
  return (
    <label className={cx('pui-field-group', className)} htmlFor={id}>
      <span>{label}</span>
      <textarea id={id} className="pui-input" rows={2} {...rest} />
      {help && <small className="ui-text-muted">{help}</small>}
    </label>
  );
}
