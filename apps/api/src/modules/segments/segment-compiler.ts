import type { Prisma } from '@resget/database';
import { OrderChannel } from '@resget/shared';
import { isSegmentGroup } from '@resget/shared';
import type { SegmentCondition, SegmentGroup } from '@resget/shared';

type Where = Prisma.RestaurantCustomerWhereInput;

const DAY_MS = 86_400_000;

function asList(value: SegmentCondition['value']): string[] {
  return Array.isArray(value) ? value : [];
}

function cutoff(now: Date, days: SegmentCondition['value']): Date {
  return new Date(now.getTime() - Number(days) * DAY_MS);
}

/** One condition as a Prisma filter; "not" forms include contacts without a value, as people read them. */
export function compileCondition(condition: SegmentCondition, now: Date): Where {
  const { field, op, value } = condition;
  switch (field) {
    case 'orderCount':
    case 'lifetimeGrossMinor':
    case 'loyaltyPoints': {
      const n = Number(value);
      return { [field]: op === 'gte' ? { gte: n } : op === 'lte' ? { lte: n } : n };
    }
    case 'lastOrderAt':
    case 'firstOrderAt':
    case 'createdAt': {
      const since = cutoff(now, value);
      if (op === 'within') return { [field]: { gte: since } };
      return field === 'createdAt'
        ? { createdAt: { lt: since } }
        : { OR: [{ [field]: null }, { [field]: { lt: since } }] };
    }
    case 'tags': {
      const tags = asList(value);
      if (op === 'hasAll') return { tags: { hasEvery: tags } };
      if (op === 'hasNone') return { NOT: { tags: { hasSome: tags } } };
      return { tags: { hasSome: tags } };
    }
    case 'firstChannel': {
      const channels = asList(value).filter((v): v is OrderChannel =>
        (Object.values(OrderChannel) as string[]).includes(v),
      );
      return op === 'in'
        ? { firstChannel: { in: channels } }
        : { OR: [{ firstChannel: null }, { firstChannel: { notIn: channels } }] };
    }
    case 'consentChannel': {
      const channels = asList(value);
      return op === 'in'
        ? { consentChannels: { hasSome: channels } }
        : { NOT: { consentChannels: { hasSome: channels } } };
    }
    case 'city':
    case 'district':
    case 'source': {
      const text = String(value);
      return op === 'eq'
        ? { [field]: { equals: text, mode: 'insensitive' } }
        : { [field]: { contains: text, mode: 'insensitive' } };
    }
    case 'stageId':
      return op === 'eq'
        ? { stageId: String(value) }
        : { OR: [{ stageId: null }, { stageId: { not: String(value) } }] };
    case 'isBusiness':
      return { isBusiness: value === true };
    case 'hasEmail':
      return value === true
        ? { AND: [{ email: { not: null } }, { NOT: { email: '' } }] }
        : { OR: [{ email: null }, { email: '' }] };
  }
}

/** A whole rule; an empty group matches everyone. */
export function compileGroup(group: SegmentGroup, now: Date): Where {
  const parts = group.rules.map((rule) =>
    isSegmentGroup(rule) ? compileGroup(rule, now) : compileCondition(rule, now),
  );
  if (parts.length === 0) return {};
  return group.op === 'AND' ? { AND: parts } : { OR: parts };
}

/** The tenant's live contacts matching the rule. */
export function segmentWhere(restaurantId: string, group: SegmentGroup, now: Date): Where {
  return { AND: [{ restaurantId, user: { deletedAt: null } }, compileGroup(group, now)] };
}
