// Lifecycle states that are the same for every restaurant. Mirrors the Prisma
// enums in packages/database/prisma/schema.prisma. Anything a restaurant can
// configure (menu categories, modifier groups, service areas, plans, message
// credit packages) is data, never an enum.

export enum MembershipStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  PASSIVE = 'PASSIVE',
}

export enum InviteChannel {
  SHOWN = 'SHOWN',
  WHATSAPP = 'WHATSAPP',
  SMS = 'SMS',
}

export enum OtpPurpose {
  LOGIN = 'LOGIN',
  INVITE = 'INVITE',
}

/** Where an order was created. TABLE_QR is the acquisition surface of phase 0. */
export enum OrderChannel {
  TABLE_QR = 'TABLE_QR',
  RESTAURANT_SITE = 'RESTAURANT_SITE',
  MARKETPLACE = 'MARKETPLACE',
  PHONE = 'PHONE',
}

export enum FulfillmentType {
  DELIVERY = 'DELIVERY',
  PICKUP = 'PICKUP',
  DINE_IN = 'DINE_IN',
}

/**
 * Who moves the food. THIRD_PARTY_API is a courier network reached over its
 * API and always a separately priced service; the platform never runs a
 * fleet of its own (docs/KURYE.md).
 */
export enum DeliveryMode {
  RESTAURANT_COURIER = 'RESTAURANT_COURIER',
  THIRD_PARTY_API = 'THIRD_PARTY_API',
  NONE = 'NONE',
}

/**
 * Lifecycle of an order (docs/SIPARIS_VE_SEVK.md). Kitchen states are set by
 * the restaurant; HANDED_TO_COURIER, OUT_FOR_DELIVERY and ARRIVING are the
 * courier leg of a delivery order and normally come from the delivery trip.
 * PICKED_UP is the customer collecting a pickup order; DELIVERED also covers
 * a dine-in order that was served.
 */
export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PLACED = 'PLACED',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  HANDED_TO_COURIER = 'HANDED_TO_COURIER',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  ARRIVING = 'ARRIVING',
  DELIVERED = 'DELIVERED',
  PICKED_UP = 'PICKED_UP',
  CANCELLED_BY_CUSTOMER = 'CANCELLED_BY_CUSTOMER',
  CANCELLED_BY_RESTAURANT = 'CANCELLED_BY_RESTAURANT',
  REJECTED = 'REJECTED',
  REFUNDED = 'REFUNDED',
}

/** Statuses after which an order counts as completed revenue. */
export const COMPLETED_ORDER_STATUSES: readonly OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.PICKED_UP];

/** A trip is one courier leaving the restaurant with one or more orders (docs/SIPARIS_VE_SEVK.md). */
export enum DeliveryTripStatus {
  PLANNED = 'PLANNED',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** One order inside a trip, in delivery sequence. */
export enum DeliveryStopStatus {
  PENDING = 'PENDING',
  EN_ROUTE = 'EN_ROUTE',
  ARRIVING = 'ARRIVING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  REMOVED = 'REMOVED',
}

/** Who decided the stop order of a trip: the restaurant by hand, or the route optimiser. */
export enum StopSequenceMode {
  MANUAL = 'MANUAL',
  OPTIMIZED = 'OPTIMIZED',
}

/**
 * Who is the merchant of record for card payments of a restaurant
 * (docs/ODEME.md). OWN_POS: the restaurant's own virtual POS collects into
 * the restaurant's bank account and the platform invoices its commission
 * afterwards. PLATFORM_PSP: the platform's PSP collects and the commission is
 * deducted from the payout.
 */
export enum PaymentMode {
  OWN_POS = 'OWN_POS',
  PLATFORM_PSP = 'PLATFORM_PSP',
}

export enum PaymentConnectionStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  FAILED = 'FAILED',
  DISABLED = 'DISABLED',
}

/** Marketing campaign lifecycle (docs/KAMPANYALAR.md). */
export enum CampaignStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  SENDING = 'SENDING',
  SENT = 'SENT',
  CANCELLED = 'CANCELLED',
}

export enum CampaignRecipientStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

/** Monthly commission invoice of an OWN_POS restaurant. */
export enum CommissionInvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  VOID = 'VOID',
}

export enum PaymentMethod {
  ONLINE_CARD = 'ONLINE_CARD',
  CASH_ON_DELIVERY = 'CASH_ON_DELIVERY',
  CARD_ON_DELIVERY = 'CARD_ON_DELIVERY',
  MEAL_CARD = 'MEAL_CARD',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  /** The cardholder's bank took the money back (a chargeback); the restaurant bears it by contract. */
  CHARGED_BACK = 'CHARGED_BACK',
}

