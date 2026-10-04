import { OrderChannel } from './enums';
import {
  CreateSegmentSchema,
  SEGMENT_FIELDS,
  SEGMENT_FIELD_KEYS,
  SEGMENT_OPERATORS,
  SegmentConditionSchema,
  SegmentRuleSchema,
  UpdateSegmentSchema,
  legacySegmentToRule,
  segmentConditionCount,
  segmentDepth,
} from './segments';
import type { SegmentGroup } from './segments';

const cond = { field: 'orderCount', op: 'gte', value: 2 } as const;

describe('segment conditions', () => {
  it('has operators for every field type', () => {
    for (const field of SEGMENT_FIELD_KEYS) {
      expect(SEGMENT_OPERATORS[SEGMENT_FIELDS[field].type].length).toBeGreaterThan(0);
    }
  });

  it('accepts values that fit the field and refuses the rest', () => {
    expect(SegmentConditionSchema.safeParse(cond).success).toBe(true);
    expect(SegmentConditionSchema.safeParse({ field: 'lastOrderAt', op: 'within', value: 30 }).success).toBe(true);
    expect(SegmentConditionSchema.safeParse({ field: 'lastOrderAt', op: 'within', value: 0 }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ field: 'orderCount', op: 'within', value: 3 }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ field: 'orderCount', op: 'gte', value: -1 }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ field: 'orderCount', op: 'gte', value: 1.5 }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ field: 'tags', op: 'hasAny', value: [] }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ field: 'tags', op: 'hasAny', value: ['vip'] }).success).toBe(true);
    expect(SegmentConditionSchema.safeParse({ field: 'firstChannel', op: 'in', value: ['TABLE_QR'] }).success).toBe(
      true,
    );
    expect(SegmentConditionSchema.safeParse({ field: 'firstChannel', op: 'in', value: ['FAX'] }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ field: 'consentChannel', op: 'in', value: ['EMAIL'] }).success).toBe(
      true,
    );
    expect(SegmentConditionSchema.safeParse({ field: 'isBusiness', op: 'is', value: 'yes' }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ field: 'stageId', op: 'eq', value: 'not-a-uuid' }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ field: 'district', op: 'contains', value: '' }).success).toBe(false);
    expect(SegmentConditionSchema.safeParse({ ...cond, extra: 1 }).success).toBe(false);
  });
});

describe('segment rules', () => {
  const nest = (levels: number): SegmentGroup =>
    levels <= 1 ? { op: 'AND', rules: [cond] } : { op: 'OR', rules: [cond, nest(levels - 1)] };

  it('measures depth and size', () => {
    expect(segmentDepth({ op: 'AND', rules: [] })).toBe(1);
    expect(segmentDepth(nest(3))).toBe(3);
    expect(segmentConditionCount(nest(3))).toBe(3);
  });

  it('allows three levels and twenty conditions, an empty group included', () => {
    expect(SegmentRuleSchema.safeParse({ op: 'AND', rules: [] }).success).toBe(true);
    expect(SegmentRuleSchema.safeParse(nest(3)).success).toBe(true);
    expect(SegmentRuleSchema.safeParse(nest(4)).success).toBe(false);
    const wide = (n: number) => ({
      op: 'AND',
      rules: [{ op: 'OR', rules: Array.from({ length: n }, () => cond) }, cond],
    });
    expect(SegmentRuleSchema.safeParse(wide(19)).success).toBe(true);
    expect(SegmentRuleSchema.safeParse(wide(20)).success).toBe(false);
  });

  it('validates saved segment inputs', () => {
    expect(CreateSegmentSchema.safeParse({ name: 'Sadik', kind: 'STATIC', rule: nest(1) }).success).toBe(true);
    expect(CreateSegmentSchema.safeParse({ name: 'S', kind: 'STATIC', rule: nest(1) }).success).toBe(false);
    expect(CreateSegmentSchema.safeParse({ name: 'Sadik', kind: 'LIVE', rule: nest(1) }).success).toBe(false);
    expect(UpdateSegmentSchema.safeParse({}).success).toBe(false);
    expect(UpdateSegmentSchema.safeParse({ name: 'Yeni ad' }).success).toBe(true);
  });

  it('turns the first version filters into an equivalent rule', () => {
    const rule = legacySegmentToRule({
      minOrders: 2,
      lastOrderWithinDays: 30,
      inactiveForDays: 90,
      tags: ['vip'],
      firstChannel: OrderChannel.TABLE_QR,
    });
    expect(rule).toEqual({
      op: 'AND',
      rules: [
        { field: 'orderCount', op: 'gte', value: 2 },
        { field: 'lastOrderAt', op: 'within', value: 30 },
        { field: 'lastOrderAt', op: 'notWithin', value: 90 },
        { field: 'tags', op: 'hasAny', value: ['vip'] },
        { field: 'firstChannel', op: 'in', value: ['TABLE_QR'] },
      ],
    });
    expect(SegmentRuleSchema.safeParse(rule).success).toBe(true);
    expect(legacySegmentToRule({})).toEqual({ op: 'AND', rules: [] });
  });
});
