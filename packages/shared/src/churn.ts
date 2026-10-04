/**
 * Churn risk signals (docs/KAYIP_RISKI.md). Customer side (module
 * churn_signals, PRO analytics): every customer who ordered is classified
 * against their own ordering rhythm, so a weekly regular is "at risk" after
 * two quiet weeks while a monthly one is not. The class is stored on the
 * customer row (kept by order placement and a periodic sweep) so segments
 * and campaigns can target it. Restaurant side (module restaurant_health,
 * console only): signals that a restaurant is drifting away from the
 * platform, such as an order drop, silence or an unpaid invoice.
 */

const DAY_MS = 86_400_000;

export const CHURN_RISKS = ['NEW', 'ACTIVE', 'NOT_RETURNED', 'AT_RISK', 'LOST'] as const;
export type ChurnRisk = (typeof CHURN_RISKS)[number];

/** A first-time customer counts as new this many days, then as "did not return". */
export const CHURN_NEW_DAYS = 30;
/** Quiet days before a regular is at risk, at least; otherwise twice their usual interval. */
export const CHURN_AT_RISK_MIN_DAYS = 14;
/** Quiet days before any customer counts as lost, at least; otherwise four times their usual interval. */
export const CHURN_LOST_MIN_DAYS = 90;
export const CHURN_AT_RISK_FACTOR = 2;
export const CHURN_LOST_FACTOR = 4;

