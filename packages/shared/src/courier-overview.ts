import { z } from 'zod';
import type { DeliveryMode, DeliveryRequestStatus } from './enums';
import type { DeliveryFeePolicy } from './courier';
import type { CourierSummaryDTO } from './delivery';
import { UuidSchema } from './validators';

/** The courier screen of the panel (docs/PANEL.md): own couriers, the network, recent network requests. */

export interface CourierProviderOptionDTO {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface DeliveryRequestSummaryDTO {
  id: string;
  orderId: string;
  orderShortCode: string;
  status: `${DeliveryRequestStatus}`;
  quoteFeeMinor: number;
  finalFeeMinor: number | null;
  currency: string;
  providerName: string;
  providerRef: string | null;
  trackingUrl: string | null;
  pickupEtaMinutes: number | null;
  dropoffEtaMinutes: number | null;
  failureReason: string | null;
  createdAt: string;
}

export interface CourierOverviewDTO {
  deliveryMode: `${DeliveryMode}`;
  deliveryFeePolicy: DeliveryFeePolicy | null;
  currency: string;
  /** Networks available in the restaurant's country. */
  providers: CourierProviderOptionDTO[];
  selectedProviderId: string | null;
  couriers: CourierSummaryDTO[];
  requests: DeliveryRequestSummaryDTO[];
  today: {
    trips: number;
    delivered: number;
    failed: number;
  };
}

export const SelectCourierProviderSchema = z.object({ courierProviderId: UuidSchema.nullable() }).strict();
export type SelectCourierProviderInput = z.infer<typeof SelectCourierProviderSchema>;
