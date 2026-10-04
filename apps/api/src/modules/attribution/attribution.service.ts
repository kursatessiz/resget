import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@resget/database';
import {
  ATTRIBUTION_WINDOW_DAYS,
  COMPLETED_ORDER_STATUSES,
  PLATFORM_CONVERSION_TYPES,
  PLATFORM_DEFAULT_STAGES,
  PLATFORM_LEAD_FORM_VERSION,
  RESTAURANT_CONVERSION_TYPES,
  VisitorIdSchema,
  aggregateAttribution,
  deviceTypeOf,
  isBotUserAgent,
  isUntaggedPaidTraffic,
  parseTrackingParams,
  touchpointKey,
} from '@resget/shared';
import type {
  AttributableTouchpoint,
  AttributionQuery,
  AttributionReportDTO,
  ContactAttributionDTO,
  ConversionType,
  PlatformLeadInput,
  PlatformSiteDTO,
  TouchpointInput,
} from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { ConsentService } from '../consent/consent.service';

/** Request facts the tracking endpoint passes in; the IP address is never among them. */
export interface TouchpointMeta {
  userAgent: string | null;
  /** Country from the edge proxy (CF-IPCountry or X-Country-Code), when there is one. */
  edgeCountry: string | null;
}

export interface ConversionInput {
  restaurantId: string;
  type: ConversionType;
  customerId: string | null;
  valueMinor: number | null;
  currency: string | null;
  sourceKind: string;
  sourceId: string;
  occurredAt?: Date;
}

const touchpointSelect = {
  id: true,
  occurredAt: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  utmId: true,
  campaignId: true,
  adPlatform: true,
  referrerHost: true,
  tableId: true,
} as const satisfies Prisma.TouchpointSelect;

const PATH_MAX = 500;
const CARD_LIMIT = 20;
/** One report reads at most this many conversions; a longer range is narrowed by the screen. */
const REPORT_MAX_CONVERSIONS = 50_000;

/**
 * Visitors, touchpoints and conversions (docs/ATIF.md). Nothing here ever
 * blocks the business flow that calls it: hooks use the *Safely variants,
 * which log and swallow. Everything is a no-op while the attribution module
 * is off for the tenant.
 */
