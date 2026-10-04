import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Prisma } from '@resget/database';
import {
  AD_CLICK_ID_KEYS,
  AD_CONNECTION_PLATFORMS,
  AD_CREDENTIAL_FIELDS,
  AD_DELIVERY_MAX_ATTEMPTS,
  AD_SPEND_LOOKBACK_DAYS,
  AD_SPEND_SYNC_HOURS,
  CONVERSION_TYPES,
  PLATFORM_CONVERSION_TYPES,
  RESTAURANT_CONVERSION_TYPES,
  adCredentialIssues,
  minorDigitsOf,
} from '@resget/shared';
import type {
  AdConnectionDTO,
  AdConnectionPlatform,
  AdPerformanceDTO,
  AdPerformanceRowDTO,
  ConnectAdInput,
  ConversionType,
  UpdateAdConnectionInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
import { badRequest, notFound } from '../../common/api-error';
import { MockAdsAdapter } from './ads.adapter';
import type { AdConversionPayload, AdPlatformAdapter } from './ads.adapter';
import { MetaAdsAdapter } from './meta.adapter';
import { GoogleAdsAdapter } from './google.adapter';
import { TikTokAdsAdapter } from './tiktok.adapter';

type ConnectionRow = Prisma.AdConnectionGetPayload<object>;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Meta and TikTok take events up to seven days old; older pending conversions are dropped. */
const MAX_EVENT_AGE_DAYS = 7;
const BATCH = 100;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Ad platform integrations (docs/REKLAM.md). A recorded conversion is queued
 * for every active connection whose types include it; the runner sends it
 * only when the visit it came from carried advertising consent, with the
 * click id of that platform (Google always needs one), and hashed phone and
 * e-mail only when the tenant switched enhanced matching on. Credentials are
 * encrypted at rest and never leave in a response.
 */
@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);
  private readonly adapters = new Map<AdConnectionPlatform, AdPlatformAdapter>();
  private readonly cipher: CredentialCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    config: ConfigService,
  ) {
    this.cipher = new CredentialCipher(
      new EnvKeyProvider(config.get<string>('CREDENTIAL_ENCRYPTION_KEY') ?? DEV_CREDENTIAL_KEY),
    );
    const production = config.get<string>('NODE_ENV') === 'production';
    if (config.get<string>('ADS_PROVIDER') === 'LIVE') {
      this.adapters.set('META', new MetaAdsAdapter());
      this.adapters.set('TIKTOK', new TikTokAdsAdapter());
      this.adapters.set(
        'GOOGLE',
        new GoogleAdsAdapter({
          clientId: config.get<string>('GOOGLE_ADS_CLIENT_ID'),
          clientSecret: config.get<string>('GOOGLE_ADS_CLIENT_SECRET'),
          developerToken: config.get<string>('GOOGLE_ADS_DEVELOPER_TOKEN'),
        }),
      );
    } else {
      for (const platform of AD_CONNECTION_PLATFORMS)
        this.adapters.set(platform, new MockAdsAdapter(platform, production));
    }
  }

  /** The adapter for a platform (tests read the mock's record from here). */
  adapter(platform: AdConnectionPlatform): AdPlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`no ad adapter for ${platform}`);
    return adapter;
  }

  private credentialsOf(row: ConnectionRow): Record<string, string> {
    return this.cipher.decryptJson(row.encryptedCredentials);
  }

  // -- Connections --------------------------------------------------------------------

  async list(restaurantId: string): Promise<AdConnectionDTO[]> {
    const rows = await this.prisma.adConnection.findMany({ where: { restaurantId }, orderBy: { platform: 'asc' } });
    const grouped = rows.length
      ? await this.prisma.adConversionDelivery.groupBy({
          by: ['connectionId', 'status'],
          where: { connectionId: { in: rows.map((r) => r.id) } },
          _count: { _all: true },
        })
      : [];
    return rows.map((row) => {
      const count = (status: string) =>
        grouped.find((g) => g.connectionId === row.id && g.status === status)?._count._all ?? 0;
      return this.toDto(row, {
        pending: count('PENDING'),
        sent: count('SENT'),
        skipped: count('SKIPPED'),
        failed: count('FAILED'),
      });
    });
  }

  /**
   * Connects or updates an account. A secret left out keeps the stored one,
   * so a pixel id can change without pasting the token again. The platform
   * must accept the credentials before they are saved.
   */
  async connect(restaurantId: string, platform: AdConnectionPlatform, input: ConnectAdInput): Promise<AdConnectionDTO> {
    const existing = await this.prisma.adConnection.findUnique({
      where: { restaurantId_platform: { restaurantId, platform } },
    });
    const merged: Record<string, string> = { ...(existing ? this.credentialsOf(existing) : {}) };
    for (const [key, value] of Object.entries(input.credentials)) merged[key] = value.trim();
    const issues = adCredentialIssues(platform, merged);
    if (issues.length) throw badRequest('AD_CREDENTIALS_INVALID', `Credentials: ${issues.join(', ')}`);
    const check = await this.adapter(platform).verify(merged);
    if (!check.ok)
      throw badRequest('AD_CREDENTIALS_REFUSED', `The platform refused the credentials: ${check.errorCode}`);

    const fields = AD_CREDENTIAL_FIELDS[platform];
    const publicConfig = Object.fromEntries(
      fields.filter((f) => !f.secret && merged[f.key]).map((f) => [f.key, merged[f.key]]),
    );
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { isPlatform: true },
    });
    const defaults: readonly ConversionType[] = restaurant.isPlatform
      ? PLATFORM_CONVERSION_TYPES
      : RESTAURANT_CONVERSION_TYPES;
    const data = {
      encryptedCredentials: this.cipher.encryptJson(merged),
      keyVersion: this.cipher.keyVersion,
      publicConfig,
      status: 'ACTIVE',
      lastError: null,
      ...(input.sendTypes ? { sendTypes: input.sendTypes } : {}),
      ...(input.enhancedMatching !== undefined ? { enhancedMatching: input.enhancedMatching } : {}),
    };
    const row = existing
      ? await this.prisma.adConnection.update({ where: { id: existing.id }, data })
      : await this.prisma.adConnection.create({
          data: { restaurantId, platform, sendTypes: input.sendTypes ?? [...defaults], ...data },
        });
    return (await this.list(restaurantId)).find((c) => c.platform === row.platform) as AdConnectionDTO;
  }

  async update(
    restaurantId: string,
    platform: AdConnectionPlatform,
    input: UpdateAdConnectionInput,
  ): Promise<AdConnectionDTO> {
    const row = await this.require(restaurantId, platform);
    await this.prisma.adConnection.update({
      where: { id: row.id },
      data: {
        ...(input.status ? { status: input.status, lastError: null } : {}),
        ...(input.sendTypes ? { sendTypes: input.sendTypes } : {}),
        ...(input.enhancedMatching !== undefined ? { enhancedMatching: input.enhancedMatching } : {}),
      },
    });
    return (await this.list(restaurantId)).find((c) => c.platform === platform) as AdConnectionDTO;
  }

  async remove(restaurantId: string, platform: AdConnectionPlatform): Promise<void> {
    const row = await this.require(restaurantId, platform);
    await this.prisma.adConnection.delete({ where: { id: row.id } });
  }

  private async require(restaurantId: string, platform: AdConnectionPlatform): Promise<ConnectionRow> {
    const row = await this.prisma.adConnection.findUnique({
      where: { restaurantId_platform: { restaurantId, platform } },
    });
    if (!row) throw notFound('AD_CONNECTION_NOT_FOUND', 'Ad account not connected');
    return row;
  }

  // -- Queue ----------------------------------------------------------------------------

  /** Called when attribution records a conversion; one delivery per matching active connection. */
  async enqueueConversion(restaurantId: string, sourceKind: string, sourceId: string): Promise<number> {
    if (!(await this.features.isEnabled('ad_integrations', restaurantId))) return 0;
    const event = await this.prisma.conversionEvent.findUnique({
      where: { restaurantId_sourceKind_sourceId: { restaurantId, sourceKind, sourceId } },
      select: { id: true, type: true },
    });
    if (!event) return 0;
    const connections = await this.prisma.adConnection.findMany({
      where: { restaurantId, status: { in: ['ACTIVE', 'PAUSED'] }, sendTypes: { has: event.type } },
      select: { id: true },
    });
    if (connections.length === 0) return 0;
    const created = await this.prisma.adConversionDelivery.createMany({
      data: connections.map((c) => ({ connectionId: c.id, conversionEventId: event.id })),
      skipDuplicates: true,
    });
    return created.count;
  }

  // -- Runner ---------------------------------------------------------------------------

  /** One pass: drop stale deliveries, send due ones, pull spend where it is due. Returns conversions sent. */
  async runPass(now: Date = new Date()): Promise<number> {
    await this.prisma.adConversionDelivery.updateMany({
      where: {
        status: 'PENDING',
        conversion: { occurredAt: { lt: new Date(now.getTime() - MAX_EVENT_AGE_DAYS * DAY_MS) } },
      },
      data: { status: 'SKIPPED', errorCode: 'TOO_OLD' },
    });
    const sent = await this.deliver(now);
    await this.syncSpend(now);
    return sent;
  }

  private async deliver(now: Date): Promise<number> {
    const due = await this.prisma.adConversionDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now }, connection: { status: 'ACTIVE' } },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH,
      select: {
        id: true,
        attempts: true,
        connection: true,
        conversion: {
          select: {
            id: true,
            restaurantId: true,
            type: true,
            occurredAt: true,
            valueMinor: true,
            currency: true,
            attributedTouchpoint: {
              select: {
                advertisingConsent: true,
                clickIds: true,
                occurredAt: true,
                landingHost: true,
                landingPath: true,
                countryCode: true,
              },
            },
            customer: { select: { email: true, user: { select: { phone: true, email: true } } } },
          },
        },
      },
    });
    const enabled = new Map<string, boolean>();
    let sent = 0;
    for (const delivery of due) {
      const { connection, conversion } = delivery;
      if (!enabled.has(conversion.restaurantId)) {
        enabled.set(conversion.restaurantId, await this.features.isEnabled('ad_integrations', conversion.restaurantId));
      }
      // With the module off the queue waits; it never sends behind the switch.
      if (!enabled.get(conversion.restaurantId)) continue;
      const platform = connection.platform as AdConnectionPlatform;
      const touch = conversion.attributedTouchpoint;
      if (!touch || !touch.advertisingConsent) {
        await this.finish(delivery.id, 'SKIPPED', 'NO_AD_CONSENT');
        continue;
      }
      const stored = (touch.clickIds ?? {}) as Record<string, string>;
      const clickIds = Object.fromEntries(
        AD_CLICK_ID_KEYS[platform].filter((k) => typeof stored[k] === 'string' && stored[k]).map((k) => [k, stored[k]]),
      );
      const hasClick = Object.keys(clickIds).length > 0;
      if (!hasClick && (platform === 'GOOGLE' || !connection.enhancedMatching)) {
        await this.finish(delivery.id, 'SKIPPED', 'NO_CLICK_ID');
        continue;
      }
      const email = conversion.customer?.email ?? conversion.customer?.user.email ?? null;
      const phone = conversion.customer?.user.phone ?? null;
      const payload: AdConversionPayload = {
        eventId: conversion.id,
        type: conversion.type as ConversionType,
        occurredAt: conversion.occurredAt,
        valueMinor: conversion.valueMinor,
        currency: conversion.currency,
        digits: conversion.currency ? minorDigitsOf(conversion.currency) : 2,
        clickIds,
        clickedAt: touch.occurredAt,
        landingUrl: `https://${touch.landingHost}${touch.landingPath}`,
        hashedPhone: connection.enhancedMatching && phone ? sha256(phone.replace(/\D/g, '')) : null,
        hashedEmail: connection.enhancedMatching && email ? sha256(email.trim().toLowerCase()) : null,
        countryCode: touch.countryCode,
      };
      const result = await this.adapter(platform).sendConversion(this.credentialsOf(connection), payload);
      if (result.ok) {
        sent += 1;
        await this.prisma.$transaction([
          this.prisma.adConversionDelivery.update({
            where: { id: delivery.id },
            data: { status: 'SENT', sentAt: now, attempts: { increment: 1 }, errorCode: null },
          }),
          this.prisma.adConnection.update({ where: { id: connection.id }, data: { lastSentAt: now, lastError: null } }),
        ]);
        continue;
      }
      const attempts = delivery.attempts + 1;
      if (result.authFailed) {
        // The connection stops until the business fixes it; the delivery waits and is retried then.
        await this.prisma.adConnection.update({
          where: { id: connection.id },
          data: { status: 'ERROR', lastError: result.errorCode },
        });
        continue;
      }
      if (result.retryable && attempts < AD_DELIVERY_MAX_ATTEMPTS) {
        await this.prisma.adConversionDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts,
            errorCode: result.errorCode,
            nextAttemptAt: new Date(now.getTime() + 2 ** attempts * MINUTE_MS),
          },
        });
        continue;
      }
      await this.finish(delivery.id, 'FAILED', result.errorCode, attempts);
      await this.prisma.adConnection.update({ where: { id: connection.id }, data: { lastError: result.errorCode } });
    }
    return sent;
  }

  private async finish(id: string, status: 'SKIPPED' | 'FAILED', errorCode: string | null, attempts?: number) {
    await this.prisma.adConversionDelivery.update({
      where: { id },
      data: { status, errorCode, ...(attempts !== undefined ? { attempts } : {}) },
    });
  }

  /** Pulls the last days of spend for connections not synced in AD_SPEND_SYNC_HOURS. */
  async syncSpend(now: Date, restaurantId?: string): Promise<number> {
    const connections = await this.prisma.adConnection.findMany({
      where: {
        status: 'ACTIVE',
        ...(restaurantId
          ? { restaurantId }
          : {
              OR: [
                { lastSpendSyncAt: null },
                { lastSpendSyncAt: { lt: new Date(now.getTime() - AD_SPEND_SYNC_HOURS * 60 * MINUTE_MS) } },
              ],
            }),
      },
      include: { restaurant: { select: { currency: true } } },
      take: 20,
    });
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - (AD_SPEND_LOOKBACK_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
    let rows = 0;
    for (const connection of connections) {
      if (!(await this.features.isEnabled('ad_integrations', connection.restaurantId))) continue;
      const spend = await this.adapter(connection.platform as AdConnectionPlatform).fetchSpend(
        this.credentialsOf(connection),
        from,
        to,
        connection.restaurant.currency,
        minorDigitsOf,
      );
      for (const row of spend) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
        const values = {
          campaignName: row.campaignName,
          spendMinor: row.spendMinor,
          currency: row.currency,
          impressions: row.impressions,
          clicks: row.clicks,
        };
        await this.prisma.adSpendDaily.upsert({
          where: {
            connectionId_date_campaignRef: {
              connectionId: connection.id,
              date: new Date(`${row.date}T00:00:00Z`),
              campaignRef: row.campaignRef,
            },
          },
          create: {
            connectionId: connection.id,
            restaurantId: connection.restaurantId,
            date: new Date(`${row.date}T00:00:00Z`),
            campaignRef: row.campaignRef,
            ...values,
          },
          update: values,
        });
        rows += 1;
      }
      await this.prisma.adConnection.update({ where: { id: connection.id }, data: { lastSpendSyncAt: now } });
    }
    return rows;
  }

  // -- Report ---------------------------------------------------------------------------

  /**
   * Spend per platform and currency against the conversions whose last touch
   * came from that platform. Return on ad spend only where both sides are in
   * the same currency; currencies are never mixed.
   */
  async performance(restaurantId: string, days: number, now: Date = new Date()): Promise<AdPerformanceDTO> {
    const from = new Date(now.getTime() - days * DAY_MS);
    const [spend, conversions] = await Promise.all([
      this.prisma.adSpendDaily.findMany({
        where: { restaurantId, date: { gte: new Date(from.toISOString().slice(0, 10)) } },
        select: {
          spendMinor: true,
          currency: true,
          impressions: true,
          clicks: true,
          connection: { select: { platform: true } },
        },
      }),
      this.prisma.conversionEvent.findMany({
        where: {
          restaurantId,
          occurredAt: { gte: from, lte: now },
          type: { in: [...CONVERSION_TYPES] },
          attributedTouchpoint: { adPlatform: { in: [...AD_CONNECTION_PLATFORMS] } },
        },
        select: { valueMinor: true, currency: true, attributedTouchpoint: { select: { adPlatform: true } } },
        take: 20_000,
      }),
    ]);
    const rows = new Map<string, AdPerformanceRowDTO>();
    const rowFor = (platform: AdConnectionPlatform, currency: string) => {
      const key = `${platform}:${currency}`;
      const row = rows.get(key) ?? {
        platform,
        currency,
        spendMinor: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenueMinor: 0,
        roasBps: null,
      };
      rows.set(key, row);
      return row;
    };
    for (const s of spend) {
      const row = rowFor(s.connection.platform as AdConnectionPlatform, s.currency);
      row.spendMinor += s.spendMinor;
      row.impressions += s.impressions;
      row.clicks += s.clicks;
    }
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true },
    });
    for (const c of conversions) {
      const platform = c.attributedTouchpoint?.adPlatform as AdConnectionPlatform | undefined;
      if (!platform) continue;
      const row = rowFor(platform, c.currency ?? restaurant.currency);
      row.conversions += 1;
      row.revenueMinor += c.valueMinor ?? 0;
    }
    for (const row of rows.values()) {
      row.roasBps = row.spendMinor > 0 ? Math.round((row.revenueMinor * 10_000) / row.spendMinor) : null;
    }
    return {
      days,
      rows: [...rows.values()].sort(
        (a, b) => a.platform.localeCompare(b.platform) || a.currency.localeCompare(b.currency),
      ),
    };
  }

  private toDto(row: ConnectionRow, deliveries: AdConnectionDTO['deliveries']): AdConnectionDTO {
    const platform = row.platform as AdConnectionPlatform;
    const secrets = AD_CREDENTIAL_FIELDS[platform].filter((f) => f.secret).map((f) => f.key);
    let stored: Record<string, string> = {};
    try {
      stored = this.credentialsOf(row);
    } catch (error) {
      this.logger.warn(`ad connection ${row.id} credentials unreadable: ${String(error)}`);
    }
    return {
      platform,
      status: row.status === 'PAUSED' ? 'PAUSED' : row.status === 'ERROR' ? 'ERROR' : 'ACTIVE',
      config: (row.publicConfig ?? {}) as Record<string, string>,
      secretsSet: secrets.filter((key) => Boolean(stored[key])),
      sendTypes: row.sendTypes as ConversionType[],
      enhancedMatching: row.enhancedMatching,
      lastSentAt: row.lastSentAt?.toISOString() ?? null,
      lastSpendSyncAt: row.lastSpendSyncAt?.toISOString() ?? null,
      lastError: row.lastError,
      deliveries,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
