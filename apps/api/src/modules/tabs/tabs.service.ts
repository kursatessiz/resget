import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@resget/database';
import { allocateTabPayment, countsOnBill, isTerminalOrderStatus, orderShortCode } from '@resget/shared';
import type {
  CollectTabPaymentInput,
  GatewayWebhookEvent,
  PayTabShareInput,
  TabPaymentStartedDTO,
  TabBillDTO,
  TabBillLineDTO,
  TabOrderDTO,
  TabStatus,
  TabSummaryDTO,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRow } from '../orders/orders.service';
import { MealCardsService } from '../payments/meal-cards.service';
import { CheckoutService } from '../payments/checkout.service';
import type { WebhookScope } from '../payments/checkout.service';
import { PaymentsRegistry } from '../payments/payments.registry';
import { badRequest, conflict, notFound } from '../../common/api-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = Prisma.TransactionClient | PrismaService;

const tabSelect = {
  id: true,
  restaurantId: true,
  status: true,
  publicToken: true,
  openedAt: true,
  closedAt: true,
  tableId: true,
  table: { select: { label: true } },
  restaurant: { select: { name: true, currency: true, themePrimary: true, logoUrl: true } },
  orders: { orderBy: { placedAt: 'asc' }, select: { id: true } },
} satisfies Prisma.TableTabSelect;
type TabRow = Prisma.TableTabGetPayload<{ select: typeof tabSelect }>;

interface ResolvedTab {
  row: TabRow;
  orders: OrderRow[];
  bill: TabBillDTO;
}

/**
 * Open tab at the table (docs/ACIK_HESAP.md). The bill gathers the tab's
 * orders; staff collect it in one go or in shares, and each share is spread
 * over the orders oldest first as ordinary counter payments (OWN_POS). A
 * row lock on the tab keeps two collections from paying the same amount.
 */
