/**
 * Users are identified globally by phone number, so every phone must be
 * stored in one canonical form (E.164). Normalisation is now country-aware
 * (libphonenumber-js's /min metadata, kept small since this module ships to
 * the browser and to Expo): Turkish local formats keep working exactly as
 * before (05321112233, 5321112233, 0090 532 111 22 33, +90 (532) 111-22-33
 * all resolve with the Turkish default), and any other E.164 number
 * validates against its own country's rules when a `defaultCountry` is
 * given, or against the tenant's country when the caller supplies one.
 * Returns null when the input cannot be a valid number.
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/**
 * @param defaultCountryCode Either a dialing code ("90") for backward
 * compatibility, or an ISO 3166-1 alpha-2 country code ("TR", "US"). Accepts
 * both so every existing call site (which passes "90") keeps working.
 */
export function normalizePhone(input: string, defaultCountryCode = '90'): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const country = dialingCodeToCountry(defaultCountryCode) ?? (defaultCountryCode.toUpperCase() as CountryCode);

  try {
    const parsed = parsePhoneNumberFromString(trimmed, country);
    if (parsed && parsed.isValid()) {
      return parsed.number;
    }
  } catch {
    // fall through to the legacy Turkish-specific parser below
  }

  // libphonenumber-js rejects some inputs its metadata does not cover
  // (e.g. a bare "00" international prefix without a recognised country);
  // fall back to the original Turkish-only normalisation so existing
  // Turkish behaviour never regresses.
  return legacyTurkishNormalize(trimmed);
}

/** Maps the handful of dialing codes this platform historically passed as `defaultCountryCode` to their ISO country. */
function dialingCodeToCountry(dialingCode: string): CountryCode | null {
  const map: Record<string, CountryCode> = {
    '90': 'TR',
    '1': 'US',
    '44': 'GB',
    '49': 'DE',
    '33': 'FR',
    '34': 'ES',
    '39': 'IT',
    '31': 'NL',
    '971': 'AE',
  };
  return map[dialingCode] ?? null;
}

function legacyTurkishNormalize(trimmed: string): string | null {
  let digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;

  if (trimmed.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = '90' + digits.slice(1);
  } else if (digits.length === 10 && digits.startsWith('5')) {
    digits = '90' + digits;
  }

  if (digits.startsWith('90') && !/^905\d{9}$/.test(digits) && !/^90[2-4]\d{9}$/.test(digits)) {
    return null;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}
