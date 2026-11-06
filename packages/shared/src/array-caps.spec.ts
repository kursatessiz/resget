import { z } from 'zod';
import * as shared from './index';
import { OrdersQuerySchema, TripsQuerySchema } from './delivery';
import { SETTLEMENT_LINES_MAX, SettlementInputSchema } from './settlement';
import { GROUP_CART_MAX_LINES, GROUP_CART_MAX_PARTICIPANTS } from './group-orders';

/**
 * zod 3 can exhaust memory validating a very large array whose schema has no
 * length cap (GHSA-mrhx-c7xc-m3w5, fixed only in zod 4). Until the zod 4
 * migration every exported schema caps its arrays; this walks them all.
 */

/** Parsed from the platform's own environment, never from a request. */
const TRUSTED_CONFIG_SCHEMAS = new Set<string>(['ImageHostAllowlistSchema']);

function uncappedArrays(schema: z.ZodTypeAny, path: string, seen: Set<z.ZodTypeAny>, out: string[]): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const walk = (child: z.ZodTypeAny, suffix: string): void => uncappedArrays(child, `${path}${suffix}`, seen, out);
  if (schema instanceof z.ZodArray) {
    if (schema._def.maxLength === null && schema._def.exactLength === null) out.push(path);
    walk(schema.element, '[]');
  } else if (schema instanceof z.ZodObject) {
    for (const [key, value] of Object.entries(schema.shape as z.ZodRawShape)) walk(value, `.${key}`);
    walk(schema._def.catchall, '.*');
  } else if (schema instanceof z.ZodSet) {
    if (schema._def.maxSize === null) out.push(path);
    walk(schema._def.valueType, '<>');
  } else if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly
  ) {
    walk(schema._def.innerType, '');
  } else if (schema instanceof z.ZodEffects) {
    walk(schema._def.schema, '');
  } else if (schema instanceof z.ZodPipeline) {
    walk(schema._def.in, '');
    walk(schema._def.out, '');
  } else if (schema instanceof z.ZodBranded) {
    walk(schema._def.type, '');
  } else if (schema instanceof z.ZodLazy) {
    walk(schema._def.getter(), '');
  } else if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    (schema._def.options as z.ZodTypeAny[]).forEach((option, i) => walk(option, `|${i}`));
  } else if (schema instanceof z.ZodIntersection) {
    walk(schema._def.left, '&');
    walk(schema._def.right, '&');
  } else if (schema instanceof z.ZodTuple) {
    (schema._def.items as z.ZodTypeAny[]).forEach((item, i) => walk(item, `[${i}]`));
    if (schema._def.rest) walk(schema._def.rest, '[...]');
  } else if (schema instanceof z.ZodRecord || schema instanceof z.ZodMap) {
    walk(schema._def.keyType, '{key}');
    walk(schema._def.valueType, '{value}');
  }
}

describe('array length caps (GHSA-mrhx-c7xc-m3w5)', () => {
  const exported = Object.entries(shared).filter(
    (entry): entry is [string, z.ZodTypeAny] => entry[1] instanceof z.ZodType,
  );

  it('finds the exported schemas', () => {
    expect(exported.length).toBeGreaterThan(100);
  });

  it('caps every array in every exported schema', () => {
    const offenders: string[] = [];
    for (const [name, schema] of exported) {
      if (!TRUSTED_CONFIG_SCHEMAS.has(name)) uncappedArrays(schema, name, new Set(), offenders);
    }
    expect(offenders).toEqual([]);
  });

  it('reports an uncapped array, so the walk is not vacuous', () => {
    const offenders: string[] = [];
    const probe = z.object({ a: z.array(z.string()).optional(), b: z.lazy(() => z.array(z.number()).max(2)) });
    uncappedArrays(probe, 'probe', new Set(), offenders);
    expect(offenders).toEqual(['probe.a']);
  });

  it('caps order and trip status filters at the number of statuses', () => {
    const statuses = OrdersQuerySchema.shape.status.unwrap().element.options;
    expect(OrdersQuerySchema.safeParse({ status: [...statuses] }).success).toBe(true);
    expect(OrdersQuerySchema.safeParse({ status: [...statuses, statuses[0]] }).success).toBe(false);
    const tripStatuses = Object.values(shared.DeliveryTripStatus);
    expect(TripsQuerySchema.safeParse({ status: tripStatuses }).success).toBe(true);
    expect(TripsQuerySchema.safeParse({ status: [...tripStatuses, tripStatuses[0]] }).success).toBe(false);
  });

  it('leaves room in a settlement for the largest merged group order', () => {
    expect(SETTLEMENT_LINES_MAX).toBeGreaterThanOrEqual(GROUP_CART_MAX_PARTICIPANTS * GROUP_CART_MAX_LINES);
    const line = { amountMinor: 100, vatRateBps: 1000 };
    const input = (count: number) => ({
      currency: 'EUR',
      items: Array.from({ length: count }, () => line),
      psp: { percentBps: 0 },
    });
    expect(SettlementInputSchema.safeParse(input(SETTLEMENT_LINES_MAX)).success).toBe(true);
    expect(SettlementInputSchema.safeParse(input(SETTLEMENT_LINES_MAX + 1)).success).toBe(false);
  });
});
