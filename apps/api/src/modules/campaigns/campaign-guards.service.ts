import { Injectable } from '@nestjs/common';
import type { Prisma } from '@resget/database';
import { SEND_LIMIT_WINDOW_HOURS, sendLimitBlock } from '@resget/shared';
import type { CampaignApprovalDTO, SendLimitBlock, SendLimitDTO, UpdateSendLimitInput } from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** The approval fields of a campaign row, with the names of the people involved. */
export interface ApprovalFields {
  approvalStatus: CampaignApprovalDTO['status'];
  approvalRequestedAt: Date | null;
  approvalDecidedAt: Date | null;
  approvalNote: string | null;
  approvalRequestedBy: { fullName: string } | null;
  approvalDecidedBy: { fullName: string } | null;
}

export interface LimitCheck {
  limit: Pick<SendLimitDTO, 'maxPerCampaign' | 'maxPerDay'> | null;
  usedLast24h: number;
  block: SendLimitBlock | null;
}

/** Fields that put a campaign back to "no approval". */
export const APPROVAL_RESET = {
  approvalStatus: 'NONE',
  approvalRequestedByUserId: null,
  approvalRequestedAt: null,
  approvalDecidedByUserId: null,
  approvalDecidedAt: null,
  approvalNote: null,
} as const satisfies Prisma.CampaignUpdateInput | Prisma.CampaignUncheckedUpdateInput;

/**
 * Send approvals and limits (docs/ONAYLAR.md), shared by the campaign
 * service, its runner and the console. Both apply while the tenant's
 * marketing_approvals module is on; the audit trail is written always.
 */
@Injectable()
export class CampaignGuardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  approvalsOn(restaurantId: string): Promise<boolean> {
    return this.features.isEnabled('marketing_approvals', restaurantId);
  }

  /** Recipients of the tenant's campaigns started in the last 24 hours. */
  async usedLast24h(restaurantId: string, now: Date): Promise<number> {
    const since = new Date(now.getTime() - SEND_LIMIT_WINDOW_HOURS * 3_600_000);
    const sum = await this.prisma.campaign.aggregate({
      where: { restaurantId, startedAt: { gte: since } },
      _sum: { audienceCount: true },
    });
    return sum._sum.audienceCount ?? 0;
  }

  /** The limit a campaign of this size would break now; no limit applies while the module is off. */
  async check(restaurantId: string, audienceCount: number, now: Date): Promise<LimitCheck> {
    const usedLast24h = await this.usedLast24h(restaurantId, now);
    if (!(await this.approvalsOn(restaurantId))) return { limit: null, usedLast24h, block: null };
    const row = await this.prisma.campaignSendLimit.findUnique({ where: { restaurantId } });
    const limit = row ? { maxPerCampaign: row.maxPerCampaign, maxPerDay: row.maxPerDay } : null;
    return { limit, usedLast24h, block: sendLimitBlock(limit, audienceCount, usedLast24h) };
  }

  approvalDto(row: ApprovalFields): CampaignApprovalDTO {
    return {
      status: row.approvalStatus,
      requestedBy: row.approvalRequestedBy?.fullName ?? null,
      requestedAt: row.approvalRequestedAt?.toISOString() ?? null,
      decidedBy: row.approvalDecidedBy?.fullName ?? null,
      decidedAt: row.approvalDecidedAt?.toISOString() ?? null,
      note: row.approvalNote,
    };
  }

  async audit(
    db: Db,
    restaurantId: string,
    actorUserId: string | null,
    action: string,
    campaignId: string,
    meta?: Prisma.InputJsonObject,
  ): Promise<void> {
    await db.auditLog.create({
      data: { restaurantId, actorUserId, action, entity: 'campaign', entityId: campaignId, ...(meta ? { meta } : {}) },
    });
  }

  // -- Console -------------------------------------------------------------------------------

  async limitOf(restaurantId: string, now: Date): Promise<SendLimitDTO> {
    const [row, usedLast24h] = await Promise.all([
      this.prisma.campaignSendLimit.findUnique({ where: { restaurantId } }),
      this.usedLast24h(restaurantId, now),
    ]);
    return {
      restaurantId,
      maxPerCampaign: row?.maxPerCampaign ?? null,
      maxPerDay: row?.maxPerDay ?? null,
      usedLast24h,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async setLimit(
    restaurantId: string,
    actorUserId: string,
    input: UpdateSendLimitInput,
    now: Date,
  ): Promise<SendLimitDTO> {
    await this.prisma.$transaction(async (tx) => {
      await tx.campaignSendLimit.upsert({
        where: { restaurantId },
        create: { restaurantId, ...input, updatedByUserId: actorUserId },
        update: { ...input, updatedByUserId: actorUserId },
      });
      await tx.auditLog.create({
        data: {
          restaurantId,
          actorUserId,
          action: 'send_limit.update',
          entity: 'campaign_send_limit',
          entityId: restaurantId,
          meta: { maxPerCampaign: input.maxPerCampaign, maxPerDay: input.maxPerDay },
        },
      });
    });
    return this.limitOf(restaurantId, now);
  }
}
