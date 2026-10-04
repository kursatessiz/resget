import { z } from 'zod';
import { OrderChannel } from './enums';
import { CONSENT_CHANNELS } from './consent';
import type { CampaignSegment } from './campaigns';

/**
 * Segments v2 (docs/SEGMENTLER.md): a rule tree of AND / OR groups over the
 * contact's fields, saved as a dynamic segment (re-evaluated whenever it is
 * used) or a static one (a snapshot of who matched when it was taken).
 * Values are tenant data; the field and operator vocabulary lives here.
 * Behind the segments_v2 module switch.
 */

export const SEGMENT_FIELDS = {
  orderCount: { type: 'number' },
  lifetimeGrossMinor: { type: 'number' },
  loyaltyPoints: { type: 'number' },
  lastOrderAt: { type: 'days' },
  firstOrderAt: { type: 'days' },
  createdAt: { type: 'days' },
  tags: { type: 'tags' },
  firstChannel: { type: 'enum' },
  consentChannel: { type: 'enum' },
  city: { type: 'text' },
  district: { type: 'text' },
  source: { type: 'text' },
  stageId: { type: 'id' },
  isBusiness: { type: 'boolean' },
  hasEmail: { type: 'boolean' },
} as const satisfies Record<string, { type: SegmentFieldType }>;

export type SegmentFieldType = 'number' | 'days' | 'tags' | 'enum' | 'text' | 'id' | 'boolean';
export type SegmentField = keyof typeof SEGMENT_FIELDS;
export const SEGMENT_FIELD_KEYS = Object.keys(SEGMENT_FIELDS) as SegmentField[];

/** Operators per field type; `within` means "in the last N days", `notWithin` "not in the last N days, or never". */
export const SEGMENT_OPERATORS = {
  number: ['gte', 'lte', 'eq'],
  days: ['within', 'notWithin'],
  tags: ['hasAny', 'hasAll', 'hasNone'],
  enum: ['in', 'notIn'],
  text: ['eq', 'contains'],
  id: ['eq', 'notEq'],
  boolean: ['is'],
} as const satisfies Record<SegmentFieldType, readonly string[]>;

export const ENUM_FIELD_VALUES: Readonly<Record<'firstChannel' | 'consentChannel', readonly string[]>> = {
  firstChannel: Object.values(OrderChannel),
  consentChannel: CONSENT_CHANNELS,
};

export const SEGMENT_MAX_DEPTH = 3;
export const SEGMENT_MAX_CONDITIONS = 20;

const NumberValue = z.number().int().min(0).max(1_000_000_000);
const DaysValue = z.number().int().min(1).max(3650);
const ListValue = z.array(z.string().trim().min(1).max(60)).min(1).max(20);
const TextValue = z.string().trim().min(1).max(80);

export const SegmentConditionSchema = z
  .object({
    field: z.enum(SEGMENT_FIELD_KEYS as [SegmentField, ...SegmentField[]]),
    op: z.string(),
    value: z.union([NumberValue, ListValue, TextValue, z.boolean()]),
  })
  .strict()
  .superRefine((condition, ctx) => {
    const type = SEGMENT_FIELDS[condition.field].type;
    const ops: readonly string[] = SEGMENT_OPERATORS[type];
    if (!ops.includes(condition.op)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['op'], message: 'operator not allowed for this field' });
      return;
    }
    const value = condition.value;
    const ok =
      type === 'number'
        ? NumberValue.safeParse(value).success
        : type === 'days'
          ? DaysValue.safeParse(value).success
          : type === 'tags'
            ? ListValue.safeParse(value).success
            : type === 'enum'
              ? ListValue.safeParse(value).success &&
                (value as string[]).every((v) =>
                  ENUM_FIELD_VALUES[condition.field as 'firstChannel' | 'consentChannel'].includes(v),
                )
              : type === 'boolean'
                ? typeof value === 'boolean'
                : type === 'id'
                  ? z.string().uuid().safeParse(value).success
                  : TextValue.safeParse(value).success;
    if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'value does not fit the field' });
  });
