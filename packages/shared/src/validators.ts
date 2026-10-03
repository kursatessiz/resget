import { z } from 'zod';
import { normalizePhone } from './phone';

export const UuidSchema = z.string().uuid();

/** URL slug of a restaurant: the public ordering page lives at /<slug>. */
export const SlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits and single dashes');

/** ISO 3166-1 alpha-2. */
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

/** Accepts any national or international format and stores E.164. */
export const PhoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(32)
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid phone number' });
      return z.NEVER;
    }
    return normalized;
  });

export const PaginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type Pagination = z.infer<typeof PaginationSchema>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Removes trailing slashes without a regular expression: the input can be configuration, so no backtracking on it. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}
