import { Inject, Injectable, Logger } from '@nestjs/common';
import { BASE_LOCALE, BUNDLED_MESSAGES, createTranslator, maskPushToken } from '@resget/shared';
import type {
  MessageParams,
  PermissionKey,
  PushData,
  PushDeviceDTO,
  PushTemplateKey,
  RegisterPushDeviceInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER } from './push.provider';
import type { PushMessage, PushProvider } from './push.provider';

export interface PushOutcome {
  /** Devices the service accepted the message for. */
  sent: number;
  failed: number;
}

interface NotifyOptions {
  /** Whose message history shows the attempt; null for platform traffic. */
  restaurantId: string | null;
  /** Language when neither the device nor the profile says one. */
  localeFallback: string;
}

/**
 * Device registry and the push side of the messaging engine
 * (docs/MESAJLASMA.md). Every attempt is a message_logs row with channel
 * PUSH and zero credits; a device the service reports gone is disabled so
 * the next update goes out on the paid channel instead of into the void.
 * Nothing here throws to its callers: a push problem never blocks an order.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  // -- Registry -----------------------------------------------------------------------

  /** Upserts by token: a token that re-registers under another account follows the new sign-in. */
  async register(userId: string, input: RegisterPushDeviceInput): Promise<PushDeviceDTO> {
    const now = new Date();
    const row = await this.prisma.pushDevice.upsert({
      where: { token: input.token },
      create: {
        userId,
        platform: input.platform,
        token: input.token,
        appVersion: input.appVersion ?? null,
        locale: input.locale ?? null,
        lastSeenAt: now,
      },
      update: {
        userId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        locale: input.locale ?? null,
        lastSeenAt: now,
        disabledAt: null,
      },
    });
    return this.toDto(row);
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
  }

  async list(userId: string): Promise<PushDeviceDTO[]> {
    const rows = await this.prisma.pushDevice.findMany({
      where: { userId, disabledAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  // -- Sending ---------------------------------------------------------------------

  /** Pushes one notification to every active device of the given people, each in its own language. */
  async notifyUsers(
    userIds: readonly string[],
    templateKey: PushTemplateKey,
    params: MessageParams,
    data: PushData,
    options: NotifyOptions,
  ): Promise<PushOutcome> {
    if (userIds.length === 0) return { sent: 0, failed: 0 };
    try {
      const devices = await this.prisma.pushDevice.findMany({
        where: { userId: { in: [...userIds] }, disabledAt: null },
        select: { id: true, token: true, locale: true, user: { select: { locale: true } } },
      });
      if (devices.length === 0) return { sent: 0, failed: 0 };

      const messages: PushMessage[] = devices.map((device) => {
        const locale = device.locale ?? device.user.locale ?? options.localeFallback;
        const t = createTranslator({
          locale,
          messages: BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE],
          fallback: BUNDLED_MESSAGES[BASE_LOCALE],
        });
        return {
          token: device.token,
          title: t(`messaging.push.${templateKey}.title`, params),
          body: t(`messaging.push.${templateKey}.body`, params),
          data: { ...data },
        };
      });
      const logs = await this.prisma.$transaction(
        messages.map((m) =>
          this.prisma.messageLog.create({
            data: {
              restaurantId: options.restaurantId,
              channel: 'PUSH',
              toMasked: maskPushToken(m.token),
              templateKey,
              provider: this.provider.code,
            },
            select: { id: true },
          }),
        ),
      );

      const tickets = await this.provider.send(messages);
      let sent = 0;
      for (const [index, ticket] of tickets.entries()) {
        const logId = logs[index]?.id;
        if (!logId) continue;
        if (ticket.accepted) {
          sent += 1;
          await this.prisma.messageLog.update({ where: { id: logId }, data: { status: 'SENT', creditsCharged: 0 } });
          continue;
        }
        await this.prisma.messageLog.update({
          where: { id: logId },
          data: { status: 'FAILED', errorCode: ticket.error ?? 'PROVIDER_REJECTED' },
        });
        if (ticket.deviceGone) {
          await this.prisma.pushDevice.updateMany({ where: { token: ticket.token }, data: { disabledAt: new Date() } });
        }
      }
      return { sent, failed: tickets.length - sent };
    } catch (error) {
      this.logger.warn(`Push ${templateKey} skipped: ${error instanceof Error ? error.message : 'error'}`);
      return { sent: 0, failed: 0 };
    }
  }

  /** Staff of a restaurant who hold a permission: the owner role always, other roles when the key is granted. */
  async notifyRestaurantStaff(
    restaurantId: string,
    permission: PermissionKey,
    templateKey: PushTemplateKey,
    params: MessageParams,
    data: PushData,
  ): Promise<PushOutcome> {
    try {
      const [restaurant, memberships] = await Promise.all([
        this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { defaultLocale: true } }),
        this.prisma.membership.findMany({
          where: {
            restaurantId,
            status: 'ACTIVE',
            roleTemplate: { OR: [{ isOwner: true }, { permissions: { some: { permissionKey: permission } } }] },
          },
          select: { userId: true },
        }),
      ]);
      if (!restaurant) return { sent: 0, failed: 0 };
      const userIds = [...new Set(memberships.map((m) => m.userId))];
      return this.notifyUsers(userIds, templateKey, params, data, {
        restaurantId,
        localeFallback: restaurant.defaultLocale,
      });
    } catch (error) {
      this.logger.warn(`Staff push ${templateKey} skipped: ${error instanceof Error ? error.message : 'error'}`);
      return { sent: 0, failed: 0 };
    }
  }

  private toDto(row: {
    id: string;
    platform: 'IOS' | 'ANDROID';
    token: string;
    appVersion: string | null;
    locale: string | null;
    lastSeenAt: Date;
    createdAt: Date;
  }): PushDeviceDTO {
    return {
      id: row.id,
      platform: row.platform,
      tokenTail: maskPushToken(row.token),
      appVersion: row.appVersion,
      locale: row.locale,
      lastSeenAt: row.lastSeenAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
