import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  CREDIT_CHANNELS,
  NotificationSettingsSchema,
  createTranslator,
  notificationSettingsFrom,
  whatsappTemplateFor,
} from '@resget/shared';
import type {
  CreditChannel,
  MessageCreditPackageDTO,
  MessageLogDTO,
  MessageParams,
  MessageTemplateKey,
  MessageWalletDTO,
  MessagingOverviewDTO,
  NotificationChannel,
  NotificationSettings,
  WhatsAppTemplateMessage,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, maskPhone } from './sms.provider';
import type { SmsProvider, SmsSendResult } from './sms.provider';
import { WHATSAPP_PROVIDER } from './whatsapp.provider';
import type { WhatsAppProvider } from './whatsapp.provider';

export interface SendMessageRequest {
  /** The restaurant whose wallet pays, or null for platform traffic (OTP, invites). */
  restaurantId: string | null;
  channel: NotificationChannel;
  to: string;
  templateKey: MessageTemplateKey;
  params?: MessageParams;
  locale: string;
  /** False for platform traffic: no wallet is checked or debited. */
  billable: boolean;
  /** Try SMS when the preferred channel refuses (restaurant setting). */
  fallbackToSms?: boolean;
}

export interface SendMessageResult {
  status: 'SENT' | 'FAILED';
  channel: NotificationChannel;
  logId: string;
  errorCode: string | null;
}

