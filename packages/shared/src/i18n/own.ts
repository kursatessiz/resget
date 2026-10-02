/** Own-property check without Object.hasOwn (not guaranteed on every mobile runtime). */
export function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
