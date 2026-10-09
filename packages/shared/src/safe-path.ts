/**
 * A return target taken from a query string or form (sign-in `next`, sign-out) is used only when it is a path on
 * this site. Anything a browser could read as another origin falls back: `//host`, `/\host` (browsers treat the
 * backslash as a slash), a scheme, or a control character such as a tab or newline that browsers strip.
 */
export function safeLocalPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
