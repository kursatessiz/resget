import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ComponentStatus, SystemHealthDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ProviderBalanceMonitor } from '../messaging/provider-balance.monitor';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The console's system page (docs/PLATFORM_YONETIMI.md): measured live, nothing cached, nothing invented. */
@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly balances: ProviderBalanceMonitor,
  ) {}

  async snapshot(now: Date = new Date()): Promise<SystemHealthDTO> {
    const dbStart = Date.now();
    let database: ComponentStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      database = 'error';
      this.logger.error(`database check failed: ${error instanceof Error ? error.message : 'error'}`);
    }
    const latencyMs = Date.now() - dbStart;
    const redis: ComponentStatus = this.redis.isConfigured
      ? (await this.redis.ping())
        ? 'ok'
        : 'error'
      : 'not_configured';

    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const [
      lastBilling,
      ordersLastHour,
      ordersLast24h,
      acceptanceOverdue,
      messagesSentLast24h,
      messagesFailedLast24h,
      openInvoices,
      overdueInvoices,
      suspendedListings,
      activeRestaurants,
      wallets,
      providers,
    ] = await Promise.all([
      this.prisma.auditLog.findFirst({
        where: { action: 'billing.run' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.order.count({ where: { placedAt: { gte: hourAgo }, status: { not: 'PENDING_PAYMENT' } } }),
      this.prisma.order.count({ where: { placedAt: { gte: dayAgo }, status: { not: 'PENDING_PAYMENT' } } }),
      this.prisma.order.count({ where: { status: 'PLACED', acceptDeadlineAt: { lt: now } } }),
      this.prisma.messageLog.count({ where: { createdAt: { gte: dayAgo }, status: { in: ['SENT', 'DELIVERED'] } } }),
      this.prisma.messageLog.count({ where: { createdAt: { gte: dayAgo }, status: 'FAILED' } }),
      this.prisma.commissionInvoice.count({ where: { status: 'ISSUED' } }),
      this.prisma.commissionInvoice.count({ where: { status: 'OVERDUE' } }),
      this.prisma.restaurant.count({ where: { listingSuspendedAt: { not: null } } }),
      this.prisma.restaurant.count({ where: { isActive: true } }),
      this.prisma.messageWallet.groupBy({ by: ['channel'], _sum: { balance: true } }),
      this.balances.check(now),
    ]);

    return {
      checkedAt: now.toISOString(),
      release: this.config.get<string>('APP_RELEASE', 'dev'),
      uptimeSeconds: Math.floor(process.uptime()),
      database: { status: database, latencyMs },
      redis: { status: redis },
      jobs: {
        billingScheduler: this.config.get<string>('BILLING_SCHEDULER') === 'off' ? 'off' : 'on',
        billingLastRunAt: lastBilling?.createdAt.toISOString() ?? null,
        orderWatchdog: this.config.get<string>('ORDER_WATCHDOG') === 'off' ? 'off' : 'on',
      },
      providers: {
        sms: providers.sms,
        whatsapp: providers.whatsapp,
        payment: this.config.get<string>('PAYMENT_PROVIDER', 'MOCK'),
        cardVault: this.config.get<string>('CARD_VAULT_PROVIDER', 'MOCK'),
        courier: this.config.get<string>('COURIER_PROVIDER', 'MOCK'),
        invoice: this.config.get<string>('INVOICE_PROVIDER', 'MOCK'),
        routing: this.config.get<string>('ROUTING_PROVIDER', 'HAVERSINE'),
      },
      activity: {
        ordersLastHour,
        ordersLast24h,
        acceptanceOverdue,
        messagesSentLast24h,
        messagesFailedLast24h,
        openInvoices,
        overdueInvoices,
        suspendedListings,
        activeRestaurants,
      },
      wallets: wallets.map((w) => ({ channel: w.channel, totalBalance: w._sum.balance ?? 0 })),
    };
  }
}
