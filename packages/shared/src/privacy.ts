import { z } from 'zod';
import type { AddressSnapshot } from './delivery';

/**
 * Personal data rights (docs/KISISEL_VERI.md): a person can download what
 * the platform holds about them and delete their account from the web or
 * the app. Deletion erases or anonymises personal data and keeps the
 * financial records the law requires (orders, payments, invoices) without
 * anything that identifies the person.
 */

/** A deleted user's phone is replaced by this tombstone so the number is free again and never matches a login. */
export const DELETED_USER_PHONE_PREFIX = 'deleted:';

export function deletedUserPhone(userId: string): string {
  return `${DELETED_USER_PHONE_PREFIX}${userId}`;
}

export function isDeletedUserPhone(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && phone.startsWith(DELETED_USER_PHONE_PREFIX);
}

/** The person's contact as staff may see it: nothing once the account is deleted. */
export function visibleContact<T extends { phone: string; fullName: string }>(user: T | null | undefined): T | null {
  return user && !isDeletedUserPhone(user.phone) ? user : null;
}

/** What an order keeps of its delivery address after its customer deleted the account: the area, for reports. */
export function anonymizedAddressSnapshot(
  snapshot: unknown,
): Pick<AddressSnapshot, 'addressLine' | 'city' | 'district' | 'contactName' | 'contactPhone' | 'point'> | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const source = snapshot as Partial<AddressSnapshot>;
  return {
    addressLine: '',
    city: typeof source.city === 'string' ? source.city : '',
    district: typeof source.district === 'string' ? source.district : '',
    contactName: '',
    contactPhone: '',
    point: null,
  };
}

/** Deleting is final; the explicit flag keeps a stray request from doing it. */
export const DeleteAccountSchema = z.object({ confirm: z.literal(true) }).strict();
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;

/** Everything the platform holds about the signed-in person, as a downloadable file (data portability). */
export interface PersonalDataExportDTO {
  exportedAt: string;
  profile: { phone: string; fullName: string; email: string | null; locale: string | null; createdAt: string };
  addresses: {
    label: string;
    addressLine: string;
    city: string;
    district: string;
    postalCode: string | null;
    note: string | null;
    createdAt: string;
  }[];
  orders: {
    shortCode: string;
    restaurant: string;
    status: string;
    fulfillment: string;
    placedAt: string;
    totalMinor: number;
    currency: string;
    items: { name: string; quantity: number }[];
    address: { addressLine: string; city: string; district: string } | null;
    rating: { score: number; comment: string | null } | null;
  }[];
  restaurants: {
    restaurant: string;
    orderCount: number;
    marketingOptIn: boolean;
    loyaltyPoints: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
  }[];
  memberships: { restaurant: string; role: string; status: string; joinedAt: string | null }[];
  consents: { document: string; version: string; acceptedAt: string }[];
  savedCards: { brand: string; last4: string; expiryMonth: number; expiryYear: number }[];
  devices: { platform: string; lastSeenAt: string }[];
}
