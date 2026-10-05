import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@resget/database';
import { allocateTabPayment, countsOnBill, isTerminalOrderStatus, orderShortCode } from '@resget/shared';
import type {
  CollectTabPaymentInput,
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
import { conflict, notFound } from '../../common/api-error';

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
  ) {}

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
      // An order still waiting for its own online payment is not on the bill to collect.
      const payable = orders.filter((o) => countsOnBill(o.status) && o.status !== 'PENDING_PAYMENT');
      const dues = payable.map((o) => ({ orderId: o.id, dueMinor: this.orders.paymentOf(o).dueMinor }));
      const owed = dues.reduce((sum, d) => sum + d.dueMinor, 0);
      if (owed === 0) throw conflict('PAYMENT_STATE_INVALID', 'The tab is already paid');
      if (input.amountMinor > owed) throw conflict('PAYMENT_STATE_INVALID', 'Amount exceeds what the tab owes');
      const capturedAt = new Date();
      const parts = allocateTabPayment(input.amountMinor, dues);
      for (const part of parts) {
        const order = payable.find((o) => o.id === part.orderId)!;
        const data = {
          provider,
          method: input.method,
          status: 'CAPTURED' as const,
          amountMinor: part.amountMinor,
          providerRef: input.reference ?? null,
          capturedAt,
          collectedByUserId: actorUserId,
          paymentMode: 'OWN_POS' as const,
        };
        const pending = order.payments.find((p) => p.status === 'PENDING');
        if (pending) await tx.payment.update({ where: { id: pending.id }, data });
        else await tx.payment.create({ data: { restaurantId, orderId: order.id, currency: order.currency, ...data } });
        await tx.order.update({
          where: { id: order.id },
          data: { paymentMethod: input.method, paymentProvider: input.method === 'MEAL_CARD' ? provider : null },
        });
      }
      await this.closeIfSettled(tx, restaurantId, tabId, actorUserId);
      return parts.map((p) => p.orderId);
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
    return (await this.resolve(this.prisma, row)).bill;
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

  // -- Helpers ---------------------------------------------------------------------

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
    actorUserId: string,
  ): Promise<void> {
    const { bill } = await this.load(tx, restaurantId, tabId);
    const allDone = bill.orders.every((o) => isTerminalOrderStatus(o.status));
    if (bill.dueMinor === 0 && allDone) await this.markClosed(tx, tabId, actorUserId);
  }

  private async markClosed(tx: Prisma.TransactionClient, tabId: string, actorUserId: string): Promise<void> {
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
      collect: null,
    };
  }
}