/**
 * The one door every message leaves through (docs/MESAJLASMA.md). Renders
 * the template in the recipient's language, writes a MessageLog per attempt
 * and debits one credit from the restaurant's wallet of that channel only
 * after the provider accepted the message. A wallet never goes negative.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  render(templateKey: MessageTemplateKey, params: MessageParams | undefined, locale: string): string {
    const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
    const t = createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
    return t(`messaging.template.${templateKey}`, params);
  }

  /** The approved WhatsApp template for a message, filled in the recipient's language (docs/MESAJLASMA.md). */
  whatsappTemplate(request: SendMessageRequest): WhatsAppTemplateMessage | null {
    const messages = BUNDLED_MESSAGES[request.locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
    const t = createTranslator({ locale: request.locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
    return whatsappTemplateFor(request.templateKey, request.params, request.locale, t);
  }

  async send(request: SendMessageRequest): Promise<SendMessageResult> {
    const text = this.render(request.templateKey, request.params, request.locale);
    const first = await this.attempt(request, request.channel, text);
    if (first.status === 'SENT' || request.channel === 'SMS' || !request.fallbackToSms) return first;
    return this.attempt(request, 'SMS', text);
  }

  private async attempt(
    request: SendMessageRequest,
    channel: NotificationChannel,
    text: string,
  ): Promise<SendMessageResult> {
    const provider = channel === 'WHATSAPP' ? this.whatsapp : this.sms;
    const log = await this.prisma.messageLog.create({
      data: {
        restaurantId: request.restaurantId,
        channel,
        toMasked: maskPhone(request.to),
        templateKey: request.templateKey,
        provider: provider.code,
      },
      select: { id: true },
    });
    const fail = async (errorCode: string): Promise<SendMessageResult> => {
      await this.prisma.messageLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorCode } });
      return { status: 'FAILED', channel, logId: log.id, errorCode };
    };

    let wallet: { id: string; balance: number } | null = null;
    if (request.billable) {
      if (!request.restaurantId) return fail('INSUFFICIENT_CREDITS');
      wallet = await this.prisma.messageWallet.findUnique({
        where: { restaurantId_channel: { restaurantId: request.restaurantId, channel } },
        select: { id: true, balance: true },
      });
      // Checked before the send so a restaurant without credit never reaches the provider.
      if (!wallet || wallet.balance < 1) return fail('INSUFFICIENT_CREDITS');
    }

    let result: SmsSendResult;
    try {
      result =
        channel === 'WHATSAPP'
          ? await this.whatsapp.send(request.to, text, this.whatsappTemplate(request) ?? undefined)
          : await this.sms.send(request.to, text);
    } catch (error) {
      this.logger.warn(`${provider.code} ${channel} send failed: ${error instanceof Error ? error.message : 'error'}`);
      return fail('PROVIDER_ERROR');
    }
    if (!result.accepted) return fail('PROVIDER_REJECTED');

    let creditsCharged = 0;
    if (wallet) {
      // Atomic guard: the decrement only happens while the balance covers it, so two concurrent sends cannot overdraw.
      creditsCharged = await this.prisma.$transaction(async (tx) => {
        const debited = await tx.messageWallet.updateMany({
          where: { id: wallet.id, balance: { gte: 1 } },
          data: { balance: { decrement: 1 } },
        });
        if (debited.count === 0) return 0;
        const after = await tx.messageWallet.findUniqueOrThrow({ where: { id: wallet.id }, select: { balance: true } });
        await tx.messageTransaction.create({
          data: { walletId: wallet.id, type: 'DEBIT', delta: -1, balanceAfter: after.balance, reference: log.id },
        });
        return 1;
      });
    }
    await this.prisma.messageLog.update({
      where: { id: log.id },
      data: { status: 'SENT', providerRef: result.providerRef, creditsCharged },
    });
    return { status: 'SENT', channel, logId: log.id, errorCode: null };
  }

  // -- Panel reads and settings ------------------------------------------------------

  async wallets(restaurantId: string): Promise<MessageWalletDTO[]> {
    const rows = await this.prisma.messageWallet.findMany({
      where: { restaurantId, channel: { in: [...CREDIT_CHANNELS] } },
      select: { channel: true, balance: true },
    });
    return CREDIT_CHANNELS.map((channel) => ({
      channel,
      balance: rows.find((r) => r.channel === channel)?.balance ?? 0,
    }));
  }

  async packages(currency: string): Promise<MessageCreditPackageDTO[]> {
    const rows = await this.prisma.messageCreditPackage.findMany({
      where: { isActive: true, currency, channel: { in: [...CREDIT_CHANNELS] } },
      orderBy: [{ channel: 'asc' }, { credits: 'asc' }],
      select: { code: true, channel: true, credits: true, priceMinor: true, currency: true },
    });
    return rows.map((r) => ({ ...r, channel: r.channel as CreditChannel }));
  }

  async recent(restaurantId: string, limit = 50): Promise<MessageLogDTO[]> {
    const rows = await this.prisma.messageLog.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        channel: true,
        toMasked: true,
        templateKey: true,
        status: true,
        provider: true,
        creditsCharged: true,
        errorCode: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async settingsOf(restaurantId: string): Promise<NotificationSettings> {
    const row = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { notificationSettings: true },
    });
    return notificationSettingsFrom(row.notificationSettings);
  }

  async updateSettings(restaurantId: string, input: NotificationSettings): Promise<NotificationSettings> {
    const settings = NotificationSettingsSchema.parse(input);
    await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { notificationSettings: settings as Prisma.InputJsonObject },
    });
    return settings;
  }

  async overview(restaurantId: string): Promise<MessagingOverviewDTO> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true, notificationSettings: true },
    });
    const [wallets, packages, recent] = await Promise.all([
      this.wallets(restaurantId),
      this.packages(restaurant.currency),
      this.recent(restaurantId),
    ]);
    return { wallets, packages, recent, settings: notificationSettingsFrom(restaurant.notificationSettings) };
  }

  /** Credits bought or granted; the transaction keeps the balance after the move (docs/FIYATLANDIRMA.md). */
  async grant(
    restaurantId: string,
    channel: CreditChannel,
    credits: number,
    type: 'PURCHASE' | 'GRANT',
    reference: string,
  ): Promise<MessageWalletDTO[]> {
    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.messageWallet.upsert({
        where: { restaurantId_channel: { restaurantId, channel } },
        update: { balance: { increment: credits } },
        create: { restaurantId, channel, balance: credits },
        select: { id: true, balance: true },
      });
      await tx.messageTransaction.create({
        data: { walletId: wallet.id, type, delta: credits, balanceAfter: wallet.balance, reference },
      });
    });
    return this.wallets(restaurantId);
  }
}