export type SegmentCondition = z.infer<typeof SegmentConditionSchema>;

export interface SegmentGroup {
  op: 'AND' | 'OR';
  rules: (SegmentCondition | SegmentGroup)[];
}

export const SegmentGroupSchema: z.ZodType<SegmentGroup> = z.lazy(() =>
  z
    .object({
      op: z.enum(['AND', 'OR']),
      rules: z.array(z.union([SegmentConditionSchema, SegmentGroupSchema])).max(SEGMENT_MAX_CONDITIONS),
    })
    .strict(),
);

export function isSegmentGroup(rule: SegmentCondition | SegmentGroup): rule is SegmentGroup {
  return 'rules' in rule;
}

export function segmentDepth(group: SegmentGroup): number {
  return 1 + Math.max(0, ...group.rules.filter(isSegmentGroup).map(segmentDepth));
}

export function segmentConditionCount(group: SegmentGroup): number {
  return group.rules.reduce((n, rule) => n + (isSegmentGroup(rule) ? segmentConditionCount(rule) : 1), 0);
}

/** A whole rule: nested at most three levels, at most twenty conditions. An empty group matches everyone. */
export const SegmentRuleSchema = SegmentGroupSchema.refine((g) => segmentDepth(g) <= SEGMENT_MAX_DEPTH, {
  message: 'too deep',
}).refine((g) => segmentConditionCount(g) <= SEGMENT_MAX_CONDITIONS, { message: 'too many conditions' });

/** The first version's flat filters, as a rule, so old campaigns and presets keep meaning the same. */
export function legacySegmentToRule(segment: CampaignSegment): SegmentGroup {
  const rules: SegmentCondition[] = [];
  if (segment.minOrders !== undefined) rules.push({ field: 'orderCount', op: 'gte', value: segment.minOrders });
  if (segment.lastOrderWithinDays !== undefined)
    rules.push({ field: 'lastOrderAt', op: 'within', value: segment.lastOrderWithinDays });
  if (segment.inactiveForDays !== undefined)
    rules.push({ field: 'lastOrderAt', op: 'notWithin', value: segment.inactiveForDays });
  if (segment.tags && segment.tags.length > 0) rules.push({ field: 'tags', op: 'hasAny', value: segment.tags });
  if (segment.firstChannel) rules.push({ field: 'firstChannel', op: 'in', value: [segment.firstChannel] });
  return { op: 'AND', rules };
}

// -- Saved segments --------------------------------------------------------------------

export const SEGMENT_KINDS = ['DYNAMIC', 'STATIC'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export const CreateSegmentSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    kind: z.enum(SEGMENT_KINDS),
    rule: SegmentRuleSchema,
  })
  .strict();
export type CreateSegmentInput = z.infer<typeof CreateSegmentSchema>;

export const UpdateSegmentSchema = z
  .object({ name: z.string().trim().min(2).max(60).optional(), rule: SegmentRuleSchema.optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.rule !== undefined, { message: 'empty update' });
export type UpdateSegmentInput = z.infer<typeof UpdateSegmentSchema>;

export const PreviewSegmentSchema = z.object({ rule: SegmentRuleSchema }).strict();
export type PreviewSegmentInput = z.infer<typeof PreviewSegmentSchema>;

export interface SegmentSampleDTO {
  id: string;
  /** Null when the viewer may not see contact details. */
  fullName: string | null;
  orderCount: number;
  lastOrderAt: string | null;
}

export interface SegmentPreviewDTO {
  count: number;
  /** How many of them a campaign can reach now, per channel (consent v2 aware). */
  reachable: Record<string, number>;
  sample: SegmentSampleDTO[];
}

export interface SegmentDTO {
  id: string;
  name: string;
  kind: SegmentKind;
  rule: SegmentGroup;
  /** Live count for a dynamic segment, snapshot size for a static one. */
  count: number;
  /** When a static segment's members were taken. */
  snapshotAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentListDTO {
  /** The tenant's currency; spend conditions are entered in its major unit and stored in minor units. */
  currency: string;
  items: SegmentDTO[];
}
