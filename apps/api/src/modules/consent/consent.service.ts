import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@resget/database';
import {
  CONSENT_CHANNELS,
  CONSENT_CONFIRMATION_DAYS,
  DEFAULT_CONSENT_POLICY,
  LEGACY_CHECKBOX_CHANNELS,
  MERCHANT_EXEMPTION_CHANNELS,
  consentRegionOf,
  countryOfPhone,
  effectiveConsentChannels,
  evaluateCommercialEligibility,
  frequencyCapReached,
  needsDoubleOptIn,
  registryCovers,
} from '@resget/shared';
import type {
  CheckoutConsentChannel,
  ConsentChannel,
  ConsentConfirmResultDTO,
  ConsentEntryDTO,
  ConsentPolicy,
  ConsentRegion,
  ConsentRegistryAdapter,
  ConsentSettingsDTO,
  ConsentSource,
  ConsentState,
  ContactConsentDTO,
  IneligibleReason,
  LegalBasis,
  UpdateConsentLimitsInput,
  UpdateConsentPolicyInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { MessagingService } from '../messaging/messaging.service';
import { CONSENT_REGISTRY } from '../campaigns/consent-registry';
import { notFound } from '../../common/api-error';

const DAY_MS = 86_400_000;
const HISTORY_LIMIT = 50;
const SYNC_BATCH = 200;

type ConsentRow = Prisma.ContactConsentGetPayload<object>;

export interface GrantInput {
  restaurantId: string;
  customerId: string;
  channels: readonly ConsentChannel[];
  source: ConsentSource;
  formVersion?: string | null;
}

export type RecipientCheck = IneligibleReason | 'FREQUENCY_CAP' | null;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Commercial message consent (docs/RIZA.md). The history is append-only;
 * every write recomputes the contact's reachable channels so audiences are
 * one indexed query, and the send path re-checks the fresh history anyway.
 * With the consent_v2 module off, checkout consent is the legacy box (both
 * channels), there is no double opt-in and no frequency cap: the behaviour
 * the restaurant had before.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
    @Inject(CONSENT_REGISTRY) private readonly registry: ConsentRegistryAdapter,
  ) {}

  enabled(restaurantId: string): Promise<boolean> {
    return this.features.isEnabled('consent_v2', restaurantId);
  }

  async policy(restaurantId: string): Promise<ConsentPolicy> {
    const row = await this.prisma.marketingSettings.findUnique({ where: { restaurantId } });
    if (!row) return DEFAULT_CONSENT_POLICY;
    return {
      dailyCap: row.dailyCap,
      weeklyCap: row.weeklyCap,
      doubleOptInRegions: row.doubleOptInRegions.filter((r): r is ConsentRegion =>
        (['EU_UK', 'TR', 'NANP', 'OTHER'] as const).includes(r as ConsentRegion),
      ),
      merchantExemption: row.merchantExemption,
    };
  }

  /** The region of a contact for the rules: the country of their phone number. */
  regionOfPhone(phone: string): ConsentRegion {
    return consentRegionOf(countryOfPhone(phone));
  }

  private async latestStates(customerId: string): Promise<Partial<Record<ConsentChannel, ConsentRow>>> {
    const rows = await this.prisma.contactConsent.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT * 4,
    });
    const latest: Partial<Record<ConsentChannel, ConsentRow>> = {};
    for (const row of rows) {
      const channel = row.channel as ConsentChannel;
      if (!latest[channel]) latest[channel] = row;
    }
    return latest;
  }

  private toState(row: ConsentRow | undefined): ConsentState | null {
    if (!row) return null;
    return {
      granted: row.granted,
      legalBasis: row.legalBasis as LegalBasis,
      confirmationRequestedAt: row.confirmationRequestedAt,
      confirmedAt: row.confirmedAt,
    };
  }

  /** Recomputes the channels a campaign may reach and the aggregate opt-in flag older screens read. */
  async recompute(customerId: string, policy?: ConsentPolicy): Promise<ConsentChannel[]> {
    const customer = await this.prisma.restaurantCustomer.findUniqueOrThrow({
      where: { id: customerId },
      select: { restaurantId: true, isBusiness: true, user: { select: { phone: true } } },
    });
    const effectivePolicy = policy ?? (await this.policy(customer.restaurantId));
    const latest = await this.latestStates(customerId);
    const states: Partial<Record<ConsentChannel, ConsentState>> = {};
    for (const channel of CONSENT_CHANNELS) {
      const state = this.toState(latest[channel]);
      if (state) states[channel] = state;
    }
    const channels = effectiveConsentChannels(states, {
      region: this.regionOfPhone(customer.user.phone),
      isBusiness: customer.isBusiness,
      policy: effectivePolicy,
    });
    await this.prisma.restaurantCustomer.update({
      where: { id: customerId },
      data: { consentChannels: channels, marketingOptIn: channels.length > 0 },
    });
    return channels;
  }

  // -- Writing -------------------------------------------------------------------------

  /**
   * The customer's own yes (checkout box, site form). A channel already
   * granted and counting is left alone, so every order does not add a row.
   * With the module on, a number from a double opt-in region waits for its
   * confirmation link, sent once for all the new channels.
   */
  async grant(input: GrantInput): Promise<void> {
    if (input.channels.length === 0) return;
    const customer = await this.prisma.restaurantCustomer.findUnique({
      where: { id: input.customerId },
      select: {
        restaurantId: true,
        marketingOptInAt: true,
        user: { select: { phone: true, locale: true } },
        restaurant: { select: { name: true, defaultLocale: true } },
      },
    });
    if (!customer || customer.restaurantId !== input.restaurantId) return;
    const enabled = await this.enabled(input.restaurantId);
    const policy = await this.policy(input.restaurantId);
    const region = this.regionOfPhone(customer.user.phone);
    const latest = await this.latestStates(input.customerId);
    const fresh = input.channels.filter((channel) => {
      const state = latest[channel];
      return !(state?.granted && state.legalBasis === 'CONSENT');
    });
    if (fresh.length === 0) return;
    const pending = enabled && needsDoubleOptIn(region, policy);
    const now = new Date();
    await this.prisma.contactConsent.createMany({
      data: fresh.map((channel) => ({
        restaurantId: input.restaurantId,
        customerId: input.customerId,
        channel,
        granted: true,
        legalBasis: 'CONSENT',
        source: input.source,
        formVersion: input.formVersion ?? null,
        confirmationRequestedAt: pending ? now : null,
        createdAt: now,
      })),
    });
    if (!customer.marketingOptInAt) {
      await this.prisma.restaurantCustomer.update({
        where: { id: input.customerId },
        data: { marketingOptInAt: now, marketingOptOutAt: null },
      });
    }
    await this.recompute(input.customerId, policy);
    if (pending) {
      await this.sendConfirmation(input.restaurantId, input.customerId, customer.user.phone, {
        restaurant: customer.restaurant.name,
        locale: customer.user.locale ?? customer.restaurant.defaultLocale,
      });
    } else {
      await this.syncCustomer(input.customerId);
    }
  }

  /** The legacy box or the per-channel boxes at checkout, whichever the module allows. */
  async grantFromCheckout(
    restaurantId: string,
    customerId: string,
    legacyOptIn: boolean | undefined,
    channels: readonly CheckoutConsentChannel[] | undefined,
  ): Promise<void> {
    const enabled = await this.enabled(restaurantId);
    const chosen: readonly ConsentChannel[] =
      enabled && channels !== undefined ? channels : legacyOptIn ? LEGACY_CHECKBOX_CHANNELS : [];
    await this.grant({ restaurantId, customerId, channels: chosen, source: 'ORDER_CHECKBOX' });
  }

  /**
   * A refusal on the given channels (all of them for the opt-out link). It is
   * written even where there was no decision, so no later rule (such as the
   * merchant exemption) can reach the contact again on that channel.
   */
  async revoke(
    customerId: string,
    channels: readonly ConsentChannel[],
    source: ConsentSource,
    meta: { note?: string | null; actorUserId?: string | null } = {},
  ): Promise<void> {
    const customer = await this.prisma.restaurantCustomer.findUnique({
      where: { id: customerId },
      select: { restaurantId: true },
    });
    if (!customer) return;
    const latest = await this.latestStates(customerId);
    const now = new Date();
    const changed = channels.filter((channel) => latest[channel]?.granted !== false);
    if (changed.length > 0) {
      await this.prisma.contactConsent.createMany({
        data: changed.map((channel) => ({
          restaurantId: customer.restaurantId,
          customerId,
          channel,
          granted: false,
          legalBasis: latest[channel]?.legalBasis ?? 'CONSENT',
          source,
          note: meta.note ?? null,
          actorUserId: meta.actorUserId ?? null,
          createdAt: now,
        })),
      });
    }
    await this.prisma.restaurantCustomer.update({ where: { id: customerId }, data: { marketingOptOutAt: now } });
    await this.recompute(customerId);
    await this.syncCustomer(customerId);
  }

  async setBusiness(restaurantId: string, customerId: string, isBusiness: boolean): Promise<ContactConsentDTO> {
    await this.requireCustomer(restaurantId, customerId);
    await this.prisma.restaurantCustomer.update({ where: { id: customerId }, data: { isBusiness } });
    const policy = await this.policy(restaurantId);
    await this.applyExemption(customerId, policy);
    await this.recompute(customerId, policy);
    await this.syncCustomer(customerId);
    return this.contactConsent(restaurantId, customerId);
  }

  /**
   * The merchant exemption is written down, not only inferred: a business
   * contact in Turkey gets a TR_MERCHANT_EXEMPTION row on each IYS channel
   * without a decision, so it can be registered with IYS as a merchant before
   * any message. An existing decision, a refusal above all, is never
   * overwritten. With the switch off these rows simply stop counting.
   */
  private async applyExemption(customerId: string, policy: ConsentPolicy): Promise<void> {
    if (!policy.merchantExemption) return;
    const customer = await this.prisma.restaurantCustomer.findUnique({
      where: { id: customerId },
      select: { restaurantId: true, isBusiness: true, user: { select: { phone: true } } },
    });
    if (!customer?.isBusiness || this.regionOfPhone(customer.user.phone) !== 'TR') return;
    const latest = await this.latestStates(customerId);
    const missing = MERCHANT_EXEMPTION_CHANNELS.filter((channel) => !latest[channel]);
    if (missing.length === 0) return;
    await this.prisma.contactConsent.createMany({
      data: missing.map((channel) => ({
        restaurantId: customer.restaurantId,
        customerId,
        channel,
        granted: true,
        legalBasis: 'TR_MERCHANT_EXEMPTION',
        source: 'MERCHANT_EXEMPTION',
      })),
    });
  }

  async staffOptOut(
    restaurantId: string,
    customerId: string,
    channels: readonly ConsentChannel[],
    note: string,
    actorUserId: string,
  ): Promise<ContactConsentDTO> {
    await this.requireCustomer(restaurantId, customerId);
    await this.revoke(customerId, channels, 'STAFF_OPT_OUT', { note, actorUserId });
    return this.contactConsent(restaurantId, customerId);
  }

  // -- Double opt-in -------------------------------------------------------------------

  private async sendConfirmation(
    restaurantId: string,
    customerId: string,
    phone: string,
    context: { restaurant: string; locale: string },
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.consentConfirmation.create({
      data: {
        restaurantId,
        customerId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + CONSENT_CONFIRMATION_DAYS * DAY_MS),
      },
    });
    const url = `${this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/+$/, '')}/onay/${token}`;
    // Platform traffic, like the OTP: the restaurant pays nothing for the law asking twice.
    const result = await this.messaging.send({
      restaurantId,
      channel: 'SMS',
      to: phone,
      templateKey: 'consent.confirm',
      params: { restaurant: context.restaurant, url },
      locale: context.locale,
      billable: false,
    });
    if (result.status !== 'SENT')
      this.logger.warn(`consent confirmation for ${customerId} failed: ${result.errorCode}`);
  }

  /**
   * Following the link confirms every pending consent of the contact. Single
   * use; the page posts here only when the person presses the button, so a
   * link preview never confirms anything. Nothing about the device is kept.
   */
  async confirm(token: string): Promise<ConsentConfirmResultDTO> {
    const now = new Date();
    const row = await this.prisma.consentConfirmation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, customerId: true, expiresAt: true, usedAt: true, restaurant: { select: { name: true } } },
    });
    if (!row || row.usedAt || row.expiresAt <= now) return { status: 'INVALID' };
    const claimed = await this.prisma.consentConfirmation.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return { status: 'INVALID' };
    await this.prisma.contactConsent.updateMany({
      where: { customerId: row.customerId, granted: true, confirmationRequestedAt: { not: null }, confirmedAt: null },
      data: { confirmedAt: now },
    });
    await this.recompute(row.customerId);
    await this.syncCustomer(row.customerId);
    return { status: 'CONFIRMED', restaurantName: row.restaurant.name };
  }

  // -- Registry ------------------------------------------------------------------------

  /**
   * Registers the contact's unsynced decisions with the regional registry:
   * covered channels only, confirmed grants and every refusal. A failure is
   * retried by the watchdog.
   */
  async syncCustomer(customerId: string): Promise<number> {
    const customer = await this.prisma.restaurantCustomer.findUnique({
      where: { id: customerId },
      select: {
        restaurantId: true,
        isBusiness: true,
        restaurant: { select: { countryCode: true } },
        user: { select: { phone: true } },
      },
    });
    if (!customer) return 0;
    const rows = await this.prisma.contactConsent.findMany({
      where: { customerId, registrySyncedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    let synced = 0;
    for (const row of rows) {
      const channel = row.channel as ConsentChannel;
      if (!registryCovers(customer.restaurant.countryCode, channel)) continue;
      if (row.granted && row.confirmationRequestedAt && !row.confirmedAt) continue;
      try {
        await this.registry.record({
          restaurantId: customer.restaurantId,
          countryCode: customer.restaurant.countryCode,
          channel,
          phone: customer.user.phone,
          granted: row.granted,
          recipientType: row.legalBasis === 'TR_MERCHANT_EXEMPTION' ? 'MERCHANT' : 'INDIVIDUAL',
          at: row.confirmedAt ?? row.createdAt,
        });
        await this.prisma.contactConsent.update({ where: { id: row.id }, data: { registrySyncedAt: new Date() } });
        synced += 1;
      } catch (error) {
        this.logger.warn(`registry sync of consent ${row.id} failed: ${String(error)}`);
        break;
      }
    }
    return synced;
  }

  /** The watchdog's pass: contacts with decisions still waiting for the registry. */
  async syncPending(): Promise<number> {
    const waiting = await this.prisma.contactConsent.findMany({
      where: { registrySyncedAt: null, channel: { in: ['SMS', 'CALL', 'EMAIL'] } },
      distinct: ['customerId'],
      select: { customerId: true },
      take: SYNC_BATCH,
    });
    let synced = 0;
    for (const { customerId } of waiting) synced += await this.syncCustomer(customerId);
    return synced;
  }

  // -- Sending -------------------------------------------------------------------------

  /**
   * The send-time check for a batch of campaign recipients on one channel:
   * fresh consent state per contact and, with the module on, the tenant's
   * frequency caps. Null means the message may go.
   */
  async checkRecipients(
    restaurantId: string,
    channel: ConsentChannel,
    customerIds: readonly string[],
    now: Date = new Date(),
  ): Promise<Map<string, RecipientCheck>> {
    const result = new Map<string, RecipientCheck>();
    if (customerIds.length === 0) return result;
    const [enabled, policy] = await Promise.all([this.enabled(restaurantId), this.policy(restaurantId)]);
    const [customers, rows] = await Promise.all([
      this.prisma.restaurantCustomer.findMany({
        where: { id: { in: [...customerIds] }, restaurantId },
        select: { id: true, isBusiness: true, user: { select: { phone: true } } },
      }),
      this.prisma.contactConsent.findMany({
        where: { customerId: { in: [...customerIds] }, channel },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const latest = new Map<string, ConsentRow>();
    for (const row of rows) if (!latest.has(row.customerId)) latest.set(row.customerId, row);
    const sentDay = new Map<string, number>();
    const sentWeek = new Map<string, number>();
    if (enabled) {
      const sent = await this.prisma.campaignRecipient.findMany({
        where: {
          customerId: { in: [...customerIds] },
          status: 'SENT',
          sentAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
        },
        select: { customerId: true, sentAt: true },
      });
      for (const s of sent) {
        sentWeek.set(s.customerId, (sentWeek.get(s.customerId) ?? 0) + 1);
        if (s.sentAt && s.sentAt.getTime() >= now.getTime() - DAY_MS)
          sentDay.set(s.customerId, (sentDay.get(s.customerId) ?? 0) + 1);
      }
    }
    for (const customer of customers) {
      const eligibility = evaluateCommercialEligibility({
        channel,
        region: this.regionOfPhone(customer.user.phone),
        state: this.toState(latest.get(customer.id)),
        isBusiness: customer.isBusiness,
        policy,
      });
      if (!eligibility.eligible) {
        result.set(customer.id, eligibility.reason);
        continue;
      }
      if (enabled && frequencyCapReached(sentDay.get(customer.id) ?? 0, sentWeek.get(customer.id) ?? 0, policy)) {
        result.set(customer.id, 'FREQUENCY_CAP');
        continue;
      }
      result.set(customer.id, null);
    }
    for (const id of customerIds) if (!result.has(id)) result.set(id, 'NO_CONSENT');
    return result;
  }

  // -- Reading and settings ------------------------------------------------------------

  private async requireCustomer(restaurantId: string, customerId: string): Promise<void> {
    const row = await this.prisma.restaurantCustomer.findFirst({
      where: { id: customerId, restaurantId },
      select: { id: true },
    });
    if (!row) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
  }

  private toEntry(row: ConsentRow): ConsentEntryDTO {
    return {
      channel: row.channel as ConsentChannel,
      granted: row.granted,
      legalBasis: row.legalBasis as LegalBasis,
      source: row.source as ConsentSource,
      note: row.note,
      formVersion: row.formVersion,
      confirmationRequestedAt: row.confirmationRequestedAt?.toISOString() ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      registrySyncedAt: row.registrySyncedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async contactConsent(restaurantId: string, customerId: string): Promise<ContactConsentDTO> {
    await this.requireCustomer(restaurantId, customerId);
    const [customer, history, enabled] = await Promise.all([
      this.prisma.restaurantCustomer.findUniqueOrThrow({
        where: { id: customerId },
        select: { isBusiness: true, consentChannels: true, user: { select: { phone: true } } },
      }),
      this.prisma.contactConsent.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
      this.enabled(restaurantId),
    ]);
    const seen = new Set<string>();
    const current = history.filter((row) => {
      if (seen.has(row.channel)) return false;
      seen.add(row.channel);
      return true;
    });
    return {
      enabled,
      region: this.regionOfPhone(customer.user.phone),
      isBusiness: customer.isBusiness,
      effective: customer.consentChannels as ConsentChannel[],
      current: current.map((row) => this.toEntry(row)),
      history: history.map((row) => this.toEntry(row)),
    };
  }

  async settings(restaurantId: string): Promise<ConsentSettingsDTO> {
    const [enabled, policy] = await Promise.all([this.enabled(restaurantId), this.policy(restaurantId)]);
    return { enabled, policy };
  }

  async updateLimits(restaurantId: string, input: UpdateConsentLimitsInput): Promise<ConsentSettingsDTO> {
    await this.prisma.marketingSettings.upsert({
      where: { restaurantId },
      create: { restaurantId, ...input, doubleOptInRegions: [...DEFAULT_CONSENT_POLICY.doubleOptInRegions] },
      update: input,
    });
    return this.settings(restaurantId);
  }

  /** The platform owner's switches; turning the exemption on or off recomputes the tenant's business contacts. */
  async updatePolicy(restaurantId: string, input: UpdateConsentPolicyInput): Promise<ConsentSettingsDTO> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } });
    if (!restaurant) throw notFound('NOT_FOUND', 'Restaurant not found');
    await this.prisma.marketingSettings.upsert({
      where: { restaurantId },
      create: {
        restaurantId,
        dailyCap: DEFAULT_CONSENT_POLICY.dailyCap,
        weeklyCap: DEFAULT_CONSENT_POLICY.weeklyCap,
        doubleOptInRegions: input.doubleOptInRegions,
        merchantExemption: input.merchantExemption,
      },
      update: { doubleOptInRegions: input.doubleOptInRegions, merchantExemption: input.merchantExemption },
    });
    const policy = await this.policy(restaurantId);
    const business = await this.prisma.restaurantCustomer.findMany({
      where: { restaurantId, isBusiness: true },
      select: { id: true },
    });
    for (const { id } of business) {
      await this.applyExemption(id, policy);
      await this.recompute(id, policy);
      await this.syncCustomer(id);
    }
    return this.settings(restaurantId);
  }
}