@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly consent: ConsentService,
  ) {}

  // -- Tenants -------------------------------------------------------------------------

  /** The tenant a tracking call is for: `platform` is the platform's own site, anything else a restaurant slug. */
  private async trackedTenant(target: string): Promise<string | null> {
    const row =
      target === 'platform'
        ? await this.prisma.restaurant.findFirst({ where: { isPlatform: true }, select: { id: true } })
        : await this.prisma.restaurant.findFirst({
            where: { slug: target, isPlatform: false, isActive: true },
            select: { id: true },
          });
    if (!row || !(await this.enabled(row.id))) return null;
    return row.id;
  }

  private async platformTenant(): Promise<string | null> {
    const row = await this.prisma.restaurant.findFirst({ where: { isPlatform: true }, select: { id: true } });
    return row?.id ?? null;
  }

  async enabled(restaurantId: string): Promise<boolean> {
    return this.features.isEnabled('attribution', restaurantId);
  }

  /** What the platform's public site may do: measure visits, and show the lead form (needs the CRM module too). */
  async platformSite(): Promise<PlatformSiteDTO> {
    const platformId = await this.platformTenant();
    if (!platformId || !(await this.features.isEnabled('marketing_platform', platformId)))
      return { tracking: false, leadForm: false };
    const [tracking, crm] = await Promise.all([
      this.enabled(platformId),
      this.features.isEnabled('contacts_crm', platformId),
    ]);
    return { tracking, leadForm: crm };
  }

  // -- Touchpoints ---------------------------------------------------------------------

  /**
   * Stores one visit. Every outcome looks the same to the caller (the
   * endpoint answers 204): an unknown tenant, a bot, missing consent and a
   * stored touchpoint are indistinguishable from outside.
   */
  async recordTouchpoint(target: string, input: TouchpointInput, meta: TouchpointMeta): Promise<void> {
    if (!input.consent.analytics || isBotUserAgent(meta.userAgent)) return;
    const restaurantId = await this.trackedTenant(target);
    if (!restaurantId) return;
    if (target === 'platform' && !(await this.features.isEnabled('marketing_platform', restaurantId))) return;

    let landing: URL;
    try {
      landing = new URL(input.url);
    } catch {
      return;
    }
    const params = parseTrackingParams(landing.searchParams);
    const advertising = input.consent.advertising;
    let referrerHost: string | null = null;
    if (input.referrer) {
      try {
        const host = new URL(input.referrer).hostname.toLowerCase();
        referrerHost = host && host !== landing.hostname.toLowerCase() ? host : null;
      } catch {
        referrerHost = null;
      }
    }
    const table = input.tableToken
      ? await this.prisma.diningTable.findFirst({
          where: { qrToken: input.tableToken, restaurantId },
          select: { id: true },
        })
      : null;
    const edge = meta.edgeCountry?.trim().toUpperCase();
    const now = new Date();

    const visitor = await this.prisma.visitor.upsert({
      where: { restaurantId_id: { restaurantId, id: input.visitorId } },
      create: { restaurantId, id: input.visitorId, firstSeenAt: now, lastSeenAt: now },
      update: { lastSeenAt: now },
      select: { customerId: true },
    });
    await this.prisma.touchpoint.create({
      data: {
        restaurantId,
        visitorId: input.visitorId,
        sessionId: input.sessionId,
        occurredAt: now,
        landingHost: landing.hostname.toLowerCase(),
        landingPath: landing.pathname.slice(0, PATH_MAX) || '/',
        referrerHost,
        utmSource: params.utmSource,
        utmMedium: params.utmMedium,
        utmCampaign: params.utmCampaign,
        utmTerm: params.utmTerm,
        utmContent: params.utmContent,
        utmId: params.utmId,
        campaignId: params.campaignId,
        adsetId: params.adsetId,
        adId: params.adId,
        refCode: params.refCode,
        // Without advertising consent the click ids are dropped; the platform guess from utm_source stays.
        adPlatform: advertising ? params.adPlatform : params.utmSource ? params.adPlatform : null,
        clickIds: advertising && Object.keys(params.clickIds).length > 0 ? params.clickIds : Prisma.DbNull,
        advertisingConsent: advertising,
        untaggedPaid: isUntaggedPaidTraffic(params),
        locale: input.locale,
        countryCode: edge && /^[A-Z]{2}$/.test(edge) ? edge : null,
        deviceType: meta.userAgent ? deviceTypeOf(meta.userAgent) : null,
        tableId: table?.id ?? null,
        customerId: visitor.customerId,
      },
    });
  }

  // -- Identification ------------------------------------------------------------------

  /**
   * Links a visitor to a contact and gives the contact the visitor's earlier
   * touchpoints. Only server flows that already know the contact (an order,
   * a sign-up, the lead form) call this; there is no public identify call.
   */
  async identify(restaurantId: string, visitorId: string | null, customerId: string): Promise<void> {
    if (!visitorId || !VisitorIdSchema.safeParse(visitorId).success) return;
    if (!(await this.enabled(restaurantId))) return;
    const visitor = await this.prisma.visitor.findUnique({
      where: { restaurantId_id: { restaurantId, id: visitorId } },
      select: { id: true },
    });
    // No visitor row means the browser never allowed measurement: nothing to link.
    if (!visitor) return;
    await this.prisma.$transaction([
      this.prisma.visitor.update({
        where: { restaurantId_id: { restaurantId, id: visitorId } },
        data: { customerId },
      }),
      this.prisma.touchpoint.updateMany({
        where: { restaurantId, visitorId, customerId: null },
        data: { customerId },
      }),
    ]);
  }

  /** After a consumer order: the order's customer is the visitor who placed it. */
  async identifyOrderSafely(orderId: string, visitorId: string | null): Promise<void> {
    if (!visitorId) return;
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { restaurantId: true, customerUserId: true },
      });
      if (!order?.customerUserId) return;
      const customer = await this.prisma.restaurantCustomer.findUnique({
        where: { restaurantId_userId: { restaurantId: order.restaurantId, userId: order.customerUserId } },
        select: { id: true },
      });
      if (customer) await this.identify(order.restaurantId, visitorId, customer.id);
    } catch (error) {
      this.logger.warn(`identify after order ${orderId} failed: ${String(error)}`);
    }
  }

  // -- Conversions ---------------------------------------------------------------------

  /**
   * Records a conversion once per (tenant, source): a retried hook, a
   * repeated webhook or two concurrent calls leave one row. The last touch
   * within the window is kept on the row.
   */
  async record(input: ConversionInput): Promise<boolean> {
    if (!(await this.enabled(input.restaurantId))) return false;
    const occurredAt = input.occurredAt ?? new Date();
    const lastTouch = input.customerId
      ? await this.prisma.touchpoint.findFirst({
          where: {
            customerId: input.customerId,
            occurredAt: { lte: occurredAt, gte: new Date(occurredAt.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000) },
          },
          orderBy: { occurredAt: 'desc' },
          select: { id: true },
        })
      : null;
    const created = await this.prisma.conversionEvent.createMany({
      data: [
        {
          restaurantId: input.restaurantId,
          type: input.type,
          occurredAt,
          customerId: input.customerId,
          valueMinor: input.valueMinor,
          currency: input.currency,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          attributedTouchpointId: lastTouch?.id ?? null,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0 || !input.customerId) return created.count > 0;
    await this.prisma.$transaction([
      this.prisma.contactActivity.create({
        data: { restaurantId: input.restaurantId, customerId: input.customerId, type: 'CONVERSION', body: input.type },
      }),
      this.prisma.restaurantCustomer.update({
        where: { id: input.customerId },
        data: { lastActivityAt: occurredAt },
      }),
    ]);
    return true;
  }

  async recordSafely(input: ConversionInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.warn(`conversion ${input.type} ${input.sourceKind}:${input.sourceId} failed: ${String(error)}`);
    }
  }

  /** A completed order: the customer's first completed order here, or a repeat. */
  async onOrderEvent(order: { id: string; restaurantId: string; status: string }): Promise<void> {
    if (!(COMPLETED_ORDER_STATUSES as readonly string[]).includes(order.status)) return;
    if (!(await this.enabled(order.restaurantId))) return;
    const row = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { customerUserId: true, chargedToCustomerMinor: true, currency: true, completedAt: true },
    });
    if (!row?.customerUserId) return;
    const customer = await this.prisma.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId: order.restaurantId, userId: row.customerUserId } },
      select: { id: true },
    });
    if (!customer) return;
    const completedAt = row.completedAt ?? new Date();
    const earlier = await this.prisma.order.count({
      where: {
        restaurantId: order.restaurantId,
        customerUserId: row.customerUserId,
        id: { not: order.id },
        status: { in: [...COMPLETED_ORDER_STATUSES] },
        completedAt: { lt: completedAt },
      },
    });
    await this.recordSafely({
      restaurantId: order.restaurantId,
      type: earlier === 0 ? 'first_order' : 'repeat_order',
      customerId: customer.id,
      valueMinor: row.chargedToCustomerMinor,
      currency: row.currency,
      sourceKind: 'order',
      sourceId: order.id,
      occurredAt: completedAt,
    });
  }

  // -- Platform tenant -----------------------------------------------------------------

  /** The platform tenant's contact for a person, created on first sight. */
  private async platformContact(
    platformId: string,
    userId: string,
    data: { company?: string | null; city?: string | null; district?: string | null; source: string },
  ): Promise<string> {
    // The pipeline's stages are created on first use, by the CRM screen or here.
    if ((await this.prisma.pipelineStage.count({ where: { restaurantId: platformId } })) === 0) {
      await this.prisma.pipelineStage.createMany({
        data: PLATFORM_DEFAULT_STAGES.map((stage, position) => ({
          restaurantId: platformId,
          key: stage.key,
          kind: stage.kind,
          position,
        })),
        skipDuplicates: true,
      });
    }
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { restaurantId: platformId, key: 'lead' },
      select: { id: true },
    });
    const row = await this.prisma.restaurantCustomer.upsert({
      where: { restaurantId_userId: { restaurantId: platformId, userId } },
      update: {},
      create: {
        restaurantId: platformId,
        userId,
        company: data.company ?? null,
        city: data.city ?? null,
        district: data.district ?? null,
        source: data.source,
        stageId: stage?.id ?? null,
        // Contacts of the platform are restaurant owners: merchants for the TR exemption (docs/RIZA.md).
        isBusiness: true,
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });
    return row.id;
  }

  /** A restaurant was created (self sign-up or console): a restaurant_signup on the owner's platform contact. */
  async onRestaurantCreatedSafely(restaurantId: string, ownerUserId: string, visitorId: string | null) {
    try {
      const platformId = await this.platformTenant();
      if (!platformId || platformId === restaurantId || !(await this.enabled(platformId))) return;
      const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: {
          name: true,
          branches: { take: 1, orderBy: { createdAt: 'asc' }, select: { city: true, district: true } },
        },
      });
      const branch = restaurant.branches[0];
      const customerId = await this.platformContact(platformId, ownerUserId, {
        company: restaurant.name,
        city: branch?.city ?? null,
        district: branch?.district ?? null,
        source: 'signup',
      });
      await this.identify(platformId, visitorId, customerId);
      await this.record({
        restaurantId: platformId,
        type: 'restaurant_signup',
        customerId,
        valueMinor: null,
        currency: null,
        sourceKind: 'restaurant',
        sourceId: restaurantId,
      });
    } catch (error) {
      this.logger.warn(`restaurant_signup for ${restaurantId} failed: ${String(error)}`);
    }
  }

  /** The restaurant's first paid platform invoice: first_payment on the owner's platform contact, once. */
  async onInvoicePaidSafely(restaurantId: string, totalMinor: number, currency: string): Promise<void> {
    try {
      const platformId = await this.platformTenant();
      if (!platformId || platformId === restaurantId || !(await this.enabled(platformId))) return;
      const owner = await this.prisma.membership.findFirst({
        where: { restaurantId, status: 'ACTIVE', roleTemplate: { isOwner: true } },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, restaurant: { select: { name: true } } },
      });
      if (!owner) return;
      const customerId = await this.platformContact(platformId, owner.userId, {
        company: owner.restaurant.name,
        source: 'signup',
      });
      await this.record({
        restaurantId: platformId,
        type: 'first_payment',
        customerId,
        valueMinor: totalMinor,
        currency,
        sourceKind: 'restaurant_first_payment',
        sourceId: restaurantId,
      });
    } catch (error) {
      this.logger.warn(`first_payment for ${restaurantId} failed: ${String(error)}`);
    }
  }

  /**
   * The platform site's lead form. Answers the same whether the phone is new
   * or known, so the form cannot be used to look people up.
   */
  async platformLead(input: PlatformLeadInput, visitorId: string | null): Promise<void> {
    const site = await this.platformSite();
    const platformId = await this.platformTenant();
    if (!site.leadForm || !platformId) return;
    const user = await this.prisma.user.upsert({
      where: { phone: input.phone },
      update: {},
      create: { phone: input.phone, fullName: input.fullName },
      select: { id: true },
    });
    const customerId = await this.platformContact(platformId, user.id, {
      company: input.restaurantName,
      city: input.city ?? null,
      district: input.district ?? null,
      source: 'site_form',
    });
    await this.prisma.$transaction([
      this.prisma.contactActivity.create({
        data: {
          restaurantId: platformId,
          customerId,
          type: 'FORM',
          body: [input.fullName, input.restaurantName, input.district, input.city].filter(Boolean).join(', '),
        },
      }),
      this.prisma.restaurantCustomer.update({ where: { id: customerId }, data: { lastActivityAt: new Date() } }),
    ]);
    if (input.marketingConsent) {
      await this.consent.grant({
        restaurantId: platformId,
        customerId,
        channels: ['SMS'],
        source: 'SITE_FORM',
        formVersion: PLATFORM_LEAD_FORM_VERSION,
      });
    }
    await this.identify(platformId, visitorId, customerId);
    await this.recordSafely({
      restaurantId: platformId,
      type: 'lead',
      customerId,
      valueMinor: null,
      currency: null,
      sourceKind: 'lead_contact',
      sourceId: customerId,
    });
  }

  // -- Reading -------------------------------------------------------------------------

  async report(restaurantId: string, isPlatform: boolean, query: AttributionQuery): Promise<AttributionReportDTO> {
    const types = isPlatform ? PLATFORM_CONVERSION_TYPES : RESTAURANT_CONVERSION_TYPES;
    const base = {
      enabled: await this.enabled(restaurantId),
      model: query.model,
      groupBy: query.groupBy,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      windowDays: ATTRIBUTION_WINDOW_DAYS,
      types,
    };
    const range = { gte: query.from, lt: query.to };
    const [conversions, visits, untaggedPaidVisits] = await Promise.all([
      this.prisma.conversionEvent.findMany({
        where: { restaurantId, occurredAt: range, type: { in: [...types] } },
        orderBy: { occurredAt: 'asc' },
        take: REPORT_MAX_CONVERSIONS,
        select: { type: true, occurredAt: true, customerId: true, valueMinor: true, currency: true },
      }),
      this.prisma.touchpoint.count({ where: { restaurantId, occurredAt: range } }),
      this.prisma.touchpoint.count({ where: { restaurantId, occurredAt: range, untaggedPaid: true } }),
    ]);
    const customerIds = [...new Set(conversions.map((c) => c.customerId).filter((id): id is string => id !== null))];
    const touchpoints = customerIds.length
      ? await this.prisma.touchpoint.findMany({
          where: { restaurantId, customerId: { in: customerIds }, occurredAt: { lt: query.to } },
          select: { ...touchpointSelect, customerId: true },
        })
      : [];
    const byCustomer = new Map<string, AttributableTouchpoint[]>();
    for (const t of touchpoints) {
      if (!t.customerId) continue;
      const list = byCustomer.get(t.customerId) ?? [];
      list.push(t);
      byCustomer.set(t.customerId, list);
    }
    const { rows, totals } = aggregateAttribution(
      conversions.map((c) => ({
        type: c.type as ConversionType,
        occurredAt: c.occurredAt,
        valueMinor: c.valueMinor,
        currency: c.currency,
        touchpoints: c.customerId ? (byCustomer.get(c.customerId) ?? []) : [],
      })),
      query.model,
      query.groupBy,
    );
    return { ...base, rows, totals, visits, untaggedPaidVisits };
  }

  /** The contact card's visits and conversions; null while the module is off. */
  async contactAttribution(restaurantId: string, customerId: string): Promise<ContactAttributionDTO | null> {
    if (!(await this.enabled(restaurantId))) return null;
    const [touchpoints, conversions] = await Promise.all([
      this.prisma.touchpoint.findMany({
        where: { restaurantId, customerId },
        orderBy: { occurredAt: 'desc' },
        take: CARD_LIMIT,
        select: { ...touchpointSelect, landingPath: true, table: { select: { label: true } } },
      }),
      this.prisma.conversionEvent.findMany({
        where: { restaurantId, customerId },
        orderBy: { occurredAt: 'desc' },
        take: CARD_LIMIT,
        select: {
          id: true,
          type: true,
          occurredAt: true,
          valueMinor: true,
          currency: true,
          attributedTouchpoint: { select: touchpointSelect },
        },
      }),
    ]);
    return {
      touchpoints: touchpoints.map((t) => ({
        id: t.id,
        occurredAt: t.occurredAt.toISOString(),
        source: touchpointKey(t, 'source'),
        medium: touchpointKey(t, 'medium'),
        campaign: touchpointKey(t, 'campaign'),
        landingPath: t.landingPath,
        tableLabel: t.table?.label ?? null,
      })),
      conversions: conversions.map((c) => ({
        id: c.id,
        type: c.type as ConversionType,
        occurredAt: c.occurredAt.toISOString(),
        valueMinor: c.valueMinor,
        currency: c.currency,
        source: touchpointKey(c.attributedTouchpoint, 'source'),
      })),
    };
  }
}