/**
 * One line of the money trail of an order (docs/MUTABAKAT.md):
 * GMV -> VAT -> platform commission -> PSP fee -> withholding -> restaurant payable.
 */
export enum LedgerEntryType {
  GROSS_SALE = 'GROSS_SALE',
  DISCOUNT = 'DISCOUNT',
  DELIVERY_FEE = 'DELIVERY_FEE',
  COURIER_COST = 'COURIER_COST',
  PLATFORM_COMMISSION = 'PLATFORM_COMMISSION',
  COMMISSION_VAT = 'COMMISSION_VAT',
  PSP_FEE = 'PSP_FEE',
  WITHHOLDING_TAX = 'WITHHOLDING_TAX',
  REFUND = 'REFUND',
  CHARGEBACK = 'CHARGEBACK',
  /** Commission (and its VAT) given back when a completed order is refunded or charged back: no commission on those. */
  COMMISSION_REVERSAL = 'COMMISSION_REVERSAL',
  COMMISSION_VAT_REVERSAL = 'COMMISSION_VAT_REVERSAL',
  ADJUSTMENT = 'ADJUSTMENT',
  RESTAURANT_PAYABLE = 'RESTAURANT_PAYABLE',
  /** The fee of a faster payout (docs/HAKEDIS_TAKVIMI.md), VAT included, taken from the payout. */
  PAYOUT_FEE = 'PAYOUT_FEE',
  /** A courier tip the platform collected (docs/BAHSIS.md): the whole tip, handed on to the courier by the restaurant. */
  COURIER_TIP = 'COURIER_TIP',
  /** The provider's fee on a courier tip, the only thing that comes off it. */
  COURIER_TIP_FEE = 'COURIER_TIP_FEE',
}

/** Why money went back to the customer (docs/ODEME.md, "İade"); one OrderRefund row per refund. */
export enum OrderRefundSource {
  /** Automatic refund of an online payment right after a rejection or cancellation. */
  CANCELLATION = 'CANCELLATION',
  /** Staff refund (`orders.refund`): the whole order, chosen items or an amount. */
  STAFF = 'STAFF',
  /** A customer's missing-item claim approved by the restaurant. */
  CLAIM = 'CLAIM',
  /** A refund made in the provider's own dashboard and reported by its webhook. */
  PROVIDER = 'PROVIDER',
  /** The cardholder's bank took the money back. */
  CHARGEBACK = 'CHARGEBACK',
}

/** A customer's missing-item claim (docs/ODEME.md, "Eksik ürün bildirimi"). */
export enum OrderClaimStatus {
  OPEN = 'OPEN',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
  /** No decision within CLAIM_DECISION_HOURS: the platform console can decide (claim_escalation module). */
  ESCALATED = 'ESCALATED',
}

export enum PayoutStatus {
  SCHEDULED = 'SCHEDULED',
  SENT = 'SENT',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
}

export enum MessageChannel {
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
  PUSH = 'PUSH',
  EMAIL = 'EMAIL',
}

export enum MessageStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}

export enum MessageTransactionType {
  PURCHASE = 'PURCHASE',
  GRANT = 'GRANT',
  DEBIT = 'DEBIT',
  REFUND = 'REFUND',
  EXPIRY = 'EXPIRY',
}

export enum DeliveryRequestStatus {
  QUOTED = 'QUOTED',
  REQUESTED = 'REQUESTED',
  ASSIGNED = 'ASSIGNED',
  PICKED_UP = 'PICKED_UP',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

/** Funnel steps of a table QR scan (docs/MASA_QR.md). */
export enum QrScanOutcome {
  VIEWED_MENU = 'VIEWED_MENU',
  STARTED_ORDER = 'STARTED_ORDER',
  PLACED_ORDER = 'PLACED_ORDER',
  REGISTERED = 'REGISTERED',
}

export enum FeatureFlagScope {
  GLOBAL = 'GLOBAL',
  RESTAURANT = 'RESTAURANT',
}

export enum DocumentType {
  TERMS_OF_SERVICE = 'TERMS_OF_SERVICE',
  PRIVACY_NOTICE = 'PRIVACY_NOTICE',
  RESTAURANT_AGREEMENT = 'RESTAURANT_AGREEMENT',
  MARKETING_CONSENT = 'MARKETING_CONSENT',
}
