import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_KEY_EXPIRY_NOTICE_DAYS } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Reminds the owner, once per key, that an API key expires within
 * API_KEY_EXPIRY_NOTICE_DAYS (docs/API_ERISIMI.md). The reminder is
 * platform traffic like the invoice notices: it never touches the
 * restaurant's message credits. A key is marked before the message goes
 * out, so two API instances never remind twice; a failed send is logged.
 */
@Injectable()
export class ApiKeyExpiryNotifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiKeyExpiryNotifier.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('API_KEY_EXPIRY_NOTICES') === 'off')
      return;
    this.timer = setInterval(() => void this.run(), HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sends the reminders now due; returns how many keys were reminded. */
  async run(now: Date = new Date()): Promise<number> {
    try {
      const due = await this.prisma.restaurantApiKey.findMany({
        where: {
          revokedAt: null,
          expiryNoticeAt: null,
          expiresAt: { gt: now, lte: new Date(now.getTime() + API_KEY_EXPIRY_NOTICE_DAYS * DAY_MS) },
        },
        select: {
          id: true,
          name: true,
          expiresAt: true,
          restaurantId: true,
          restaurant: { select: { name: true, defaultLocale: true } },
        },
        take: 100,
      });
      let sent = 0;
      for (const key of due) {
        const { count } = await this.prisma.restaurantApiKey.updateMany({
          where: { id: key.id, expiryNoticeAt: null },
          data: { expiryNoticeAt: now },
        });
        if (count === 0 || !key.expiresAt) continue;
        if (await this.remind(key.restaurantId, key.restaurant, key.name, key.expiresAt)) sent += 1;
      }
      return sent;
    } catch (error) {
      this.logger.warn(`API key expiry notices failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    }
  }

  private async remind(
    restaurantId: string,
    restaurant: { name: string; defaultLocale: string },
    keyName: string,
    expiresAt: Date,
  ): Promise<boolean> {
    try {
      const owner = await this.prisma.membership.findFirst({
        where: { restaurantId, status: 'ACTIVE', roleTemplate: { isOwner: true } },
        select: { user: { select: { phone: true, locale: true } } },
      });
      if (!owner) return false;
      const locale = owner.user.locale ?? restaurant.defaultLocale;
      const result = await this.messaging.send({
        restaurantId,
        channel: 'SMS',
        to: owner.user.phone,
        templateKey: 'apiKey.expiring',
        params: {
          restaurant: restaurant.name,
          name: keyName,
          date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(expiresAt),
        },
        locale,
        billable: false,
      });
      return result.status === 'SENT';
    } catch (error) {
      this.logger.warn(`API key expiry notice failed: ${error instanceof Error ? error.message : 'error'}`);
      return false;
    }
  }
}
