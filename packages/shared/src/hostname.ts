import { z } from 'zod';

/**
 * A host name the restaurant owns for its ordering page (docs/VITRIN.md, "Kendi alan adı"):
 * lower case, at least two labels, no scheme, no path. The platform's own host is refused by the API.
 * Also the shape of an allowlisted image host (docs/GUVENLIK.md, "Görsel bağlantıları").
 */
export const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(253)
  .regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'host name expected');
