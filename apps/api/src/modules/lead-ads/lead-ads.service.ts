import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  LEAD_ADS_PAGE_SIZE,
  LEAD_ADS_SOURCE,
  LEAD_IMPORT_MAX_ATTEMPTS,
  leadRetryDelayMinutes,
  mapLeadFields,
} from '@resget/shared';
import type {
  LeadReason,
  LeadgenNotice,
  MappedLead,
  MetaLeadDTO,
  MetaLeadPageDTO,
  MetaLeadStatus,
  SocialAccountDTO,
} from '@resget/shared';
import { badGateway, conflict, notFound } from '../../common/api-error';
import { AttributionService } from '../attribution/attribution.service';
import { CrmService } from '../crm/crm.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { META_GRAPH } from '../social/meta-graph';
import type { MetaGraph, MetaLeadData } from '../social/meta-graph';
import { SocialService } from '../social/social.service';

/** How long an import holds a lead before another worker may pick it up again. */
const LEASE_MS = 5 * 60_000;
/** Leads the sweep imports per run. */
const SWEEP_BATCH = 50;
const ACTIVITY_BODY_MAX = 2000;

const leadInclude = {
  socialAccount: { select: { name: true } },
  customer: { select: { user: { select: { fullName: true } } } },
} as const;

type LeadRow = NonNullable<Awaited<ReturnType<PrismaService['metaLead']['findFirst']>>>;

/**
 * Lead Ads to CRM (docs/LEAD_ADS.md). Meta's signed webhook names a lead;
 * the answers are read with the page's token and become a contact in the
 * tenant's pipeline, with a FORM activity holding the custom answers. A lead
 * without a valid phone is skipped (users are identified by phone). No
 * marketing consent is granted. Failed reads are retried with backoff by the
 * sweep and, after the last try, by a person from the screen.
 */
@Injectable()
export class LeadAdsService {
  private readonly logger = new Logger(LeadAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly config: ConfigService,
    private readonly social: SocialService,
    private readonly crm: CrmService,
    private readonly attribution: AttributionService,
    @Optional() @Inject(META_GRAPH) private readonly meta: MetaGraph | null,
  ) {}

  // -- Webhook ---------------------------------------------------------------------------

  /** The challenge to echo when Meta sets the webhook up; null when the request is not Meta's. */
  verifyChallenge(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
    const expected = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN');
    // Meta's challenge is a number; anything else is never echoed back.
    if (!expected || mode !== 'subscribe' || !token || !challenge || !/^\d{1,15}$/.test(challenge)) return null;
    return safeEqual(token, expected) ? String(Number(challenge)) : null;
  }

  /** X-Hub-Signature-256 over the raw body with the app secret; without a secret nothing is accepted. */
  verifySignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
    const secret = this.config.get<string>('META_APP_SECRET');
    if (!secret || !rawBody || !header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqual(header.slice('sha256='.length), expected);
  }

  /**
   * Records each notice for every tenant that has the page connected with
   * leads on, then imports the new ones. A repeated delivery finds its leads
   * already recorded and adds nothing.
   */
  async receive(notices: readonly LeadgenNotice[], now = new Date()): Promise<number> {
    const created: string[] = [];
    for (const notice of notices) {
      const accounts = await this.prisma.socialAccount.findMany({
        where: {
          provider: 'META',
          kind: 'FACEBOOK_PAGE',
          externalId: notice.pageId,
          enabled: true,
          leadsEnabled: true,
        },
        select: { id: true, restaurantId: true },
      });
      for (const account of accounts) {
        if (!(await this.moduleOn(account.restaurantId))) continue;
        const existing = await this.prisma.metaLead.findUnique({
          where: { restaurantId_leadgenId: { restaurantId: account.restaurantId, leadgenId: notice.leadgenId } },
          select: { id: true },
        });
        if (existing) continue;
        try {
          const row = await this.prisma.metaLead.create({
            data: {
              restaurantId: account.restaurantId,
              socialAccountId: account.id,
              leadgenId: notice.leadgenId,
              pageId: notice.pageId,
              formId: notice.formId,
              adId: notice.adId,
              receivedAt: now,
              nextAttemptAt: now,
            },
            select: { id: true },
          });
          created.push(row.id);
        } catch {
          // A concurrent delivery of the same lead won the unique key; that one imports it.
        }
      }
    }
    for (const id of created) await this.importLead(id, now);
    return created.length;
  }

  // -- Import ----------------------------------------------------------------------------

