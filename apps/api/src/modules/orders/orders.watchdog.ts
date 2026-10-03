import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { orderShortCode } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MessagingService } from '../messaging/messaging.service';
import { OrdersService } from './orders.service';

const MINUTE_MS = 60_000;

/**
 * Acceptance watchdog (docs/SIPARIS_VE_SEVK.md): once a minute, every PLACED
 * order past its acceptDeadlineAt that has not alarmed yet gets its alarm:
 * the row is stamped, the restaurant's screens receive a fresh order event
 * (the card turns red and the board sounds), and the owner is messaged once
 * on the platform's account. Nothing is rejected on the restaurant's behalf;
 * the customer keeps the order until a person decides. Off in tests and with
 * ORDER_WATCHDOG=off.
 */
@Injectable()
export class OrdersWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('ORDER_WATCHDOG') === 'off') return;
    this.timer = setInterval(() => void this.tick(), MINUTE_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Alarms overdue PLACED orders; returns how many alarmed in this pass. */
  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const overdue = await this.prisma.order.findMany({
        where: { status: 'PLACED', acceptDeadlineAt: { lt: now }, acceptAlertSentAt: null },
        select: {
          id: true,
          restaurantId: true,
          placedAt: true,
          restaurant: { select: { name: true, defaultLocale: true } },
        },
        orderBy: { acceptDeadlineAt: 'asc' },
        take: 100,
      });
      let alarmed = 0;
      for (const order of overdue) {
        // Another instance may have taken it between the read and here; the stamp decides.
        const stamped = await this.prisma.order.updateMany({
          where: { id: order.id, acceptAlertSentAt: null },
          data: { acceptAlertSentAt: now },
        });
        if (stamped.count === 0) continue;
        alarmed += 1;
        this.realtime.publishMany(await this.orders.eventsForOrder(order.id));
        await this.notifyOwner(order, Math.round((now.getTime() - order.placedAt.getTime()) / MINUTE_MS));
      }
      return alarmed;
    } catch (error) {
      this.logger.error(`acceptance watchdog failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async notifyOwner(
    order: { id: string; restaurantId: string; restaurant: { name: string; defaultLocale: string } },
    minutes: number,
  ): Promise<void> {
    const owner = await this.prisma.membership.findFirst({
      where: { restaurantId: order.restaurantId, status: 'ACTIVE', roleTemplate: { isOwner: true } },
      select: { user: { select: { phone: true, locale: true } } },
    });
    if (!owner) return;
    await this.messaging.send({
      restaurantId: order.restaurantId,
      channel: 'SMS',
      to: owner.user.phone,
      templateKey: 'order.acceptOverdue',
      params: { restaurant: order.restaurant.name, code: orderShortCode(order.id), minutes },
      locale: owner.user.locale ?? order.restaurant.defaultLocale,
      billable: false,
    });
  }
}
