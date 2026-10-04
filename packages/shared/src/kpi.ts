import { z } from 'zod';
import { OrderChannel } from './enums';
import type { DistrictDensityDTO } from './admin';

/**
 * Platform funnels and KPI board (docs/HUNILER.md, module kpi_dashboard):
 * the platform marketing team's view across all restaurants. Aggregates
 * only; no customer or contact detail ever leaves through it.
 */

export const KPI_RANGE_DAYS = [7, 30, 90] as const;
export type KpiRangeDays = (typeof KPI_RANGE_DAYS)[number];

export const KpiQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .refine((d): d is KpiRangeDays => (KPI_RANGE_DAYS as readonly number[]).includes(d), {
        message: 'unsupported range',
      })
      .default(30),
  })
  .strict();
export type KpiQuery = z.infer<typeof KpiQuerySchema>;

/** A restaurant counts as active with at least one order in the last this many days. */
export const KPI_ACTIVE_WINDOW_DAYS = 7;

export const TABLE_QR_FUNNEL_STEPS = ['VIEWED_MENU', 'STARTED_ORDER', 'PLACED_ORDER'] as const;
export const RESTAURANT_FUNNEL_STEPS = ['leads', 'signups', 'listed', 'firstOrder', 'active'] as const;
export type TableQrFunnelStep = (typeof TABLE_QR_FUNNEL_STEPS)[number];
export type RestaurantFunnelStep = (typeof RESTAURANT_FUNNEL_STEPS)[number];

export interface FunnelStepDTO<K extends string = string> {
  key: K;
  count: number;
}

/** Share of the previous step, in basis points; null for the first step or after an empty one. */
export function funnelStepRates(steps: readonly { count: number }[]): (number | null)[] {
  return steps.map((step, i) => {
    if (i === 0) return null;
    const previous = steps[i - 1].count;
    return previous > 0 ? Math.round((step.count * 10_000) / previous) : null;
  });
}

/** Orders per active restaurant per day, to two decimals; zero without active restaurants. */
export function ordersPerRestaurantPerDay(orders: number, activeRestaurants: number, days: number): number {
  if (activeRestaurants <= 0 || days <= 0) return 0;
  return Math.round((orders * 100) / (activeRestaurants * days)) / 100;
}

export interface KpiMoneyDTO {
  currency: string;
  /** Items gross of orders that became sales, in minor units. */
  gmvMinor: number;
  /** The platform commission on them, in minor units. */
  commissionMinor: number;
}

export interface PlatformKpiDTO {
  days: KpiRangeDays;
  from: string;
  to: string;
  restaurants: {
    total: number;
    listed: number;
    /** With an order in the last KPI_ACTIVE_WINDOW_DAYS days. */
    active: number;
    trials: number;
  };
  orders: {
    /** Placed orders in the range (unpaid card orders left out). */
    total: number;
    /** The defining KPI: orders in the range per restaurant that had orders in the range, per day. */
    perRestaurantPerDay: number;
    byChannel: Record<`${OrderChannel}`, number>;
    /** Customers whose first order with a restaurant fell in the range. */
    firstOrders: number;
    repeatOrders: number;
  };
  money: KpiMoneyDTO[];
  /** Placed orders per UTC day, oldest first, every day of the range present. */
  daily: { date: string; orders: number }[];
  funnels: {
    /** Distinct anonymous table QR sessions reaching each step. */
    tableQr: FunnelStepDTO<TableQrFunnelStep>[];
    /** Platform leads in the range, then restaurants signed up in the range and how far they got. */
    restaurants: FunnelStepDTO<RestaurantFunnelStep>[];
  };
  districts: DistrictDensityDTO[];
}

export const ORDER_CHANNEL_KEYS = Object.values(OrderChannel) as `${OrderChannel}`[];