  /** Imports one lead if it is due; returns its status afterwards (null when another worker holds it). */
  async importLead(leadId: string, now = new Date()): Promise<MetaLeadStatus | null> {
    // Leased atomically so the webhook and the sweep never import the same lead twice.
    const claimed = await this.prisma.metaLead.updateMany({
      where: { id: leadId, status: 'RECEIVED', nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count === 0) return null;
    const lead = await this.prisma.metaLead.findUniqueOrThrow({
      where: { id: leadId },
      include: {
        socialAccount: true,
        restaurant: { select: { countryCode: true, isPlatform: true } },
      },
    });
    if (!(await this.moduleOn(lead.restaurantId))) return this.finish(lead.id, 'SKIPPED', 'MODULE_OFF');
    const account = lead.socialAccount;
    if (!account || !account.enabled || !account.leadsEnabled || !this.meta) {
      return this.finish(lead.id, 'FAILED', 'PAGE_UNAVAILABLE');
    }

    let data: MetaLeadData;
    try {
      data = await this.meta.lead(lead.leadgenId, this.social.tokenOf(account));
    } catch (error) {
      this.logger.warn(`Lead ${lead.id} read failed: ${error instanceof Error ? error.message : 'error'}`);
      const attempts = lead.attempts + 1;
      if (attempts >= LEAD_IMPORT_MAX_ATTEMPTS) {
        await this.prisma.metaLead.update({
          where: { id: lead.id },
          data: { attempts, status: 'FAILED', reason: 'GRAPH_ERROR' },
        });
        return 'FAILED';
      }
      await this.prisma.metaLead.update({
        where: { id: lead.id },
        data: {
          attempts,
          reason: 'GRAPH_ERROR',
          nextAttemptAt: new Date(now.getTime() + leadRetryDelayMinutes(attempts) * 60_000),
        },
      });
      return 'RECEIVED';
    }

    const mapped = mapLeadFields(data.fields, lead.restaurant.countryCode);
    if (!mapped.phone) return this.finish(lead.id, 'SKIPPED', 'NO_PHONE');
    const customerId = await this.contact(lead.restaurantId, mapped, now);
    await this.prisma.$transaction([
      this.prisma.contactActivity.create({
        data: {
          restaurantId: lead.restaurantId,
          customerId,
          type: 'FORM',
          body: activityBody(mapped, data.formId ?? lead.formId),
        },
      }),
      this.prisma.metaLead.update({
        where: { id: lead.id },
        data: {
          status: 'IMPORTED',
          reason: null,
          attempts: lead.attempts + 1,
          customerId,
          importedAt: now,
          formId: data.formId ?? lead.formId,
          adId: data.adId ?? lead.adId,
        },
      }),
    ]);
    if (lead.restaurant.isPlatform) {
      await this.attribution.recordSafely({
        restaurantId: lead.restaurantId,
        type: 'lead',
        customerId,
        valueMinor: null,
        currency: null,
        sourceKind: 'meta_lead',
        sourceId: lead.id,
      });
    }
    return 'IMPORTED';
  }

  /** Imports the leads whose next try is due; the watchdog calls it. */
  async sweep(now = new Date()): Promise<number> {
    const due = await this.prisma.metaLead.findMany({
      where: { status: 'RECEIVED', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true },
    });
    let imported = 0;
    for (const row of due) {
      if ((await this.importLead(row.id, now)) === 'IMPORTED') imported += 1;
    }
    return imported;
  }

  /**
   * The contact for a lead: an existing contact with this phone keeps its
   * stage, source and consent and only gains the fields it lacked; a new one
   * starts in the pipeline's first open stage.
   */
  private async contact(restaurantId: string, lead: MappedLead, now: Date): Promise<string> {
    const phone = lead.phone as string;
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, fullName: lead.fullName ?? phone },
      select: { id: true },
    });
    const existing = await this.prisma.restaurantCustomer.findUnique({
      where: { restaurantId_userId: { restaurantId, userId: user.id } },
      select: { id: true, email: true, city: true, company: true },
    });
    if (existing) {
      await this.prisma.restaurantCustomer.update({
        where: { id: existing.id },
        data: {
          email: existing.email ?? lead.email,
          city: existing.city ?? lead.city,
          company: existing.company ?? lead.company,
          lastActivityAt: now,
        },
      });
      return existing.id;
    }
    const stage = (await this.crm.stages(restaurantId)).find((s) => s.kind === 'OPEN') ?? null;
    try {
      const row = await this.prisma.restaurantCustomer.create({
        data: {
          restaurantId,
          userId: user.id,
          email: lead.email,
          city: lead.city,
          company: lead.company,
          source: LEAD_ADS_SOURCE,
          stageId: stage?.id ?? null,
          lastActivityAt: now,
        },
        select: { id: true },
      });
      return row.id;
    } catch {
      // Created a moment ago by an order or another lead with the same phone.
      const row = await this.prisma.restaurantCustomer.findUniqueOrThrow({
        where: { restaurantId_userId: { restaurantId, userId: user.id } },
        select: { id: true },
      });
      return row.id;
    }
  }

  private async finish(id: string, status: MetaLeadStatus, reason: LeadReason): Promise<MetaLeadStatus> {
    await this.prisma.metaLead.update({ where: { id }, data: { status, reason, attempts: { increment: 1 } } });
    return status;
  }

  private async moduleOn(restaurantId: string): Promise<boolean> {
    return (
      (await this.features.isEnabled('lead_ads', restaurantId)) &&
      (await this.features.isEnabled('integration_hub', restaurantId))
    );
  }

  // -- Screens ---------------------------------------------------------------------------

  /** Turns lead import on or off for a connected page; turning it on subscribes the page to the leadgen webhook. */
  async setPage(
    restaurantId: string,
    accountId: string,
    actorUserId: string,
    enabled: boolean,
  ): Promise<SocialAccountDTO> {
    const account = await this.social.require(restaurantId, accountId);
    if (enabled) {
      if (account.kind !== 'FACEBOOK_PAGE' || !account.enabled) {
        throw conflict('LEAD_ADS_PAGE_REQUIRED', 'Only a Facebook page in use can import leads');
      }
      if (!this.meta || !(await this.features.isEnabled('integration_hub', restaurantId))) {
        throw conflict('SOCIAL_NOT_CONFIGURED', 'No Meta app is configured');
      }
      try {
        await this.meta.subscribeLeadgen(account.externalId, this.social.tokenOf(account));
      } catch (error) {
        this.logger.warn(`Leadgen subscription failed: ${error instanceof Error ? error.message : 'error'}`);
        throw badGateway('META_SUBSCRIBE_FAILED', 'The page could not be subscribed');
      }
    }
    const updated = await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: { leadsEnabled: enabled },
    });
    await this.prisma.auditLog.create({
      data: {
        restaurantId,
        actorUserId,
        action: enabled ? 'lead_ads.enable' : 'lead_ads.disable',
        entity: 'social_account',
        entityId: account.id,
        meta: { externalId: account.externalId },
      },
    });
    return this.social.toDto(updated);
  }

  async list(restaurantId: string, page: number): Promise<MetaLeadPageDTO> {
    const [rows, total] = await Promise.all([
      this.prisma.metaLead.findMany({
        where: { restaurantId },
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * LEAD_ADS_PAGE_SIZE,
        take: LEAD_ADS_PAGE_SIZE,
        include: leadInclude,
      }),
      this.prisma.metaLead.count({ where: { restaurantId } }),
    ]);
    return { items: rows.map((row) => toDto(row)), total, page, pageSize: LEAD_ADS_PAGE_SIZE };
  }

  /** A person retries a skipped or failed lead (for example after fixing the page connection). */
  async retry(restaurantId: string, leadId: string, now = new Date()): Promise<MetaLeadDTO> {
    const lead = await this.prisma.metaLead.findFirst({
      where: { id: leadId, restaurantId },
      select: { status: true },
    });
    if (!lead) throw notFound('LEAD_NOT_FOUND', 'Lead not found');
    if (lead.status === 'IMPORTED') throw conflict('LEAD_NOT_RETRYABLE', 'Lead already imported');
    await this.prisma.metaLead.update({
      where: { id: leadId },
      data: { status: 'RECEIVED', attempts: 0, reason: null, nextAttemptAt: now },
    });
    await this.importLead(leadId, now);
    const row = await this.prisma.metaLead.findUniqueOrThrow({ where: { id: leadId }, include: leadInclude });
    return toDto(row);
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The FORM activity: the form's id and the custom answers, as plain text. */
function activityBody(lead: MappedLead, formId: string | null): string {
  const lines = [`Meta Lead Ads${formId ? ` (${formId})` : ''}`];
  for (const [name, value] of lead.answers) lines.push(`${name}: ${value}`);
  return lines.join('\n').slice(0, ACTIVITY_BODY_MAX);
}

function toDto(
  row: LeadRow & {
    socialAccount: { name: string } | null;
    customer: { user: { fullName: string } } | null;
  },
): MetaLeadDTO {
  return {
    id: row.id,
    leadgenId: row.leadgenId,
    pageName: row.socialAccount?.name ?? null,
    formId: row.formId,
    adId: row.adId,
    status: row.status as MetaLeadStatus,
    attempts: row.attempts,
    reason: row.reason,
    receivedAt: row.receivedAt.toISOString(),
    importedAt: row.importedAt?.toISOString() ?? null,
    customerId: row.customerId,
    contactName: row.customer?.user.fullName ?? null,
  };
}
