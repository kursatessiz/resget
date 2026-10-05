import { Injectable } from '@nestjs/common';
import { KITCHEN_STATUSES, orderShortCode, sortKitchenTickets } from '@resget/shared';
import type { KitchenBoardDTO, KitchenItemDTO, KitchenTicketDTO } from '@resget/shared';
import { notFound } from '../../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OrdersService } from '../orders/orders.service';

/** Snapshot entries are { name, priceDeltaMinor }; anything else is skipped. */
function modifierNames(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .map((entry: unknown) =>
      entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string' ? entry.name : null,
    )
    .filter((name): name is string => name !== null);
}

/**
 * The kitchen display (docs/MUTFAK_EKRANI.md): accepted orders as tickets,
 * each line marked done by the cook. The first done line starts the order
 * (ACCEPTED -> PREPARING); READY stays an explicit step on the screen, so
 * the order goes through the same state machine as everywhere else.
 */
@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
  ) {}

  async board(restaurantId: string, station?: string): Promise<KitchenBoardDTO> {
    const [categories, rows] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { restaurantId, kitchenStation: { not: null } },
        select: { kitchenStation: true },
        distinct: ['kitchenStation'],
        orderBy: { kitchenStation: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { restaurantId, status: { in: [...KITCHEN_STATUSES] } },
        orderBy: { placedAt: 'asc' },
        take: 200,
        select: {
          id: true,
          status: true,
          fulfillment: true,
          channel: true,
          customerNote: true,
          placedAt: true,
          acceptedAt: true,
          promisedReadyAt: true,
          scheduledFor: true,
          table: { select: { label: true } },
          items: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              nameSnapshot: true,
              quantity: true,
              modifiersSnapshot: true,
              preparedAt: true,
              menuItem: { select: { category: { select: { kitchenStation: true } } } },
            },
          },
        },
      }),
    ]);
    const tickets: KitchenTicketDTO[] = [];
    for (const row of rows) {
      const items: KitchenItemDTO[] = row.items
        .map((item) => ({
          id: item.id,
          name: item.nameSnapshot,
          quantity: item.quantity,
          modifiers: modifierNames(item.modifiersSnapshot),
          station: item.menuItem?.category.kitchenStation ?? null,
          preparedAt: item.preparedAt?.toISOString() ?? null,
        }))
        .filter((item) => station === undefined || item.station === station);
      if (items.length === 0) continue;
      tickets.push({
        orderId: row.id,
        shortCode: orderShortCode(row.id),
        status: row.status,
        fulfillment: row.fulfillment,
        channel: row.channel,
        tableLabel: row.table?.label ?? null,
        note: row.customerNote,
        placedAt: row.placedAt.toISOString(),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        promisedReadyAt: row.promisedReadyAt?.toISOString() ?? null,
        scheduledFor: row.scheduledFor?.toISOString() ?? null,
        items,
      });
    }
    return {
      stations: categories.map((c) => c.kitchenStation).filter((s): s is string => s !== null),
      tickets: sortKitchenTickets(tickets),
    };
  }

  /** Marks one line done or not done; the first done line starts an accepted order. */
  async markItem(restaurantId: string, itemId: string, prepared: boolean, userId: string): Promise<void> {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, order: { restaurantId, status: { in: [...KITCHEN_STATUSES] } } },
      select: { id: true, orderId: true, order: { select: { status: true } } },
    });
    if (!item) throw notFound('ORDER_NOT_FOUND', 'No such line on an order in the kitchen');
    await this.prisma.orderItem.update({
      where: { id: item.id },
      data: { preparedAt: prepared ? new Date() : null },
    });
    if (prepared && item.order.status === 'ACCEPTED') {
      try {
        // The transition publishes the order's events itself.
        await this.orders.transition(restaurantId, item.orderId, { to: 'PREPARING' }, 'RESTAURANT', userId, false);
        return;
      } catch (error) {
        // Another cook's line started it a moment earlier; anything else is a real failure.
        const now = await this.prisma.order.findUnique({ where: { id: item.orderId }, select: { status: true } });
        if (now?.status !== 'PREPARING') throw error;
      }
    }
    // Other kitchen screens and the orders screen follow the same order events.
    this.realtime.publishMany(await this.orders.eventsForOrder(item.orderId));
  }
}
