import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PROVIDER_BALANCE_WARN } from '@resget/shared';
import type { ProviderBalanceDTO } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from './sms.provider';
import type { SmsProvider } from './sms.provider';
import { WHATSAPP_PROVIDER } from './whatsapp.provider';
import type { WhatsAppProvider } from './whatsapp.provider';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Hourly look at the messaging providers' remaining credits (docs/MESAJLASMA.md).
 * A balance under PROVIDER_BALANCE_WARN is logged as an error and written to
 * the audit log once a day per channel, so the console shows it and the owner
 * tops up before customers stop getting their messages. Off in tests.
 */
@Injectable()
export class ProviderBalanceMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderBalanceMonitor.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly last = new Map<string, ProviderBalanceDTO>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.check(), HOUR_MS);
    this.timer.unref();
    const first = setTimeout(() => void this.check(), 30_000);
    first.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Reads both balances now; the console calls this on open, the timer every hour. */
  async check(now: Date = new Date()): Promise<{ sms: ProviderBalanceDTO; whatsapp: ProviderBalanceDTO }> {
    const [sms, whatsapp] = await Promise.all([
      this.read('SMS', this.sms, now),
      this.read('WHATSAPP', this.whatsapp, now),
    ]);
    return { sms, whatsapp };
  }

  private async read(
    channel: 'SMS' | 'WHATSAPP',
    provider: SmsProvider | WhatsAppProvider,
    now: Date,
  ): Promise<ProviderBalanceDTO> {
    let balance: number | null = null;
    if (provider.balance) {
      try {
        balance = await provider.balance();
      } catch (error) {
        this.logger.warn(`${channel} balance check failed: ${error instanceof Error ? error.message : 'error'}`);
      }
    }
    const result: ProviderBalanceDTO = {
      code: provider.code,
      balance,
      low: balance !== null && balance < PROVIDER_BALANCE_WARN,
      checkedAt: now.toISOString(),
    };
    this.last.set(channel, result);
    if (result.low) await this.warnOnce(channel, provider.code, balance ?? 0, now);
    return result;
  }

  private async warnOnce(channel: string, code: string, balance: number, now: Date): Promise<void> {
    this.logger.error(`${channel} provider ${code} balance is low: ${balance} (threshold ${PROVIDER_BALANCE_WARN})`);
    const recent = await this.prisma.auditLog.findFirst({
      where: {
        action: 'provider.balance_low',
        entityId: channel,
        createdAt: { gte: new Date(now.getTime() - DAY_MS) },
      },
      select: { id: true },
    });
    if (recent) return;
    await this.prisma.auditLog.create({
      data: { action: 'provider.balance_low', entity: 'message_provider', entityId: channel, meta: { code, balance } },
    });
  }
}
