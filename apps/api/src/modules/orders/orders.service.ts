import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Prisma } from '@resget/database';
import {
  customerChurnRisk,
  COURIER_LEG_STATUSES,
  TRACKING_TOKEN_BYTES,
  canTransitionOrder,
  computeModeSettlement,
  effectivePaymentModeFor,
  courierDisplayName,
  deliveryFeeVatBpsFor,
  dispatchSettingsFrom,
  haversineMeters,
  isTerminalOrderStatus,
  maskPhoneForDisplay,
  maskTripContacts,
  orderShortCode,
  orderTimestampFor,
  settlementDefaultsFor,
  resolveLineModifiers,
  commissionBpsFor,
  orderSourceFromParam,
  trackingUrl,
  acceptDeadlineFor,
  TERMINAL_ORDER_STATUSES,
  DELIVERY_CODE_LENGTH,
  scheduledAcceptDeadline,
  scheduledPromisedReadyAt,
  schedulingSettingsFrom,
  canRateOrder,
  isActiveDeliveryRequest,
  isAutoRefundStatus,
  PENDING_PAYMENT_TIMEOUT_MINUTES,
  canStartRefund,
  canFileClaim,
  isClaimWaiting,
  REPEAT_CLAIM_THRESHOLD,
  REPEAT_CLAIM_WINDOW_DAYS,
  isFeatureEnabled,
  refundableMinor,
  refundedQuantities,
  refundStateOf,
  visibleContact,
  TAB_TOKEN_BYTES,
  withinEditWindow,
  editableUntil,
} from '@resget/shared';
import { PaymentMode } from '@resget/shared';
import type {
  AddressSnapshot,
  RealtimeEvent,
  CreateOrderInput,
  GeoPoint,
  OrderActor,
  OrderClaimDTO,
  OrderDetailDTO,
  OrderPaymentDTO,
  OrderPaymentIntent,
  OrderSource,
  OrderStatusValue,
  OrderSummaryDTO,
  OrderTrackingDTO,
  DeliveryRequestSummaryDTO,
  OrderTransitionInput,
  OrdersQuery,
  SettlementLine,
  DispatchSettings,
  SchedulingSettings,
  RateOrderInput,
  EditRatingInput,
  NpsAnswerInput,
  RefundItem,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { COUPON_RELEASE_STATUSES, CouponsService } from '../coupons/coupons.service';
import { ConsentService } from '../consent/consent.service';
import { CampaignAttributionService } from '../campaigns/campaign-attribution.service';
import { JourneysService } from '../journeys/journeys.service';
import type { PreparedCoupon } from '../coupons/coupons.service';
import { ReferralsService } from '../coupons/referrals.service';
import { PartnerReferralsService } from '../partner-referrals/partner-referrals.service';
import { FeedbackService } from '../feedback/feedback.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PushService } from '../push/push.service';
import { OrderNotificationsService } from './order-notifications.service';
import { RealtimeService, courierTopic, dispatchTopic, orderTopic } from '../realtime/realtime.service';
import type { TopicEvent } from '../realtime/realtime.service';
import { badRequest, conflict, notFound } from '../../common/api-error';

export const ACTIVE_TRIP_STATUSES = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS'] as const;
export const ACTIVE_STOP_STATUSES = ['PENDING', 'EN_ROUTE', 'ARRIVING'] as const;

/** What the acceptance window and the promised time of an order depend on (docs/ILERI_TARIHLI_SIPARIS.md). */
interface OrderTiming {
  dispatch: DispatchSettings;
  scheduling: SchedulingSettings;
  scheduledFor: Date | null;
  fulfillment: 'DELIVERY' | 'PICKUP' | 'DINE_IN';
}

/** The usual timeout after placement, or, for a scheduled order, one timeout before its preparation has to start. */
function acceptanceDeadline(placedAt: Date, timing: OrderTiming): Date {
  if (!timing.scheduledFor) return acceptDeadlineFor(placedAt, timing.dispatch);
  return scheduledAcceptDeadline({
    placedAt,
    scheduledFor: timing.scheduledFor,
    fulfillment: timing.fulfillment,
    prepMinutes: timing.dispatch.defaultPrepMinutes,
    acceptTimeoutMinutes: timing.dispatch.acceptTimeoutMinutes,
    settings: timing.scheduling,
  });
}

const orderArgs = Prisma.validator<Prisma.OrderDefaultArgs>()({
  include: {
    table: { select: { label: true } },
    customer: { select: { id: true, fullName: true, phone: true } },
    items: { orderBy: { position: 'asc' } },
    statusHistory: { orderBy: { createdAt: 'asc' } },
    // Every payment of the order, newest first: the refund state reads them all.
    payments: { orderBy: { createdAt: 'desc' } },
    // Every refund, oldest first: the detail lists them and counts the items already given back.
    refunds: { orderBy: { createdAt: 'asc' } },
    // The customer's missing-item claims, newest first (docs/ODEME.md, "Eksik ürün bildirimi").
    claims: { orderBy: { createdAt: 'desc' } },
    rating: true,
    npsResponse: { select: { score: true } },
    // The courier network carrying the order, when one was called (docs/KURYE.md).
    deliveryRequest: { include: { provider: { select: { name: true } } } },
    deliveryStops: {
      where: { status: { in: [...ACTIVE_STOP_STATUSES] }, trip: { status: { in: [...ACTIVE_TRIP_STATUSES] } } },
      include: { trip: { select: { id: true, status: true, courierMembershipId: true } } },
      take: 1,
    },
  },
});
export type OrderRow = Prisma.OrderGetPayload<typeof orderArgs>;

/** A delivery request as the order screen and the courier screen show it. */
export function deliveryRequestSummary(
  orderId: string,
  r: NonNullable<OrderRow['deliveryRequest']>,
): DeliveryRequestSummaryDTO {
  return {
    id: r.id,
    orderId,
    orderShortCode: orderShortCode(orderId),
    status: r.status,
    quoteFeeMinor: r.quoteFeeMinor,
    finalFeeMinor: r.finalFeeMinor,
    currency: r.currency,
    providerName: r.provider.name,
    providerRef: r.providerRef,
    trackingUrl: r.trackingUrl,
    pickupEtaMinutes: r.pickupEtaMinutes,
    dropoffEtaMinutes: r.dropoffEtaMinutes,
    failureReason: r.failureReason,
    createdAt: r.createdAt.toISOString(),
  };
}

type Db = Prisma.TransactionClient | PrismaService;

/** What the checkout service decided about an order's payment intent before the order is written. */
export interface ResolvedPaymentIntent {
  intent: OrderPaymentIntent;
  /** Provider the payment row names: the issuer code, the POS provider code or PLATFORM. */
  providerCode: string;
  /** True when the customer pays before the kitchen starts; the order waits in PENDING_PAYMENT. */
  paidBefore: boolean;
}

export type OrderListener = (order: { id: string; restaurantId: string; status: string }) => Promise<void>;

/** Statuses after which an order's stock goes back to the menu (docs/STOK.md); a refunded meal was still served. */
const STOCK_RELEASE_STATUSES = ['REJECTED', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_CUSTOMER'] as const;

export interface CreateOrderOptions {
  /** Spend this signed-in customer's loyalty points on the order (docs/SADAKAT.md). */
  loyaltyUserId?: string;
  /** A coupon code (docs/KUPONLAR.md); the discount is restaurant-funded and never combined with points. */
  couponCode?: string;
  /** The channel link a consumer order came from (docs/SIPARIS_BAGLANTILARI.md); the caller checks the module. */
  source?: OrderSource;
  /** The signed-in customer's own number; checkout consent for it needs no confirmation link (docs/RIZA.md). */
  verifiedPhone?: string;
}

/** Adds the courier tip state to the tracking page (docs/BAHSIS.md); set by the tips module. */
export type TrackingTipExtender = (row: OrderRow) => Promise<Pick<OrderTrackingDTO, 'tip' | 'tipOffer'>>;

export type PaymentIntentResolver = (
  restaurantId: string,
  intent: OrderPaymentIntent,
) => Promise<ResolvedPaymentIntent>;

export interface TransitionOptions {
  reason?: string;
  prepMinutes?: number;
  /** Set by the dispatch service, which may move an order that sits in an active trip. */
  fromTrip?: boolean;
}

/**
 * Orders: creation with the settlement snapshot, the status machine with
 * its history, and the read models of the restaurant screens and the
 * customer's tracking page. Every change ends in realtime events for the
 * restaurant, the courier (when a trip is involved) and the customer.
 */
@Injectable()
export class OrdersService {
  /** Registered by the dispatch service so a cancelled order can refresh its trip without a circular import. */
  private tripEvents: ((tripId: string) => Promise<TopicEvent[]>) | null = null;
  private readonly orderListeners: OrderListener[] = [];
  private readonly logger = new Logger(OrdersService.name);
  /** Registered by the checkout service: validates a payment intent against what the restaurant accepts. */
  private resolvePayment: PaymentIntentResolver | null = null;
  private tipExtender: TrackingTipExtender | null = null;
  /** Registered by the refunds service: gives an online payment back after a cancellation (docs/ODEME.md, "İade"). */
  private refundAfterCancel: ((orderId: string) => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
    private readonly notifications: OrderNotificationsService,
    private readonly ledger: LedgerService,
    private readonly loyalty: LoyaltyService,
    private readonly geocoding: GeocodingService,
    private readonly webhooks: WebhooksService,
    private readonly push: PushService,
    private readonly features: FeatureFlagsService,
    private readonly coupons: CouponsService,
    private readonly referrals: ReferralsService,
    private readonly partnerReferrals: PartnerReferralsService,
    private readonly feedback: FeedbackService,
    private readonly consent: ConsentService,
    private readonly campaignAttribution: CampaignAttributionService,
    private readonly journeys: JourneysService,
  ) {}

  /**
   * Called with every order whose state was just published (POS push, docs/POS_ENTEGRASYONU.md).
   * Listeners run in the background; a slow or failing one never holds up the order.
   */
  addOrderListener(listener: OrderListener): void {
    this.orderListeners.push(listener);
  }

  setTripEventsProvider(provider: (tripId: string) => Promise<TopicEvent[]>): void {
    this.tripEvents = provider;
  }

  setTrackingTipExtender(extender: TrackingTipExtender): void {
    this.tipExtender = extender;
  }

  setPaymentIntentResolver(resolver: PaymentIntentResolver): void {
    this.resolvePayment = resolver;
  }

  setRefundAfterCancel(handler: (orderId: string) => Promise<void>): void {
    this.refundAfterCancel = handler;
  }

  // -- Creation ------------------------------------------------------------------

  async create(
    restaurantId: string,
    input: CreateOrderInput,
    actorUserId: string | null,
    canSeeContacts: boolean,
    options: CreateOrderOptions = {},
  ): Promise<OrderDetailDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        currency: true,
        countryCode: true,
        commissionBps: true,
        pspPercentBps: true,
        pspFixedMinor: true,
        paymentMode: true,
        deliveryMode: true,
        dispatchSettings: true,
        schedulingSettings: true,
        name: true,
      },
    });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    const branch = await this.prisma.branch.findFirst({
      where: { id: input.branchId, restaurantId, isActive: true },
      select: { id: true, lat: true, lng: true },
    });
    if (!branch) throw notFound('NOT_FOUND', 'Branch not found');
    // A delivery address without a point is geocoded best effort (docs/VITRIN.md); a given point is never replaced.
    const address =
      input.fulfillment === 'DELIVERY' && input.address && !input.address.point
        ? {
            ...input.address,
            point: await this.geocoding.pointFor(
              input.address,
              restaurant.countryCode,
              branch.lat !== null && branch.lng !== null ? { lat: branch.lat, lng: branch.lng } : null,
            ),
          }
        : input.address;
    if (input.tableId) {
      const table = await this.prisma.diningTable.findFirst({
        where: { id: input.tableId, restaurantId, branchId: input.branchId, isActive: true },
        select: { id: true },
      });
      if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found');
    }

    const menuItems = await this.prisma.menuItem.findMany({
      where: { restaurantId, id: { in: input.items.map((line) => line.menuItemId) } },
      select: {
        id: true,
        name: true,
        priceMinor: true,
        vatRateBps: true,
        isAvailable: true,
        currency: true,
        stockQuantity: true,
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            minSelect: true,
            maxSelect: true,
            modifiers: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, name: true, priceDeltaMinor: true, isAvailable: true },
            },
          },
        },
      },
    });
    const byId = new Map(menuItems.map((item) => [item.id, item]));
    const lines = input.items.map((line, position) => {
      const item = byId.get(line.menuItemId);
      if (!item) throw notFound('NOT_FOUND', `Menu item ${line.menuItemId} not found`);
      if (!item.isAvailable) throw conflict('MENU_ITEM_UNAVAILABLE', `${item.name} is not available`);
      if (item.currency !== restaurant.currency) throw badRequest('VALIDATION', 'Menu item currency mismatch');
      // The menu prices the options, never the client (MODIFIER_INVALID / MODIFIER_PRICE_CHANGED).
      const options = resolveLineModifiers(item.modifierGroups, line.modifiers);
      if (!options.ok) throw conflict(options.code, `Options of ${item.name} do not match the menu`);
      const modifiersDelta = options.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);
      const unitPriceMinor = item.priceMinor + modifiersDelta;
      if (unitPriceMinor < 0) throw badRequest('VALIDATION', 'Negative line price');
      return {
        menuItemId: item.id,
        nameSnapshot: item.name,
        unitPriceMinor,
        quantity: line.quantity,
        vatRateBps: item.vatRateBps,
        modifiersSnapshot: options.modifiers,
        lineTotalMinor: unitPriceMinor * line.quantity,
        position,
        stockTaken: 0,
      };
    });
    // Counted items take their portions inside the order's transaction (docs/STOK.md).
    const countStock = await this.features.isEnabled('menu_stock', restaurantId);

    const payment = input.payment
      ? this.resolvePayment
        ? await this.resolvePayment(restaurantId, input.payment)
        : null
      : null;
    if (input.payment && !payment) throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'Payment intents are not enabled');
    // A tab order is collected by the restaurant with the tab, at the table or the counter (docs/ACIK_HESAP.md).
    const onTab = input.tab === true;
    if (onTab) {
      if (!input.tableId || input.fulfillment !== 'DINE_IN')
        throw badRequest('VALIDATION', 'Only a table order goes on a tab');
      await this.features.assertEnabled('table_tabs', restaurantId);
    }
    const paymentMode = onTab
      ? PaymentMode.OWN_POS
      : effectivePaymentModeFor(payment?.intent.method ?? null, restaurant.paymentMode);
    const initialStatus = payment?.paidBefore ? 'PENDING_PAYMENT' : 'PLACED';

    // Loyalty points (docs/SADAKAT.md): a restaurant-funded discount, sized before the settlement is computed.
    const redemption = options.loyaltyUserId
      ? await this.loyalty.prepareRedemption(
          this.prisma,
          restaurantId,
          options.loyaltyUserId,
          lines.reduce((sum, l) => sum + l.lineTotalMinor, 0),
        )
      : null;

    // Coupon (docs/KUPONLAR.md): one restaurant-funded discount per order, tied to the customer's phone.
    let coupon: PreparedCoupon | null = null;
    if (options.couponCode) {
      if (redemption) throw conflict('COUPON_NOT_COMBINABLE', 'A coupon is not combined with loyalty points');
      const phone = input.customer?.phone ?? address?.contactPhone ?? null;
      if (!phone) throw conflict('COUPON_PHONE_REQUIRED', 'A coupon needs the customer phone');
      coupon = await this.coupons.prepare(
        restaurantId,
        options.couponCode,
        phone,
        lines.reduce((sum, l) => sum + l.lineTotalMinor, 0),
      );
    }
    const discountMinor = redemption?.discountMinor ?? coupon?.discountMinor ?? 0;

    const regional = settlementDefaultsFor(restaurant.countryCode);
    // Dine-in at the table carries no commission; delivery and pickup do (docs/MUTABAKAT.md, rule 1).
    const commissionBps = commissionBpsFor(input.fulfillment, restaurant.commissionBps);
    const isDelivery = input.fulfillment === 'DELIVERY';
    const deliveryFee: SettlementLine | null =
      isDelivery && input.deliveryFeeMinor > 0
        ? { amountMinor: input.deliveryFeeMinor, vatRateBps: deliveryFeeVatBpsFor(restaurant.countryCode) }
        : null;
    const settlement = computeModeSettlement(paymentMode, {
      currency: restaurant.currency,
      items: lines.map((l) => ({ amountMinor: l.lineTotalMinor, vatRateBps: l.vatRateBps })),
      deliveryFee,
      discount: discountMinor > 0 ? { amountMinor: discountMinor, fundedBy: 'RESTAURANT' } : null,
      commissionBps,
      commissionVatBps: regional.commissionVatBps,
      psp: { percentBps: restaurant.pspPercentBps, fixedMinor: restaurant.pspFixedMinor, bearer: 'RESTAURANT' },
      withholdingBps: regional.withholdingBps,
    });

    const contact = input.customer ?? (address ? { phone: address.contactPhone, fullName: address.contactName } : null);

    // One instant for the row and the acceptance window, so the deadline is exactly the setting away from placedAt.
    const placedAt = new Date();
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
    // A scheduled order is for later, within a week; the storefront narrows it to the offered slots.
    if (
      scheduledFor &&
      (scheduledFor.getTime() <= placedAt.getTime() || scheduledFor.getTime() > placedAt.getTime() + 7 * 86_400_000)
    ) {
      throw badRequest('SCHEDULED_SLOT_INVALID', 'The scheduled time must be later and within a week');
    }
    let consentCustomerId: string | null = null;
    const orderId = await this.prisma.$transaction(async (tx) => {
      let customerUserId: string | null = null;
      let restaurantCustomerId: string | null = null;
      if (contact) {
        const user = await tx.user.upsert({
          where: { phone: contact.phone },
          update: {},
          create: { phone: contact.phone, fullName: contact.fullName },
          select: { id: true },
        });
        customerUserId = user.id;
        const customer = await tx.restaurantCustomer.upsert({
          where: { restaurantId_userId: { restaurantId, userId: user.id } },
          select: { id: true, orderCount: true, firstOrderAt: true, lastOrderAt: true, churnRisk: true },
          update: {
            orderCount: { increment: 1 },
            // The order's own instant, so a recount after a cancellation lands on the same value.
            lastOrderAt: placedAt,
            lifetimeGrossMinor: { increment: settlement.itemsGrossMinor },
          },
          create: {
            restaurantId,
            userId: user.id,
            firstChannel: input.channel,
            firstOrderAt: placedAt,
            lastOrderAt: placedAt,
            orderCount: 1,
            lifetimeGrossMinor: settlement.itemsGrossMinor,
            marketingToken: randomUUID(),
          },
        });
        // An order resets the customer's churn class (docs/KAYIP_RISKI.md); the sweep moves it on as days pass.
        const churnRisk = customerChurnRisk(customer, placedAt);
        if (churnRisk !== customer.churnRisk) {
          await tx.restaurantCustomer.update({ where: { id: customer.id }, data: { churnRisk } });
        }
        restaurantCustomerId = customer.id;
        consentCustomerId = customer.id;
      }
      if (countStock) await this.takeStock(tx, lines, byId);
      const tabId = onTab ? await this.openTabFor(tx, restaurantId, input.branchId, input.tableId!) : null;
      const created = await tx.order.create({
        data: {
          restaurantId,
          branchId: input.branchId,
          customerUserId,
          tableId: input.tableId ?? null,
          tabId,
          channel: input.channel,
          fulfillment: input.fulfillment,
          deliveryMode: isDelivery
            ? restaurant.deliveryMode === 'NONE'
              ? 'RESTAURANT_COURIER'
              : restaurant.deliveryMode
            : 'NONE',
          status: initialStatus,
          placedAt,
          scheduledFor,
          acceptDeadlineAt:
            initialStatus === 'PLACED'
              ? acceptanceDeadline(placedAt, {
                  dispatch: dispatchSettingsFrom(restaurant.dispatchSettings),
                  scheduling: schedulingSettingsFrom(restaurant.schedulingSettings),
                  scheduledFor,
                  fulfillment: input.fulfillment,
                })
              : null,
          currency: restaurant.currency,
          itemsGrossMinor: settlement.itemsGrossMinor,
          itemsVatMinor: settlement.itemsVatMinor,
          deliveryFeeMinor: settlement.deliveryFeeMinor,
          discountMinor: settlement.discountMinor,
          discountFundedBy: settlement.discountFundedBy,
          chargedToCustomerMinor: settlement.chargedToCustomerMinor,
          commissionBps,
          platformCommissionMinor: settlement.platformCommissionMinor,
          commissionVatMinor: settlement.commissionVatMinor,
          pspFeeMinor: settlement.pspFeeMinor,
          pspFeeBearer: settlement.pspFeeBearer,
          withholdingMinor: settlement.withholdingMinor,
          courierCostMinor: settlement.courierCostMinor,
          courierBearer: settlement.courierBearer,
          restaurantPayableMinor: settlement.restaurantPayableMinor,
          paymentMode,
          platformReceivableMinor: settlement.platformReceivableMinor,
          paymentMethod: payment?.intent.method ?? null,
          paymentProvider: payment?.intent.method === 'MEAL_CARD' ? (payment.intent.providerCode ?? null) : null,
          addressSnapshot: address ? (address as Prisma.InputJsonValue) : Prisma.JsonNull,
          customerNote: input.note ?? null,
          source: options.source ?? null,
          trackingToken: randomBytes(TRACKING_TOKEN_BYTES).toString('base64url'),
          // Every delivery order gets one; it is asked for only while delivery_pin is on (docs/TESLIMAT_KODU.md).
          deliveryCode: isDelivery
            ? String(randomInt(0, 10 ** DELIVERY_CODE_LENGTH)).padStart(DELIVERY_CODE_LENGTH, '0')
            : null,
          items: {
            create: lines.map((l) => ({ ...l, modifiersSnapshot: l.modifiersSnapshot as Prisma.InputJsonValue })),
          },
          statusHistory: { create: { fromStatus: null, toStatus: initialStatus, actorUserId } },
          payments: payment
            ? {
                create: {
                  restaurantId,
                  provider: payment.providerCode,
                  method: payment.intent.method,
                  status: 'PENDING',
                  amountMinor: settlement.chargedToCustomerMinor,
                  currency: restaurant.currency,
                  paymentMode,
                },
              }
            : undefined,
        },
        select: { id: true },
      });
      if (redemption) {
        await this.loyalty.applyRedemption(tx, restaurantId, redemption.customerId, created.id, redemption.points);
      }
      if (coupon && restaurantCustomerId) {
        await this.coupons.apply(
          tx,
          restaurantId,
          coupon,
          created.id,
          restaurantCustomerId,
          settlement.discountMinor,
          restaurant.currency,
        );
      }
      if (input.qrSessionId) {
        await tx.qrScanEvent.create({
          data: {
            restaurantId,
            tableId: input.tableId ?? null,
            sessionId: input.qrSessionId,
            outcome: 'PLACED_ORDER',
            userId: customerUserId,
            orderId: created.id,
          },
        });
      }
      return created.id;
    });

    // A campaign message that led here is credited (docs/KAMPANYALAR.md); a failure costs a statistic, never the order.
    if (consentCustomerId) {
      await this.campaignAttribution
        .recordOrder(restaurantId, consentCustomerId, orderId, settlement.itemsGrossMinor, placedAt)
        .catch((error: unknown) => this.logger.warn(`campaign credit for order ${orderId} failed: ${String(error)}`));
    }
    // Consent is only ever granted by the customer's own box (docs/RIZA.md); a failure costs a consent, never the order.
    if (consentCustomerId && (input.marketingOptIn || (input.marketingChannels?.length ?? 0) > 0)) {
      await this.consent
        .grantFromCheckout(
          restaurantId,
          consentCustomerId,
          input.marketingOptIn,
          input.marketingChannels,
          options.verifiedPhone !== undefined && contact?.phone === options.verifiedPhone,
        )
        .catch((error: unknown) => this.logger.warn(`consent for order ${orderId} not recorded: ${String(error)}`));
    }
    this.realtime.publishMany(await this.eventsForOrder(orderId));
    // Orders typed in by the staff need no alert; the others wake the phones of everyone who works the orders screen.
    if (input.channel !== 'PHONE') {
      await this.push.notifyRestaurantStaff(
        restaurantId,
        'orders.view',
        'order.placed',
        { restaurant: restaurant.name, code: orderShortCode(orderId) },
        { kind: 'orders' },
      );
    }
    return this.detail(restaurantId, orderId, canSeeContacts);
  }

  // -- Reads ----------------------------------------------------------------------

  async list(restaurantId: string, query: OrdersQuery, canSeeContacts: boolean): Promise<OrderSummaryDTO[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        restaurantId,
        ...(query.status ? { status: { in: query.status } } : {}),
        ...(query.fulfillment ? { fulfillment: query.fulfillment } : {}),
        ...(query.customerUserId ? { customerUserId: query.customerUserId } : {}),
        ...(query.active
          ? {
              status: {
                notIn: [
                  'DELIVERED',
                  'PICKED_UP',
                  'CANCELLED_BY_CUSTOMER',
                  'CANCELLED_BY_RESTAURANT',
                  'REJECTED',
                  'REFUNDED',
                ],
              },
            }
          : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: query.limit,
      ...orderArgs,
    });
    return rows.map((row) => this.toSummary(row, canSeeContacts));
  }

  async detail(restaurantId: string, orderId: string, canSeeContacts: boolean): Promise<OrderDetailDTO> {
    const row = await this.prisma.order.findFirst({ where: { id: orderId, restaurantId }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    const detail = this.toDetail(row, canSeeContacts);
    // Repeat-claimant warning (claim_escalation module): the customer's earlier claims here, while one waits.
    const waiting = row.claims.find((c) => isClaimWaiting(c.status));
    if (waiting && row.customerUserId && (await this.features.isEnabled('claim_escalation', restaurantId))) {
      detail.customerClaimHistory = await this.claimHistory(row.customerUserId, waiting.id, restaurantId);
    }
    return detail;
  }

  /** Earlier claims of a customer in the repeat window, at one restaurant or (null) across the platform. */
  async claimHistory(customerUserId: string, excludeClaimId: string, restaurantId: string | null) {
    const since = new Date(Date.now() - REPEAT_CLAIM_WINDOW_DAYS * 24 * 3_600_000);
    const claims = await this.prisma.orderClaim.findMany({
      where: {
        id: { not: excludeClaimId },
        createdAt: { gte: since },
        order: { customerUserId },
        ...(restaurantId ? { restaurantId } : {}),
      },
      select: { status: true },
    });
    const approved = claims.filter((c) => c.status === 'APPROVED').length;
    return {
      windowDays: REPEAT_CLAIM_WINDOW_DAYS,
      claims: claims.length,
      approved,
      repeat: claims.length >= REPEAT_CLAIM_THRESHOLD,
    };
  }

  async loadRow(db: Db, orderId: string): Promise<OrderRow> {
    const row = await db.order.findUnique({ where: { id: orderId }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return row;
  }

  // -- Transitions ------------------------------------------------------------------

  /**
   * Inside a transaction: once no captured money remains on the order and at
   * least one payment went back, the order becomes REFUNDED. Returns the
   * status it left, or null when it stays (money still captured, nothing
   * refunded, already REFUNDED, or a status the state machine does not allow).
   */
  async closeAsRefunded(
    tx: Prisma.TransactionClient,
    orderId: string,
    actor: OrderActor,
    actorUserId: string | null,
    reason: string,
  ): Promise<OrderStatusValue | null> {
    const row = await this.loadRow(tx, orderId);
    const remaining = row.payments.some((p) => refundableMinor(p) > 0);
    const refunded = row.payments.some((p) => p.status === 'REFUNDED');
    if (remaining || !refunded || !canTransitionOrder(row.fulfillment, row.status, 'REFUNDED', actor)) return null;
    const from = row.status;
    // No commission on a refunded order: the last refund row already cancelled what was left of it
    // (LedgerService.recordRefund, docs/MUTABAKAT.md "Kısmi iade").
    await this.applyTransition(tx, row, 'REFUNDED', actor, actorUserId, { reason });
    return from;
  }

  /**
   * Cancels online orders still waiting for their payment after PENDING_PAYMENT_TIMEOUT_MINUTES (docs/ODEME.md):
   * the cancellation gives back stock, the coupon use and spent points. The customer is not messaged; a payment
   * that lands afterwards is refunded by the refund sweep. Returns how many were cancelled.
   */
  async expireUnpaid(now: Date = new Date()): Promise<number> {
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        createdAt: { lt: new Date(now.getTime() - PENDING_PAYMENT_TIMEOUT_MINUTES * 60_000) },
      },
      ...orderArgs,
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let expired = 0;
    for (const row of stale) {
      try {
        await this.prisma.$transaction((tx) =>
          this.applyTransition(tx, row, 'CANCELLED_BY_CUSTOMER', 'SYSTEM', null, { reason: 'payment not completed' }),
        );
      } catch (error) {
        // Paid or cancelled meanwhile: the compare and swap refused it, which is the right outcome.
        if (error instanceof HttpException && error.getStatus() === HttpStatus.CONFLICT) continue;
        throw error;
      }
      expired += 1;
      this.realtime.publishMany(await this.eventsForOrder(row.id));
    }
    return expired;
  }

  /** HTTP entry point for restaurant staff: the trip owns the courier leg of an order that rides in one. */
  async transition(
    restaurantId: string,
    orderId: string,
    input: OrderTransitionInput,
    actor: OrderActor,
    actorUserId: string | null,
    canSeeContacts: boolean,
  ): Promise<OrderDetailDTO> {
    // Money goes back only through the refund endpoint, never by a bare status change.
    if (input.to === 'REFUNDED') throw conflict('REFUND_NOT_ALLOWED', 'Use the refund endpoint');
    const row = await this.prisma.order.findFirst({ where: { id: orderId, restaurantId }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    const activeStop = row.deliveryStops[0];
    // READY from the kitchen (an order planned into a trip before it was cooked) is the kitchen's step;
    // READY back from the courier leg (a failed stop) belongs to the trip.
    const touchesCourierLeg =
      COURIER_LEG_STATUSES.includes(input.to) || (input.to === 'READY' && COURIER_LEG_STATUSES.includes(row.status));
    if (activeStop && touchesCourierLeg) {
      throw conflict('ORDER_IN_TRIP', 'The order rides in a trip; use the trip endpoints');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.applyTransition(tx, row, input.to, actor, actorUserId, {
        reason: input.reason,
        prepMinutes: input.prepMinutes,
      });
      if (activeStop && isTerminalOrderStatus(input.to)) {
        // A cancelled order leaves its trip; the trip itself goes on with the other stops.
        await tx.deliveryStop.update({ where: { id: activeStop.id }, data: { status: 'REMOVED' } });
      }
    });
    // A captured online payment goes back right away; a failure is retried later and never undoes the cancellation.
    if (isAutoRefundStatus(input.to) && this.refundAfterCancel) {
      await this.refundAfterCancel(orderId);
    }
    const events = await this.eventsForOrder(orderId);
    if (activeStop && this.tripEvents) events.push(...(await this.tripEvents(activeStop.tripId)));
    this.realtime.publishMany(events);
    // After the commit and the live update: the customer's message rides on the restaurant's wallet (docs/MESAJLASMA.md).
    await this.notifications.notify(orderId, input.to);
    return this.detail(restaurantId, orderId, canSeeContacts);
  }

  /**
   * Applies one transition inside a transaction: validates it against the
   * state machine, stamps the timestamps, writes the history line. Callers
   * publish events after their transaction commits (eventsForOrder).
   */
  async applyTransition(
    tx: Prisma.TransactionClient,
    order: Pick<OrderRow, 'id' | 'status' | 'fulfillment' | 'placedAt'>,
    to: OrderStatusValue,
    actor: OrderActor,
    actorUserId: string | null,
    options: TransitionOptions = {},
  ): Promise<void> {
    if (!canTransitionOrder(order.fulfillment, order.status, to, actor)) {
      throw conflict(
        'ORDER_TRANSITION_INVALID',
        `${order.fulfillment} order cannot go ${order.status} -> ${to} as ${actor}`,
      );
    }
    const now = new Date();
    const data: Prisma.OrderUpdateManyMutationInput = { status: to };
    const stamp = orderTimestampFor(to);
    if (stamp) data[stamp] = now;
    if (to === 'ACCEPTED') {
      const timing = await this.timingOf(tx, order.id);
      const minutes = options.prepMinutes ?? timing.dispatch.defaultPrepMinutes;
      // A scheduled order is promised for its slot, never sooner than the kitchen can make it.
      data.promisedReadyAt = timing.scheduledFor
        ? scheduledPromisedReadyAt({
            now,
            prepMinutes: minutes,
            scheduledFor: timing.scheduledFor,
            fulfillment: timing.fulfillment,
            settings: timing.scheduling,
          })
        : new Date(now.getTime() + minutes * 60_000);
    }
    // A paid-first order enters the acceptance window when the payment lands.
    if (to === 'PLACED') data.acceptDeadlineAt = acceptanceDeadline(now, await this.timingOf(tx, order.id));
    if (to !== 'PLACED' && order.status === 'PLACED') data.acceptDeadlineAt = null;
    if (to === 'REJECTED' || to === 'CANCELLED_BY_RESTAURANT' || to === 'CANCELLED_BY_CUSTOMER') {
      data.rejectReason = options.reason ?? null;
    }
    if (to === 'DELIVERED' || to === 'PICKED_UP') data.estimatedDeliveryAt = null;
    // Compare and swap: a concurrent transition that committed first leaves nothing to update, so the
    // side effects below (ledger, loyalty, journeys) run once per real status change.
    const swapped = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data });
    if (swapped.count === 0) {
      throw conflict('ORDER_TRANSITION_INVALID', `Order ${order.id} left ${order.status} while this change was made`);
    }
    // A completed order settles: its statement lines join the ledger (PLATFORM_PSP only, docs/MUTABAKAT.md).
    if (to === 'DELIVERED' || to === 'PICKED_UP') {
      await this.ledger.recordOrderCompletion(tx, order.id, now);
      await this.loyalty.recordCompletion(tx, order.id, now);
      // Automated flows take the customer in (docs/AKISLAR.md); same transaction, so exactly once.
      await this.journeys.recordCompletion(tx, order.id, now);
      // A friend's first order with a personal code rewards the referrer (docs/TAVSIYE.md).
      await this.referrals.recordCompletion(tx, order.id, now);
      // A referred restaurant's qualifying order rewards the restaurant that invited it (docs/RESTORAN_TAVSIYE.md).
      await this.partnerReferrals.recordCompletion(tx, order.id, now);
    }
    if (to === 'REJECTED' || to === 'CANCELLED_BY_RESTAURANT' || to === 'CANCELLED_BY_CUSTOMER' || to === 'REFUNDED') {
      await this.loyalty.recordReversal(tx, order.id, now);
    }
    // A cancelled order gives its coupon use back (docs/KUPONLAR.md).
    if ((COUPON_RELEASE_STATUSES as readonly string[]).includes(to)) await this.coupons.release(tx, order.id, now);
    if ((STOCK_RELEASE_STATUSES as readonly string[]).includes(to)) await this.releaseStock(tx, order.id);
    // A cancelled order does not count as the customer's order (owner decision, docs/KAYIP_RISKI.md).
    if ((STOCK_RELEASE_STATUSES as readonly string[]).includes(to)) await this.recountCustomer(tx, order.id, now);
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: to, actorUserId, reason: options.reason ?? null },
    });
    order.status = to;
  }

  /**
   * Takes each counted item's portions in one conditional write per item, so
   * two guests cannot both take the last portion (docs/STOK.md). An item the
   * restaurant stopped counting meanwhile is taken as unlimited.
   */
  /**
   * The table's open tab, opened by the first order put on it (docs/ACIK_HESAP.md). The open key is unique, so
   * two guests ordering at once land on the same tab.
   */
  private async openTabFor(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    branchId: string,
    tableId: string,
  ): Promise<string> {
    const tab = await tx.tableTab.upsert({
      where: { openKey: tableId },
      update: {},
      create: {
        restaurantId,
        branchId,
        tableId,
        openKey: tableId,
        publicToken: randomBytes(TAB_TOKEN_BYTES).toString('base64url'),
      },
      select: { id: true },
    });
    return tab.id;
  }

  private async takeStock(
    tx: Prisma.TransactionClient,
    lines: { menuItemId: string; quantity: number; stockTaken: number }[],
    items: Map<string, { stockQuantity: number | null; name: string }>,
  ): Promise<void> {
    const wanted = new Map<string, number>();
    for (const line of lines) {
      if (items.get(line.menuItemId)?.stockQuantity === null) continue;
      wanted.set(line.menuItemId, (wanted.get(line.menuItemId) ?? 0) + line.quantity);
    }
    for (const [menuItemId, quantity] of wanted) {
      const taken = await tx.menuItem.updateMany({
        where: { id: menuItemId, stockQuantity: { gte: quantity } },
        data: { stockQuantity: { decrement: quantity } },
      });
      if (taken.count === 0) {
        const now = await tx.menuItem.findUnique({ where: { id: menuItemId }, select: { stockQuantity: true } });
        if (now?.stockQuantity === null) continue;
        throw conflict('MENU_ITEM_SOLD_OUT', `Not enough of ${items.get(menuItemId)?.name ?? menuItemId} left`);
      }
      for (const line of lines) if (line.menuItemId === menuItemId) line.stockTaken = line.quantity;
    }
  }

  /** A cancelled or rejected order gives its portions back once; an item no longer counted gets nothing back. */
  private async releaseStock(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const lines = await tx.orderItem.findMany({
      where: { orderId, stockTaken: { gt: 0 }, menuItemId: { not: null } },
      select: { id: true, menuItemId: true, stockTaken: true },
    });
    for (const line of lines) {
      await tx.menuItem.updateMany({
        where: { id: line.menuItemId!, stockQuantity: { not: null } },
        data: { stockQuantity: { increment: line.stockTaken } },
      });
      await tx.orderItem.update({ where: { id: line.id }, data: { stockTaken: 0 } });
    }
  }

  /**
   * Rebuilds the customer's order counters at this restaurant from the orders that were not cancelled:
   * count, gross, first and last order, and the churn class that follows from them. Counted from the rows,
   * not decremented, so a repeated or concurrent cancellation can never drive them wrong.
   */
  private async recountCustomer(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { restaurantId: true, customerUserId: true },
    });
    if (!order?.customerUserId) return;
    const customer = await tx.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId: order.restaurantId, userId: order.customerUserId } },
      select: { id: true, churnRisk: true },
    });
    if (!customer) return;
    const kept = await tx.order.aggregate({
      where: {
        restaurantId: order.restaurantId,
        customerUserId: order.customerUserId,
        status: { notIn: [...STOCK_RELEASE_STATUSES] },
      },
      _count: { _all: true },
      _sum: { itemsGrossMinor: true },
      _min: { placedAt: true },
      _max: { placedAt: true },
    });
    const counters = {
      orderCount: kept._count._all,
      lifetimeGrossMinor: kept._sum.itemsGrossMinor ?? 0,
      firstOrderAt: kept._min.placedAt,
      lastOrderAt: kept._max.placedAt,
    };
    await tx.restaurantCustomer.update({
      where: { id: customer.id },
      data: { ...counters, churnRisk: customerChurnRisk(counters, now) },
    });
  }

  /** What the acceptance window and the promised time of an order depend on. */
  private async timingOf(tx: Prisma.TransactionClient, orderId: string): Promise<OrderTiming> {
    const row = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        scheduledFor: true,
        fulfillment: true,
        restaurant: { select: { dispatchSettings: true, schedulingSettings: true } },
      },
    });
    return {
      dispatch: dispatchSettingsFrom(row?.restaurant.dispatchSettings),
      scheduling: schedulingSettingsFrom(row?.restaurant.schedulingSettings),
      scheduledFor: row?.scheduledFor ?? null,
      fulfillment: row?.fulfillment ?? 'PICKUP',
    };
  }

  // -- Events -------------------------------------------------------------------------

  /** The realtime events that describe the current state of an order, for every audience. */
  /**
   * The live events of an order's current state. A real change (`external`, the default) also reaches the
   * restaurant's webhooks and the order listeners (POS sync); a courier position refresh only moves the ETA on
   * screens and passes `external: false`, so integrations are not flooded every few seconds.
   */
  async eventsForOrder(orderId: string, options: { external?: boolean } = {}): Promise<TopicEvent[]> {
    const row = await this.prisma.order.findUnique({ where: { id: orderId }, ...orderArgs });
    if (!row) return [];
    if (options.external !== false) {
      // Every published change also goes to the restaurant's webhooks (docs/API_ERISIMI.md); queued, never awaited.
      await this.webhooks.enqueue(row.restaurantId, 'order.updated', this.toSummary(row, true));
      for (const listener of this.orderListeners) {
        void listener({ id: row.id, restaurantId: row.restaurantId, status: row.status }).catch(() => undefined);
      }
    }
    const events: TopicEvent[] = [
      { topic: dispatchTopic(row.restaurantId), event: { type: 'order.updated', order: this.toSummary(row, true) } },
      { topic: orderTopic(row.id), event: { type: 'tracking.updated', tracking: await this.trackingOf(row) } },
    ];
    const courierMembershipId = row.deliveryStops[0]?.trip.courierMembershipId;
    if (courierMembershipId) {
      events.push({
        topic: courierTopic(courierMembershipId),
        event: { type: 'order.updated', order: this.toSummary(row, true) },
      });
    }
    return events;
  }

  // -- Tracking -----------------------------------------------------------------------

  async trackingByToken(token: string): Promise<OrderTrackingDTO & { orderId: string }> {
    const row = await this.prisma.order.findUnique({ where: { trackingToken: token }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return this.trackingOf(row);
  }

  /** The customer's rating from the tracking page (docs/VITRIN.md): once, on a completed order, within the window. */
  async rateByToken(token: string, input: RateOrderInput): Promise<OrderTrackingDTO> {
    const row = await this.prisma.order.findUnique({ where: { trackingToken: token }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (row.rating) throw conflict('RATING_EXISTS', 'Order already rated');
    await this.features.assertEnabled('ratings', row.restaurantId);
    if (!canRateOrder(row.status, row.completedAt, false))
      throw conflict('RATING_NOT_ALLOWED', 'Order cannot be rated');
    await this.prisma.$transaction(async (tx) => {
      await tx.orderRating.create({
        data: { orderId: row.id, restaurantId: row.restaurantId, score: input.score, comment: input.comment ?? null },
      });
      await tx.restaurant.update({
        where: { id: row.restaurantId },
        data: { ratingCount: { increment: 1 }, ratingSum: { increment: input.score } },
      });
    });
    // A low rating opens a case for the staff (docs/GERI_BILDIRIM.md); never fails the rating itself.
    await this.feedback
      .onRating({ id: row.id, restaurantId: row.restaurantId }, input.score, input.comment ?? null)
      .catch((error: unknown) => this.logger.warn(`feedback for order ${row.id} not recorded: ${String(error)}`));
    await this.webhooks.enqueue(row.restaurantId, 'rating.created', {
      orderId: row.id,
      shortCode: orderShortCode(row.id),
      score: input.score,
      comment: input.comment ?? null,
    });
    return this.trackingByToken(token);
  }

  /**
   * The customer edits their review for a day after writing it (docs/YORUMLAR.md); the score change moves the
   * restaurant's average unless the platform took the review down.
   */
  async editRatingByToken(token: string, input: EditRatingInput): Promise<OrderTrackingDTO> {
    const row = await this.prisma.order.findUnique({ where: { trackingToken: token }, ...orderArgs });
    if (!row || !row.rating) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
    await this.features.assertEnabled('public_reviews', row.restaurantId);
    if (!withinEditWindow(row.rating.createdAt)) throw conflict('REVIEW_EDIT_CLOSED', 'The time to edit is over');
    const rating = row.rating;
    const score = input.score ?? rating.score;
    await this.prisma.$transaction(async (tx) => {
      await tx.orderRating.update({
        where: { id: rating.id },
        data: {
          score,
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
          editedAt: new Date(),
        },
      });
      if (score !== rating.score && !rating.hiddenAt) {
        await tx.restaurant.update({
          where: { id: row.restaurantId },
          data: { ratingSum: { increment: score - rating.score } },
        });
      }
    });
    return this.trackingByToken(token);
  }

  /** The customer's NPS answer from the tracking page (docs/GERI_BILDIRIM.md): once, while the rating window is open. */
  async answerNpsByToken(token: string, input: NpsAnswerInput): Promise<OrderTrackingDTO> {
    const row = await this.prisma.order.findUnique({ where: { trackingToken: token }, ...orderArgs });
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    await this.feedback.recordNps(row, input);
    return this.trackingByToken(token);
  }

  async trackingOf(row: OrderRow): Promise<OrderTrackingDTO> {
    const [restaurant, branch, switches, feedback, tips] = await Promise.all([
      this.prisma.restaurant.findUnique({
        where: { id: row.restaurantId },
        select: { name: true, logoUrl: true, themePrimary: true, timezone: true },
      }),
      this.prisma.branch.findUnique({ where: { id: row.branchId }, select: { phone: true } }),
      this.features.switchesFor(row.restaurantId),
      this.feedback.trackingExtras(row),
      this.tipExtender ? this.tipExtender(row) : Promise.resolve({ tip: null, tipOffer: null }),
    ]);
    const address = this.addressOf(row);
    const destination = address?.point ?? null;
    const given = this.refundedQuantitiesOf(row);
    // The restaurant's own courier asks for it at the door, while the module is on (docs/TESLIMAT_KODU.md);
    // an order handed to a courier network is not delivered by them, so it shows none.
    const showCode =
      row.deliveryCode !== null &&
      row.status !== 'PENDING_PAYMENT' &&
      !TERMINAL_ORDER_STATUSES.includes(row.status) &&
      (await this.features.isEnabled('delivery_pin', row.restaurantId)) &&
      !row.deliveryRequest;
    const stop = row.deliveryStops[0];
    let courier: OrderTrackingDTO['courier'] = null;
    if (
      stop &&
      stop.trip.courierMembershipId &&
      COURIER_LEG_STATUSES.includes(row.status) &&
      row.status !== 'DELIVERED'
    ) {
      const membership = await this.prisma.membership.findUnique({
        where: { id: stop.trip.courierMembershipId },
        select: { user: { select: { fullName: true } }, courierLocation: true },
      });
      const location = stop.trip.status === 'IN_PROGRESS' ? (membership?.courierLocation ?? null) : null;
      const position = location
        ? {
            lat: location.lat,
            lng: location.lng,
            headingDeg: location.headingDeg,
            speedMps: location.speedMps,
            accuracyM: location.accuracyM,
            recordedAt: location.recordedAt.toISOString(),
          }
        : null;
      const stopsAhead = await this.prisma.deliveryStop.count({
        where: { tripId: stop.tripId, status: { in: [...ACTIVE_STOP_STATUSES] }, sequence: { lt: stop.sequence } },
      });
      courier = {
        firstName: membership ? courierDisplayName(membership.user.fullName) : '',
        position,
        distanceMeters: position && destination ? Math.round(haversineMeters(position, destination)) : null,
        stopsAhead,
      };
    }
    return {
      orderId: row.id,
      shortCode: orderShortCode(row.id),
      status: row.status,
      fulfillment: row.fulfillment,
      restaurant: {
        name: restaurant?.name ?? '',
        logoUrl: restaurant?.logoUrl ?? null,
        themePrimary: restaurant?.themePrimary ?? '#0092CD',
        phone: branch?.phone ?? null,
        timezone: restaurant?.timezone ?? 'UTC',
      },
      items: row.items.map((item) => ({
        id: item.id,
        name: item.nameSnapshot,
        quantity: item.quantity,
        refundedQuantity: given.get(item.id) ?? 0,
      })),
      placedAt: row.placedAt.toISOString(),
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      deliveryCode: showCode ? row.deliveryCode : null,
      promisedReadyAt: row.promisedReadyAt?.toISOString() ?? null,
      estimatedDeliveryAt: row.estimatedDeliveryAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      history: row.statusHistory.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
      courier,
      destination,
      rating: row.rating
        ? {
            score: row.rating.score,
            comment: row.rating.comment,
            createdAt: row.rating.createdAt.toISOString(),
            editedAt: row.rating.editedAt?.toISOString() ?? null,
            // The customer may edit for a day while public reviews are on (docs/YORUMLAR.md).
            editableUntil:
              isFeatureEnabled('public_reviews', switches) && withinEditWindow(row.rating.createdAt)
                ? editableUntil(row.rating.createdAt).toISOString()
                : null,
            reply:
              row.rating.reply && row.rating.replyCreatedAt && !row.rating.hiddenAt
                ? {
                    body: row.rating.reply,
                    createdAt: row.rating.replyCreatedAt.toISOString(),
                    editedAt: row.rating.replyEditedAt?.toISOString() ?? null,
                  }
                : null,
          }
        : null,
      canRate: isFeatureEnabled('ratings', switches) && canRateOrder(row.status, row.completedAt, row.rating !== null),
      ...feedback,
      claim: row.claims[0] ? this.claimOf(row, row.claims[0]) : null,
      canClaim:
        isFeatureEnabled('missing_item_claims', switches) &&
        canFileClaim(
          row,
          row.claims.some((c) => isClaimWaiting(c.status)),
          row.payments.reduce((n, p) => n + refundableMinor(p), 0),
        ),
      ...tips,
      courierNetwork:
        row.deliveryRequest && isActiveDeliveryRequest(row.deliveryRequest.status)
          ? { name: row.deliveryRequest.provider.name, trackingUrl: row.deliveryRequest.trackingUrl }
          : null,
    };
  }

  // -- Mapping ------------------------------------------------------------------------

  addressOf(row: Pick<OrderRow, 'addressSnapshot'>): AddressSnapshot | null {
    const raw = row.addressSnapshot;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const snapshot = raw as unknown as AddressSnapshot;
    const point = snapshot.point;
    const safePoint: GeoPoint | null =
      point && typeof point.lat === 'number' && typeof point.lng === 'number'
        ? { lat: point.lat, lng: point.lng }
        : null;
    return { ...snapshot, point: safePoint };
  }

  /**
   * The live events go out once with full contacts; a staff stream without `customers.contact.view` masks them
   * here (order and trip events), exactly as the REST reads do, so the phone number never reaches a role that may
   * not see it.
   */
  static viewForContacts(canSeeContacts: boolean): (event: RealtimeEvent) => RealtimeEvent {
    return (event) => {
      if (canSeeContacts) return event;
      if (event.type === 'trip.updated') return { ...event, trip: maskTripContacts(event.trip) };
      if (event.type !== 'order.updated') return event;
      const order = event.order;
      return {
        ...event,
        order: {
          ...order,
          customer: {
            ...order.customer,
            phone: order.customer.phone ? maskPhoneForDisplay(order.customer.phone) : null,
          },
          address: order.address
            ? { ...order.address, contactPhone: maskPhoneForDisplay(order.address.contactPhone) }
            : null,
        },
      };
    };
  }

  toSummary(row: OrderRow, canSeeContacts: boolean): OrderSummaryDTO {
    const address = this.addressOf(row);
    const stop = row.deliveryStops[0];
    // A customer who deleted their account shows no name or number (docs/KISISEL_VERI.md).
    const customer = visibleContact(row.customer);
    const phone = customer?.phone ?? (address?.contactPhone || null);
    return {
      id: row.id,
      shortCode: orderShortCode(row.id),
      restaurantId: row.restaurantId,
      branchId: row.branchId,
      channel: row.channel,
      source: orderSourceFromParam(row.source),
      fulfillment: row.fulfillment,
      status: row.status,
      currency: row.currency,
      chargedToCustomerMinor: row.chargedToCustomerMinor,
      itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
      tableLabel: row.table?.label ?? null,
      tabId: row.tabId,
      customer: {
        userId: row.customer?.id ?? null,
        fullName: customer?.fullName ?? (address?.contactName || null),
        phone: phone ? (canSeeContacts ? phone : maskPhoneForDisplay(phone)) : null,
      },
      address: address
        ? canSeeContacts
          ? address
          : { ...address, contactPhone: maskPhoneForDisplay(address.contactPhone) }
        : null,
      note: row.customerNote,
      placedAt: row.placedAt.toISOString(),
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      promisedReadyAt: row.promisedReadyAt?.toISOString() ?? null,
      readyAt: row.readyAt?.toISOString() ?? null,
      estimatedDeliveryAt: row.estimatedDeliveryAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      acceptDeadlineAt: row.status === 'PLACED' ? (row.acceptDeadlineAt?.toISOString() ?? null) : null,
      activeTrip: stop
        ? { tripId: stop.tripId, stopId: stop.id, sequence: stop.sequence, tripStatus: stop.trip.status }
        : null,
      openClaimId: row.claims.find((c) => isClaimWaiting(c.status))?.id ?? null,
      payment: this.paymentOf(row),
      courierRequest: row.deliveryRequest ? deliveryRequestSummary(row.id, row.deliveryRequest) : null,
    };
  }

  /** A claim as the panel and the tracking page show it, with what its approval paid out. */
  claimOf(row: OrderRow, claim: OrderRow['claims'][number]): OrderClaimDTO {
    const nameOf = new Map(row.items.map((item) => [item.id, item.nameSnapshot]));
    const items = Array.isArray(claim.items) ? (claim.items as unknown as RefundItem[]) : [];
    return {
      id: claim.id,
      status: claim.status,
      items: items.map((i) => ({
        orderItemId: i.orderItemId,
        name: nameOf.get(i.orderItemId) ?? '',
        quantity: i.quantity,
      })),
      requestedMinor: claim.requestedMinor,
      refundedMinor: row.refunds.filter((r) => r.claimId === claim.id).reduce((n, r) => n + r.amountMinor, 0),
      currency: row.currency,
      note: claim.note,
      declineReason: claim.declineReason,
      createdAt: claim.createdAt.toISOString(),
      decidedAt: claim.decidedAt?.toISOString() ?? null,
      escalatedAt: claim.escalatedAt?.toISOString() ?? null,
    };
  }

  /** How many of each line already went back to the customer. */
  refundedQuantitiesOf(row: OrderRow): Map<string, number> {
    return refundedQuantities(
      row.refunds.map((r) => ({ items: Array.isArray(r.items) ? (r.items as unknown as RefundItem[]) : null })),
    );
  }

  paymentOf(row: OrderRow, now: Date = new Date()): OrderPaymentDTO {
    const latest = row.payments[0] ?? null;
    // Everything ever collected counts, across partial collections and tab shares; a refund later gives money
    // back for what the order no longer charges and never makes the order owe again.
    const captured = row.payments
      .filter((p) => p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED' || p.status === 'REFUNDED')
      .reduce((sum, p) => sum + p.amountMinor, 0);
    // A cancelled or refunded order owes nothing, whatever was or was not collected.
    const closedUnpaid = isTerminalOrderStatus(row.status) && row.status !== 'DELIVERED' && row.status !== 'PICKED_UP';
    // A charged-back payment was paid and then taken back by the bank: nothing is due at the door.
    const chargedBack = latest?.status === 'CHARGED_BACK';
    const failure = row.payments.find((p) => p.refundFailureCode !== null && p.status === 'CAPTURED');
    return {
      method: latest?.method ?? row.paymentMethod ?? null,
      providerCode: latest?.method === 'MEAL_CARD' ? latest.provider : row.paymentProvider,
      status: latest?.status ?? null,
      dueMinor: closedUnpaid || chargedBack ? 0 : Math.max(0, row.chargedToCustomerMinor - captured),
      capturedAt: latest?.capturedAt?.toISOString() ?? null,
      refundedMinor: row.payments.reduce((sum, p) => sum + p.refundedMinor, 0),
      refundState: refundStateOf(row.payments, now),
      refundFailureCode: failure?.refundFailureCode ?? null,
      refundable: canStartRefund(row.status, row.payments, now),
    };
  }

  toDetail(row: OrderRow, canSeeContacts: boolean): OrderDetailDTO {
    const refundItems = (raw: unknown): RefundItem[] => (Array.isArray(raw) ? (raw as RefundItem[]) : []);
    const given = this.refundedQuantitiesOf(row);
    const nameOf = new Map(row.items.map((item) => [item.id, item.nameSnapshot]));
    return {
      ...this.toSummary(row, canSeeContacts),
      items: row.items.map((item) => ({
        id: item.id,
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        lineTotalMinor: item.lineTotalMinor,
        modifiers: Array.isArray(item.modifiersSnapshot)
          ? (item.modifiersSnapshot as unknown as { name: string; priceDeltaMinor: number }[])
          : [],
        refundedQuantity: given.get(item.id) ?? 0,
      })),
      history: row.statusHistory.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
      // The link is the customer's bearer credential (it also shows the delivery code), so only roles that may see
      // the customer's contact details get it; kitchen, counter and courier roles never do.
      ...(canSeeContacts
        ? { trackingUrl: trackingUrl(this.config.getOrThrow<string>('PUBLIC_APP_URL'), row.trackingToken ?? '') }
        : {}),
      itemsGrossMinor: row.itemsGrossMinor,
      deliveryFeeMinor: row.deliveryFeeMinor,
      discountMinor: row.discountMinor,
      restaurantPayableMinor: row.restaurantPayableMinor,
      platformReceivableMinor: row.platformReceivableMinor,
      refunds: row.refunds.map((r) => ({
        id: r.id,
        source: r.source,
        amountMinor: r.amountMinor,
        currency: r.currency,
        commissionMinor: r.commissionMinor,
        commissionVatMinor: r.commissionVatMinor,
        items: refundItems(r.items).map((i) => ({
          orderItemId: i.orderItemId,
          name: nameOf.get(i.orderItemId) ?? '',
          quantity: i.quantity,
        })),
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
      claims: row.claims.map((claim) => this.claimOf(row, claim)),
      customerClaimHistory: null,
    };
  }
}
