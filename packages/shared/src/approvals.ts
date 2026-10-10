import { z } from 'zod';

/**
 * Send approvals, send limits and the audit viewer (docs/ONAYLAR.md).
 *
 * Approvals (module marketing_approvals, per tenant; meant for the platform
 * tenant first): a campaign is sent only after someone holding
 * campaigns.approve, other than the person who asked, approved its current
 * content. Any edit takes the approval back. Automated flows follow the same
 * rule: an active flow sends only while someone other than its last editor
 * has approved its content. Limits cap how many recipients one campaign and
 * the last 24 hours (campaigns and flow messages together) may reach; the
 * console sets them; flows are open-ended, so only the 24-hour limit holds
 * them. The
 * audit viewer (module audit_viewer, console) reads the audit log.
 */

export const CAMPAIGN_APPROVAL_STATUSES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type CampaignApprovalStatus = (typeof CAMPAIGN_APPROVAL_STATUSES)[number];

export const RejectCampaignSchema = z.object({ note: z.string().trim().min(2).max(500) }).strict();
export type RejectCampaignInput = z.infer<typeof RejectCampaignSchema>;

export interface CampaignApprovalDTO {
  status: CampaignApprovalStatus;
  requestedBy: string | null;
  requestedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** The reason given with a rejection. */
  note: string | null;
}

// -- Send limits -------------------------------------------------------------------------------

export const SEND_LIMIT_MAX = 10_000_000;
/** The daily limit is a rolling window, so it never resets at a midnight in some time zone. */
export const SEND_LIMIT_WINDOW_HOURS = 24;

const LimitValue = z.number().int().min(1).max(SEND_LIMIT_MAX).nullable();

export const UpdateSendLimitSchema = z
  .object({
    /** Most recipients a single campaign may have; null for no limit. */
    maxPerCampaign: LimitValue,
    /** Most recipients the tenant's campaigns and flows may reach in the last 24 hours; null for no limit. */
    maxPerDay: LimitValue,
  })
  .strict();
export type UpdateSendLimitInput = z.infer<typeof UpdateSendLimitSchema>;

export interface SendLimitDTO {
  restaurantId: string;
  maxPerCampaign: number | null;
  maxPerDay: number | null;
  /** Recipients of campaigns started and flow messages sent in the last 24 hours. */
  usedLast24h: number;
  updatedAt: string | null;
}

export type SendLimitBlock = 'PER_CAMPAIGN' | 'PER_DAY';

/** Which limit a campaign of this size would break now, if any. */
export function sendLimitBlock(
  limit: Pick<SendLimitDTO, 'maxPerCampaign' | 'maxPerDay'> | null,
  audienceCount: number,
  usedLast24h: number,
): SendLimitBlock | null {
  if (!limit) return null;
  if (limit.maxPerCampaign !== null && audienceCount > limit.maxPerCampaign) return 'PER_CAMPAIGN';
  if (limit.maxPerDay !== null && usedLast24h + audienceCount > limit.maxPerDay) return 'PER_DAY';
  return null;
}

/** What the campaign preview shows about approvals and limits. */
export interface CampaignGuardsDTO {
  approvalRequired: boolean;
  approval: CampaignApprovalDTO;
  limit: Pick<SendLimitDTO, 'maxPerCampaign' | 'maxPerDay' | 'usedLast24h'> | null;
  limitBlock: SendLimitBlock | null;
}

// -- Audit viewer ------------------------------------------------------------------------------

export const AUDIT_PAGE_SIZE = 50;
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const AuditQuerySchema = z
  .object({
    /** A restaurant's slug; the platform tenant's slug narrows to platform actions. */
    restaurant: z.string().trim().min(1).max(80).optional(),
    /** Action prefix, such as "campaign." or "platform.user". */
    action: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9_.]+$/, 'action prefix')
      .optional(),
    /** First and last day, inclusive, in UTC. */
    from: DateOnly.optional(),
    to: DateOnly.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export interface AuditEntryDTO {
  id: string;
  createdAt: string;
  action: string;
  entity: string;
  entityId: string | null;
  restaurant: { id: string; name: string; slug: string } | null;
  actor: { id: string; fullName: string } | null;
  /** The entry's details as compact JSON text; rendered as plain text, never as HTML. */
  meta: string | null;
}

export interface AuditPageDTO {
  items: AuditEntryDTO[];
  total: number;
  page: number;
  pageSize: number;
}
