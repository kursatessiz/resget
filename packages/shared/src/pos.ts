import { z } from 'zod';
import type { FulfillmentTypeValue, OrderStatusValue } from './delivery';

/**
 * POS integration (docs/POS_ENTEGRASYONU.md): the restaurant's own point of
 * sale receives every new order (kitchen ticket, its own reports) and may
 * accept it automatically; the POS reports acceptance, readiness or
 * rejection back through a signed webhook. Every POS is a
 * PosIntegrationAdapter behind the pos_integration module switch; a new
 * POS is a new adapter and catalogue row, never a new code path in the
 * order flow.
 */

export interface PosProviderSpec {
  code: string;
  name: string;
  /** False until the partner agreement and the adapter exist; listed so the owner sees what is coming. */
  available: boolean;
}

export const POS_PROVIDERS: readonly PosProviderSpec[] = [
  { code: 'MOCK', name: 'Test POS', available: true },
  { code: 'ROBOTPOS', name: 'robotPOS', available: false },
  { code: 'ADISYO', name: 'Adisyo', available: false },
  { code: 'SAMBAPOS', name: 'SambaPOS', available: false },
  { code: 'SIMPRA', name: 'Simpra', available: false },
];

export const POS_PREP_MINUTES_DEFAULT = 20;
/** Push attempts before an order's sync is left FAILED for a person to look at. */
export const POS_MAX_ATTEMPTS = 5;

/** What a POS receives for a new order: enough for a kitchen ticket and its own books. */
export interface PosOrderPayload {
  orderId: string;
  shortCode: string;
  placedAt: string;
  fulfillment: FulfillmentTypeValue;
  currency: string;
  items: { name: string; quantity: number; unitPriceMinor: number; modifiers: string[] }[];
  itemsGrossMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  chargedToCustomerMinor: number;
  paymentMethod: string | null;
  note: string | null;
  tableLabel: string | null;
  customerName: string | null;
  address: string | null;
}

export type PosEventKind = 'ACCEPTED' | 'READY' | 'REJECTED';

export interface PosEvent {
  /** The POS's own reference, returned when the order was pushed. */
  externalRef: string;
  kind: PosEventKind;
  prepMinutes?: number;
  reason?: string;
}

export interface PosIntegrationAdapter {
  readonly code: string;
  verifyCredentials(credentials: Record<string, string>): Promise<{ ok: boolean; label: string; reason?: string }>;
  pushOrder(credentials: Record<string, string>, payload: PosOrderPayload): Promise<{ externalRef: string }>;
  /** Verifies the signature and maps the payload; throws on a bad signature. */
  parseWebhook(
    credentials: Record<string, string>,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): PosEvent;
}

/** The order transition a POS event asks for, from the order's current status; null when it has nothing to do. */
export function posEventTransition(
  kind: PosEventKind,
  status: OrderStatusValue,
  fulfillment: FulfillmentTypeValue,
): OrderStatusValue | null {
  void fulfillment;
  switch (kind) {
    case 'ACCEPTED':
      return status === 'PLACED' ? 'ACCEPTED' : null;
    case 'READY':
      return status === 'ACCEPTED' || status === 'PREPARING' ? 'READY' : null;
    case 'REJECTED':
      if (status === 'PLACED') return 'REJECTED';
      return status === 'ACCEPTED' || status === 'PREPARING' ? 'CANCELLED_BY_RESTAURANT' : null;
  }
}

export const ConnectPosSchema = z
  .object({
    providerCode: z.string().trim().min(2).max(40),
    credentials: z.record(z.string().max(200), z.string().max(2000)).refine((v) => Object.keys(v).length <= 20, {
      message: 'Too many credential fields',
    }),
    autoAccept: z.boolean(),
    defaultPrepMinutes: z.number().int().min(5).max(120),
  })
  .strict();
export type ConnectPosInput = z.infer<typeof ConnectPosSchema>;

export const UpdatePosSchema = z
  .object({
    autoAccept: z.boolean().optional(),
    defaultPrepMinutes: z.number().int().min(5).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdatePosInput = z.infer<typeof UpdatePosSchema>;

export type PosSyncStatusValue = 'PENDING' | 'SENT' | 'FAILED';

export interface PosConnectionDTO {
  providerCode: string;
  label: string;
  status: 'ACTIVE' | 'FAILED';
  failureReason: string | null;
  autoAccept: boolean;
  defaultPrepMinutes: number;
  isActive: boolean;
  /** Where the POS posts its status updates, relative to the public API address. */
  webhookPath: string;
  recent: {
    orderShortCode: string;
    status: PosSyncStatusValue;
    attempts: number;
    lastError: string | null;
    updatedAt: string;
  }[];
}

export interface PosSettingsDTO {
  providers: readonly PosProviderSpec[];
  connection: PosConnectionDTO | null;
}