export interface ChurnInput {
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

export interface ChurnThresholds {
  /** Average days between orders; null for a customer with a single order. */
  usualIntervalDays: number | null;
  atRiskAfterDays: number;
  lostAfterDays: number;
}

/** Whole days between two instants, never negative. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** The customer's own rhythm and the quiet periods that make them at risk and lost. */
export function churnThresholds(input: ChurnInput): ChurnThresholds {
  if (input.orderCount < 2 || !input.firstOrderAt || !input.lastOrderAt) {
    return { usualIntervalDays: null, atRiskAfterDays: CHURN_NEW_DAYS, lostAfterDays: CHURN_LOST_MIN_DAYS };
  }
  const span = Math.max(0, input.lastOrderAt.getTime() - input.firstOrderAt.getTime()) / DAY_MS;
  const usual = Math.max(1, Math.round(span / (input.orderCount - 1)));
  return {
    usualIntervalDays: usual,
    atRiskAfterDays: Math.max(CHURN_AT_RISK_MIN_DAYS, usual * CHURN_AT_RISK_FACTOR),
    lostAfterDays: Math.max(CHURN_LOST_MIN_DAYS, usual * CHURN_LOST_FACTOR),
  };
}

/** Null for a contact who never ordered (a CRM prospect): there is no rhythm to lose. */
export function customerChurnRisk(input: ChurnInput, now: Date): ChurnRisk | null {
  if (input.orderCount < 1 || !input.lastOrderAt) return null;
  const quiet = daysBetween(input.lastOrderAt, now);
  const { atRiskAfterDays, lostAfterDays } = churnThresholds(input);
  if (quiet > lostAfterDays) return 'LOST';
  if (input.orderCount < 2) return quiet > CHURN_NEW_DAYS ? 'NOT_RETURNED' : 'NEW';
  return quiet > atRiskAfterDays ? 'AT_RISK' : 'ACTIVE';
}

/** Classes the panel lists for a win-back, most urgent first. */
export const CHURN_WATCH_RISKS = ['AT_RISK', 'NOT_RETURNED', 'LOST'] as const satisfies readonly ChurnRisk[];
export type ChurnWatchRisk = (typeof CHURN_WATCH_RISKS)[number];

export interface ChurnCustomerDTO {
  id: string;
  fullName: string;
  /** Null without the contact permission or for a deleted account. */
  phone: string | null;
  risk: ChurnRisk;
  orderCount: number;
  lastOrderAt: string;
  daysSinceLastOrder: number;
  usualIntervalDays: number | null;
  lifetimeGrossMinor: number;
  currency: string;
  marketingOptIn: boolean;
}

export interface ChurnOverviewDTO {
  counts: Record<ChurnRisk, number>;
  /** Gross order value of at-risk customers over their lifetime here: what a win-back protects. */
  atRiskLifetimeGrossMinor: number;
  currency: string;
}

// -- Restaurant health (console) -----------------------------------------------------------

export const RESTAURANT_SIGNALS = [
  'SILENT',
  'ORDER_DROP',
  'NEVER_ORDERED',
  'PAYMENT_OVERDUE',
  'LISTING_SUSPENDED',
  'TRIAL_ENDING',
] as const;
export type RestaurantSignal = (typeof RESTAURANT_SIGNALS)[number];

/** How much each signal weighs; the sum sets the level. */
export const RESTAURANT_SIGNAL_WEIGHTS: Readonly<Record<RestaurantSignal, number>> = {
  SILENT: 3,
  PAYMENT_OVERDUE: 3,
  ORDER_DROP: 2,
  NEVER_ORDERED: 2,
  LISTING_SUSPENDED: 2,
  TRIAL_ENDING: 1,
};

export const HEALTH_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

/** Days without an order before a restaurant that used to take orders counts as silent. */
export const SIGNAL_SILENT_DAYS = 7;
/** Comparison window for the order drop; the drop compares the last window with the one before. */
export const SIGNAL_DROP_WINDOW_DAYS = 14;
/** Orders the earlier window needs before a drop means anything. */
export const SIGNAL_DROP_MIN_ORDERS = 10;
/** Days after sign-up without a first order. */
export const SIGNAL_NEVER_ORDERED_DAYS = 14;
/** Days before the trial ends, without a card on file. */
export const SIGNAL_TRIAL_DAYS = 7;

export interface RestaurantHealthInput {
  createdAt: Date;
  lastOrderAt: Date | null;
  /** Orders placed in the last window (cancelled and rejected ones left out). */
  ordersLastWindow: number;
  /** Orders placed in the window before. */
  ordersPreviousWindow: number;
  hasOverdueInvoice: boolean;
  listingSuspended: boolean;
  trialEndsAt: Date | null;
  hasBillingCard: boolean;
}

export function restaurantSignals(input: RestaurantHealthInput, now: Date): RestaurantSignal[] {
  const signals: RestaurantSignal[] = [];
  if (input.lastOrderAt) {
    if (daysBetween(input.lastOrderAt, now) >= SIGNAL_SILENT_DAYS) signals.push('SILENT');
    else if (
      input.ordersPreviousWindow >= SIGNAL_DROP_MIN_ORDERS &&
      input.ordersLastWindow * 2 <= input.ordersPreviousWindow
    ) {
      signals.push('ORDER_DROP');
    }
  } else if (daysBetween(input.createdAt, now) >= SIGNAL_NEVER_ORDERED_DAYS) {
    signals.push('NEVER_ORDERED');
  }
  if (input.hasOverdueInvoice) signals.push('PAYMENT_OVERDUE');
  if (input.listingSuspended) signals.push('LISTING_SUSPENDED');
  if (
    input.trialEndsAt &&
    !input.hasBillingCard &&
    input.trialEndsAt.getTime() > now.getTime() &&
    input.trialEndsAt.getTime() - now.getTime() <= SIGNAL_TRIAL_DAYS * DAY_MS
  ) {
    signals.push('TRIAL_ENDING');
  }
  return signals;
}

export function healthScore(signals: readonly RestaurantSignal[]): number {
  return signals.reduce((sum, signal) => sum + RESTAURANT_SIGNAL_WEIGHTS[signal], 0);
}

/** Null when nothing is wrong. */
export function healthLevel(signals: readonly RestaurantSignal[]): HealthLevel | null {
  const score = healthScore(signals);
  if (score === 0) return null;
  return score >= 3 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW';
}

export interface RestaurantHealthDTO {
  id: string;
  name: string;
  slug: string;
  level: HealthLevel;
  score: number;
  signals: RestaurantSignal[];
  lastOrderAt: string | null;
  ordersLastWindow: number;
  ordersPreviousWindow: number;
  trialEndsAt: string | null;
}

export interface RestaurantHealthPageDTO {
  items: RestaurantHealthDTO[];
  /** Active restaurants looked at; the list holds only those with a signal. */
  checked: number;
  counts: Record<HealthLevel, number>;
}