@Injectable()
export class TabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly mealCards: MealCardsService,
    private readonly realtime: RealtimeService,
    private readonly features: FeatureFlagsService,
    private readonly config: ConfigService,
    private readonly checkout: CheckoutService,
    private readonly payments: PaymentsRegistry,
  ) {
    this.checkout.addReferenceHandler((event, scope) => this.handleWebhook(event, scope));
  }

  private readonly logger = new Logger(TabsService.name);

  // -- Panel -----------------------------------------------------------------------

  async listOpen(restaurantId: string): Promise<TabSummaryDTO[]> {
    const rows = await this.prisma.tableTab.findMany({
      where: { restaurantId, status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
      select: tabSelect,
    });
    const resolved = await Promise.all(rows.map((row) => this.resolve(this.prisma, row)));
    return resolved.map(({ row, bill }) => ({
      id: row.id,
      token: row.publicToken,
      tableId: row.tableId,
      tableLabel: row.table.label,
      openedAt: row.openedAt.toISOString(),
      orderCount: bill.orders.filter((o) => countsOnBill(o.status)).length,
      totalMinor: bill.totalMinor,
      paidMinor: bill.paidMinor,
      dueMinor: bill.dueMinor,
      currency: bill.currency,
    }));
  }

  async bill(restaurantId: string, tabId: string): Promise<TabBillDTO> {
    const [{ bill }, accepted] = await Promise.all([
      this.load(this.prisma, restaurantId, tabId),
      this.mealCards.acceptedMethods(restaurantId),
    ]);
    return {
      ...bill,
      collect: {
        cash: accepted.cashOnDelivery,
        card: accepted.cardOnDelivery,
        mealCards: accepted.mealCardsOnDelivery.map((c) => ({ providerCode: c.providerCode, name: c.name })),
      },
    };
  }

  /**
   * A share of the bill, collected at the table or the counter with cash, a card on the restaurant's POS or a
   * meal card. Spread over the tab's orders oldest first; the tab closes by itself once everything is paid and
   * every order is served or off the bill.
   */
  async collect(
    restaurantId: string,
    tabId: string,
    input: CollectTabPaymentInput,
    actorUserId: string,
  ): Promise<TabBillDTO> {
    const accepted = await this.mealCards.acceptedMethods(restaurantId);
    if (input.method === 'MEAL_CARD') {
      if (!accepted.mealCardsOnDelivery.some((c) => c.providerCode === input.providerCode)) {
        throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `${input.providerCode} is not accepted at the counter`);
      }
    } else if (input.method === 'CASH_ON_DELIVERY' ? !accepted.cashOnDelivery : !accepted.cardOnDelivery) {
      throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', `${input.method} is off`);
    }
    const provider =
      input.method === 'MEAL_CARD'
        ? input.providerCode!
        : input.method === 'CASH_ON_DELIVERY'
          ? 'CASH'
          : 'POS_ON_DELIVERY';
    const touched = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, tabId);
      const { row, orders } = await this.load(tx, restaurantId, tabId);
      if (row.status !== 'OPEN') throw conflict('TAB_CLOSED', 'The tab is closed');
      const owed = this.owedOn(orders);
      if (owed === 0) throw conflict('PAYMENT_STATE_INVALID', 'The tab is already paid');
      if (input.amountMinor > owed) throw conflict('PAYMENT_STATE_INVALID', 'Amount exceeds what the tab owes');
      const { orderIds } = await this.spread(tx, restaurantId, orders, input.amountMinor, {
        provider,
        method: input.method,
        providerRef: input.reference ?? null,
        collectedByUserId: actorUserId,
      });
      await this.closeIfSettled(tx, restaurantId, tabId, actorUserId);
      return orderIds;
    });
    for (const orderId of touched) this.realtime.publishMany(await this.orders.eventsForOrder(orderId));
    return this.bill(restaurantId, tabId);
  }

  /** Closes a settled tab by hand, for instance while an order is still on its way to the table. */
  async close(restaurantId: string, tabId: string, actorUserId: string): Promise<TabBillDTO> {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, tabId);
      const { row, bill } = await this.load(tx, restaurantId, tabId);
      if (row.status !== 'OPEN') throw conflict('TAB_CLOSED', 'The tab is closed');
      if (bill.dueMinor > 0) throw conflict('TAB_NOT_SETTLED', 'The tab still owes money');
      await this.markClosed(tx, tabId, actorUserId);
    });
    return this.bill(restaurantId, tabId);
  }

  // -- Table -----------------------------------------------------------------------

  /** The bill shown to the table: no names or phones, only what was ordered and what is left. */
  async publicBill(token: string): Promise<TabBillDTO> {
    const row = await this.prisma.tableTab.findUnique({ where: { publicToken: token }, select: tabSelect });
    if (!row || !(await this.features.isEnabled('table_tabs', row.restaurantId)))
      throw notFound('TAB_NOT_FOUND', 'Tab not found');
    const { bill } = await this.resolve(this.prisma, row);
    return {
      ...bill,
      payOnline: bill.status === 'OPEN' && bill.dueMinor > 0 && (await this.canPayOnline(row.restaurantId)),
    };
  }

  /** The table's running tab for the menu page, when there is one. */
  async openForTable(tableId: string): Promise<{ token: string; totalMinor: number; dueMinor: number } | null> {
    const row = await this.prisma.tableTab.findUnique({ where: { openKey: tableId }, select: tabSelect });
    if (!row) return null;
    const { bill } = await this.resolve(this.prisma, row);
    return { token: row.publicToken, totalMinor: bill.totalMinor, dueMinor: bill.dueMinor };
  }

  tabUrl(token: string): string {
    return `${this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/$/, '')}/hesap/${token}`;
  }

  // -- Paying a share from the phone (docs/ACIK_HESAP.md, "Telefondan pay ödemesi") ---------

  /** A share paid by card online always lands on the restaurant's own POS: tab orders are restaurant-collected. */
  private async canPayOnline(restaurantId: string): Promise<boolean> {
    const [restaurant, accepted] = await Promise.all([
      this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { paymentMode: true } }),
      this.mealCards.acceptedMethods(restaurantId),
    ]);
    return restaurant?.paymentMode === 'OWN_POS' && accepted.onlineCard;
  }

  async startOnlinePayment(token: string, input: PayTabShareInput, customerIp?: string): Promise<TabPaymentStartedDTO> {
    const row = await this.prisma.tableTab.findUnique({ where: { publicToken: token }, select: tabSelect });
    if (!row || !(await this.features.isEnabled('table_tabs', row.restaurantId)))
      throw notFound('TAB_NOT_FOUND', 'Tab not found');
    if (row.status !== 'OPEN') throw conflict('TAB_CLOSED', 'The tab is closed');
    if (!(await this.canPayOnline(row.restaurantId))) {
      throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'The restaurant takes no card payment online');
    }
    const { orders } = await this.resolve(this.prisma, row);
    if (input.amountMinor > this.owedOn(orders)) {
      throw conflict('PAYMENT_STATE_INVALID', 'Amount exceeds what the tab owes');
    }
    const payment = await this.prisma.tabPayment.create({
      data: {
        restaurantId: row.restaurantId,
        tabId: row.id,
        amountMinor: input.amountMinor,
        currency: row.restaurant.currency,
        provider: 'POS',
      },
    });
    const opened = await this.checkout.openHostedCheckout(row.restaurantId, {
      orderRef: payment.id,
      amountMinor: input.amountMinor,
      currency: row.restaurant.currency,
      returnUrl: input.returnUrl,
      // The table's link carries no personal data; the provider's page asks for what it needs.
      customerPhone: '',
      ...(customerIp ? { customerIp } : {}),
    });
    if (opened.paymentMode !== 'OWN_POS') throw conflict('PAYMENT_METHOD_NOT_ACCEPTED', 'Not the restaurant POS');
    await this.prisma.tabPayment.update({
      where: { id: payment.id },
      data: { provider: opened.providerCode, providerRef: opened.session.sessionId },
    });
    return { paymentId: payment.id, session: opened.session };
  }

  /** Null when the reference is not a tab share; otherwise what the notification did. */
  async handleWebhook(
    event: GatewayWebhookEvent,
    scope: WebhookScope,
  ): Promise<GatewayWebhookEvent['status'] | 'IGNORED' | null> {
    if (!UUID.test(event.orderRef)) return null;
    const payment = await this.prisma.tabPayment.findUnique({ where: { id: event.orderRef } });
    if (!payment) return null;
    if (scope.mode !== 'OWN_POS' || scope.restaurantId !== payment.restaurantId) return 'IGNORED';
    if (event.currency !== payment.currency) throw badRequest('WEBHOOK_INVALID', 'Currency mismatch');
    if (event.status === 'FAILED') {
      await this.prisma.tabPayment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      return 'FAILED';
    }
    if (event.status !== 'CAPTURED') {
      // A refund made in the provider's own panel is applied per order from the panel (docs/ACIK_HESAP.md).
      this.logger.warn(`Tab payment ${payment.id}: ${event.status} notice left for staff`);
      return 'IGNORED';
    }
    if (event.amountMinor <= 0) throw badRequest('WEBHOOK_INVALID', 'Empty payment');
    const outcome = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tabPayment.updateMany({
        where: { id: payment.id, status: { in: ['PENDING', 'FAILED'] } },
        data: {
          status: 'CAPTURED',
          amountMinor: event.amountMinor,
          providerRef: event.providerRef,
          capturedAt: new Date(event.occurredAt),
        },
      });
      if (count === 0) return null;
      await this.lock(tx, payment.tabId);
      const { orders } = await this.load(tx, payment.restaurantId, payment.tabId);
      // Someone may have paid at the counter meanwhile: the bill takes only what it still owes.
      const applied = Math.min(event.amountMinor, this.owedOn(orders));
      const { orderIds } = await this.spread(tx, payment.restaurantId, orders, applied, {
        provider: payment.provider,
        method: 'ONLINE_CARD',
        providerRef: event.providerRef,
        collectedByUserId: null,
      });
      const excessMinor = event.amountMinor - applied;
      if (excessMinor > 0) await tx.tabPayment.update({ where: { id: payment.id }, data: { excessMinor } });
      await this.closeIfSettled(tx, payment.restaurantId, payment.tabId, null);
      return { orderIds, excessMinor };
    });
    if (!outcome) return 'CAPTURED';
    if (outcome.excessMinor > 0) await this.refundExcess(payment.id, event.providerRef, outcome.excessMinor);
    for (const orderId of outcome.orderIds) this.realtime.publishMany(await this.orders.eventsForOrder(orderId));
    return 'CAPTURED';
  }

  /** Gives back what the bill no longer owed, on the restaurant's POS; a failure stays on the record. */
  private async refundExcess(paymentId: string, providerRef: string, amountMinor: number): Promise<void> {
    try {
      const payment = await this.prisma.tabPayment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { restaurant: { select: { paymentConnection: true } } },
      });
      const pos = payment.restaurant.paymentConnection;
      const gateway = pos ? this.payments.gateway(pos.providerCode) : null;
      if (!pos || !gateway) throw new Error('No POS connection');
      const result = await gateway.refund(
        this.payments.cipher.decryptJson(pos.encryptedCredentials),
        providerRef,
        amountMinor,
      );
      if (!result.ok) throw new Error('Refund declined');
      await this.prisma.tabPayment.update({ where: { id: paymentId }, data: { excessRefundedAt: new Date() } });
    } catch (err) {
      this.logger.warn(`Tab payment ${paymentId}: excess ${amountMinor} not refunded: ${(err as Error).message}`);
    }
  }

  // -- Helpers ---------------------------------------------------------------------

  /** What the bill still owes over the orders a collection may pay (not those waiting for their own payment). */
  private payableOf(orders: OrderRow[]): OrderRow[] {
    return orders.filter((o) => countsOnBill(o.status) && o.status !== 'PENDING_PAYMENT');
  }

  private owedOn(orders: OrderRow[]): number {
    return this.payableOf(orders).reduce((sum, o) => sum + this.orders.paymentOf(o).dueMinor, 0);
  }

  /** Spreads an amount over the tab's orders oldest first, each part an ordinary payment of its order (OWN_POS). */
  private async spread(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    orders: OrderRow[],
    amountMinor: number,
    base: {
      provider: string;
      method: CollectTabPaymentInput['method'] | 'ONLINE_CARD';
      providerRef: string | null;
      collectedByUserId: string | null;
    },
  ): Promise<{ orderIds: string[] }> {
    if (amountMinor <= 0) return { orderIds: [] };
    const payable = this.payableOf(orders);
    const dues = payable.map((o) => ({ orderId: o.id, dueMinor: this.orders.paymentOf(o).dueMinor }));
    const capturedAt = new Date();
    const parts = allocateTabPayment(amountMinor, dues);
    for (const part of parts) {
      const order = payable.find((o) => o.id === part.orderId)!;
      const data = {
        provider: base.provider,
        method: base.method,
        status: 'CAPTURED' as const,
        amountMinor: part.amountMinor,
        providerRef: base.providerRef,
        capturedAt,
        collectedByUserId: base.collectedByUserId,
        paymentMode: 'OWN_POS' as const,
      };
      const pending = order.payments.find((p) => p.status === 'PENDING');
      if (pending) await tx.payment.update({ where: { id: pending.id }, data });
      else await tx.payment.create({ data: { restaurantId, orderId: order.id, currency: order.currency, ...data } });
      await tx.order.update({
        where: { id: order.id },
        data: { paymentMethod: base.method, paymentProvider: base.method === 'MEAL_CARD' ? base.provider : null },
      });
    }
    return { orderIds: parts.map((p) => p.orderId) };
  }

  private async lock(tx: Prisma.TransactionClient, tabId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM table_tabs WHERE id = ${tabId} FOR UPDATE`;
  }

  private async load(db: Db, restaurantId: string, tabId: string): Promise<ResolvedTab> {
    const row = await db.tableTab.findFirst({ where: { id: tabId, restaurantId }, select: tabSelect });
    if (!row) throw notFound('TAB_NOT_FOUND', 'Tab not found');
    return this.resolve(db, row);
  }

  private async resolve(db: Db, row: TabRow): Promise<ResolvedTab> {
    const orders = await Promise.all(row.orders.map((o) => this.orders.loadRow(db, o.id)));
    return { row, orders, bill: this.toBill(row, orders) };
  }

  private async closeIfSettled(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    tabId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const { bill } = await this.load(tx, restaurantId, tabId);
    const allDone = bill.orders.every((o) => isTerminalOrderStatus(o.status));
    if (bill.dueMinor === 0 && allDone) await this.markClosed(tx, tabId, actorUserId);
  }

  private async markClosed(tx: Prisma.TransactionClient, tabId: string, actorUserId: string | null): Promise<void> {
    await tx.tableTab.update({
      where: { id: tabId },
      data: { status: 'CLOSED', openKey: null, closedAt: new Date(), closedByUserId: actorUserId },
    });
  }

  private toBill(row: TabRow, orders: OrderRow[]): TabBillDTO {
    const onBill = orders.filter((o) => countsOnBill(o.status));
    const lines: TabBillLineDTO[] = onBill.flatMap((order) =>
      order.items.map((item) => ({
        id: item.id,
        orderShortCode: orderShortCode(order.id),
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        totalMinor: item.lineTotalMinor,
        modifiers: Array.isArray(item.modifiersSnapshot)
          ? (item.modifiersSnapshot as { name?: unknown }[])
              .map((m) => (typeof m.name === 'string' ? m.name : null))
              .filter((name): name is string => name !== null)
          : [],
      })),
    );
    const tabOrders: TabOrderDTO[] = orders.map((order) => ({
      id: order.id,
      shortCode: orderShortCode(order.id),
      status: order.status,
      chargedToCustomerMinor: order.chargedToCustomerMinor,
      discountMinor: order.discountMinor,
      dueMinor: countsOnBill(order.status) ? this.orders.paymentOf(order).dueMinor : 0,
      createdAt: order.placedAt.toISOString(),
    }));
    const totalMinor = onBill.reduce((sum, o) => sum + o.chargedToCustomerMinor, 0);
    const dueMinor = tabOrders.reduce((sum, o) => sum + o.dueMinor, 0);
    return {
      id: row.id,
      token: row.publicToken,
      status: row.status as TabStatus,
      restaurantName: row.restaurant.name,
      themePrimary: row.restaurant.themePrimary,
      logoUrl: row.restaurant.logoUrl,
      tableLabel: row.table.label,
      currency: row.restaurant.currency,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      lines,
      orders: tabOrders,
      discountMinor: onBill.reduce((sum, o) => sum + o.discountMinor, 0),
      totalMinor,
      paidMinor: totalMinor - dueMinor,
      dueMinor,
      payOnline: false,
      collect: null,
    };
  }
}
