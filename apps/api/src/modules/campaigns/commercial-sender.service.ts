import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { extractEmailLinks, registryCovers } from '@resget/shared';
import type {
  CampaignChannel,
  ConsentRegistryAdapter,
  EmailTracking,
  FeatureKey,
  NotificationChannel,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { ConsentService } from '../consent/consent.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { EmailService } from '../email/email.service';
import { CONSENT_REGISTRY } from './consent-registry';

/** One contact as the sender needs it. */
export interface CommercialRecipient {
  customerId: string;
  phone: string;
  /** The contact card's address, else the account's. */
  email: string | null;
  locale: string | null;
  marketingToken: string | null;
}

export interface CommercialDelivery {
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  errorCode: string | null;
  logId: string | null;
}

/**
 * Every commercial message of a tenant, whether a campaign or an automated
 * flow, goes through here (docs/KAMPANYALAR.md, docs/AKISLAR.md): the
 * effective channel, fresh consent and caps (docs/RIZA.md), the regional
 * registry for the channels it covers, an address on the channel, then the
 * messaging engine (credits, debited only when sent) or the email channel
 * (never charged, one-click unsubscribe).
 */
@Injectable()
export class CommercialSenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messaging: MessagingService,
    private readonly consent: ConsentService,
    private readonly features: FeatureFlagsService,
    private readonly email: EmailService,
    @Inject(CONSENT_REGISTRY) private readonly registry: ConsentRegistryAdapter,
  ) {}

  /**
   * The channel a message actually goes out on: with the WhatsApp module off
   * the engine sends SMS, so consent, audience and registry are checked for
   * SMS too; a WhatsApp-only consent never turns into an SMS.
   */
  async effectiveChannel(restaurantId: string, channel: CampaignChannel): Promise<CampaignChannel> {
    if (channel === 'WHATSAPP' && !(await this.features.isEnabled('whatsapp_channel', restaurantId))) return 'SMS';
    return channel;
  }

  /** Why email cannot go out now (the given modules must be on and a domain verified), or null when it can. */
  async emailBlocker(
    restaurantId: string,
    modules: readonly FeatureKey[],
  ): Promise<'FEATURE_DISABLED' | 'EMAIL_DOMAIN_NOT_VERIFIED' | null> {
    const enabled = await Promise.all(
      ['email_channel' as const, ...modules].map((key) => this.features.isEnabled(key, restaurantId)),
    );
    if (enabled.some((on) => !on)) return 'FEATURE_DISABLED';
    const verified = await this.prisma.emailDomain.count({ where: { restaurantId, status: 'VERIFIED' } });
    return verified > 0 ? null : 'EMAIL_DOMAIN_NOT_VERIFIED';
  }

  /** The address a channel reaches a contact at, and the registry knows them by. */
  addressOf(channel: CampaignChannel, recipient: CommercialRecipient): string | null {
    return channel === 'EMAIL' ? recipient.email : recipient.phone;
  }

  /**
   * For each contact: null when a message may go out now, otherwise why not
   * (NO_EMAIL, a consent reason, FREQUENCY_CAP or CONSENT_REGISTRY).
   */
  async check(
    restaurantId: string,
    countryCode: string,
    channel: CampaignChannel,
    recipients: readonly CommercialRecipient[],
    now: Date,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (recipients.length === 0) return result;
    const checks = await this.consent.checkRecipients(
      restaurantId,
      channel,
      recipients.map((r) => r.customerId),
      now,
    );
    const eligible = recipients
      .filter((r) => checks.get(r.customerId) === null)
      .map((r) => this.addressOf(channel, r))
      .filter((a): a is string => a !== null);
    // Only channels the country's registry keeps are checked there (IYS: SMS, calls, e-mail; not WhatsApp yet).
    const allowed = registryCovers(countryCode, channel)
      ? await this.registry.allowed(countryCode, channel, eligible)
      : new Set(eligible);
    for (const recipient of recipients) {
      const address = this.addressOf(channel, recipient);
      const refusal = checks.get(recipient.customerId) ?? null;
      if (address === null) result.set(recipient.customerId, 'NO_EMAIL');
      else if (refusal !== null) result.set(recipient.customerId, refusal);
      else if (!allowed.has(address)) result.set(recipient.customerId, 'CONSENT_REGISTRY');
      else result.set(recipient.customerId, null);
    }
    return result;
  }

  /** Sends one already checked message. INSUFFICIENT_CREDITS comes back as FAILED with that code. */
  async deliver(input: {
    restaurantId: string;
    restaurantName: string;
    defaultLocale: string;
    channel: CampaignChannel;
    recipient: CommercialRecipient;
    body: string;
    subject: string | null;
    /** Email only: the recipient's tracking token when open and click tracking is on (docs/EPOSTA.md). */
    trackingToken?: string | null;
  }): Promise<CommercialDelivery> {
    const { recipient } = input;
    const token = recipient.marketingToken ?? (await this.ensureToken(recipient.customerId));
    const locale = recipient.locale ?? input.defaultLocale;
    if (input.channel === 'EMAIL') {
      if (!recipient.email) return { status: 'SKIPPED', errorCode: 'NO_EMAIL', logId: null };
      const mail = await this.email.send({
        restaurantId: input.restaurantId,
        to: recipient.email,
        kind: 'COMMERCIAL',
        templateKey: 'campaign',
        params: { subject: input.subject ?? '', body: input.body },
        locale,
        customerId: recipient.customerId,
        unsubscribeUrl: this.unsubscribeUrl(token),
        ...(input.trackingToken ? { tracking: this.trackingFor(input.trackingToken, input.body) } : {}),
      });
      return {
        status: mail.status,
        errorCode: mail.status === 'SENT' ? null : (mail.errorCode ?? 'FAILED'),
        logId: mail.logId,
      };
    }
    const result = await this.messaging.send({
      restaurantId: input.restaurantId,
      channel: input.channel as NotificationChannel,
      to: recipient.phone,
      templateKey: 'campaign.body',
      params: { restaurant: input.restaurantName, body: input.body, url: this.optOutUrl(token) },
      locale,
      billable: true,
      fallbackToSms: false,
    });
    if (result.status === 'SENT') return { status: 'SENT', errorCode: null, logId: result.logId };
    return { status: 'FAILED', errorCode: result.errorCode ?? 'FAILED', logId: result.logId };
  }

  /** The open image and the tracked links of one campaign email; the links are the campaign text's own. */
  trackingFor(trackingToken: string, body: string): EmailTracking {
    const api = this.config.getOrThrow<string>('PUBLIC_API_URL').replace(/\/+$/, '');
    return {
      openUrl: `${api}/public/email/o/${trackingToken}`,
      clickUrl: (index) => `${api}/public/email/c/${trackingToken}/${index}`,
      links: extractEmailLinks(body),
    };
  }

  optOutUrl(token: string): string {
    return `${this.publicUrl()}/iptal/${token}`;
  }

  /** The List-Unsubscribe address: a one-click POST opts out (RFC 8058), opening it shows the opt-out page. */
  unsubscribeUrl(token: string): string {
    return `${this.publicUrl()}/api/iptal/${token}`;
  }

  publicUrl(): string {
    return this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/+$/, '');
  }

  private async ensureToken(customerId: string): Promise<string> {
    const token = randomUUID();
    await this.prisma.restaurantCustomer.update({ where: { id: customerId }, data: { marketingToken: token } });
    return token;
  }
}
