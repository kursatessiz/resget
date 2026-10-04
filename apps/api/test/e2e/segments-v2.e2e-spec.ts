import { normalizePhone } from '@resget/shared';
import type { CampaignDTO, CampaignPreviewDTO, SegmentDTO, SegmentListDTO, SegmentPreviewDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const DAY_MS = 86_400_000;
const MARK = 'seg-e2e';
const PHONES = ['05329990961', '05329990962', '05329990963'].map((p) => normalizePhone(p)!);
const mark = { field: 'tags', op: 'hasAny', value: [MARK] } as const;

/** Segments v2 (docs/SEGMENTLER.md): rule language, preview, dynamic and static segments, campaign targeting. */
describe('Segments v2 (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  const customerIds: string[] = [];
  const base = () => `/restaurants/${restaurantId}/segments`;
  const auth = () => bearer(ownerToken, restaurantId);
  const preview = async (rule: unknown) =>
    (await ctx.http().post(`${base()}/preview`).set(auth()).send({ rule }).expect(200)).body as SegmentPreviewDTO;

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const now = Date.now();
    const people = [
      {
        fullName: 'Segment Bir',
        orderCount: 5,
        tags: [MARK, 'vip'],
        district: 'Moda',
        consentChannels: ['SMS'],
        lastOrderAt: new Date(now - 3 * DAY_MS),
      },
      {
        fullName: 'Segment Iki',
        orderCount: 1,
        tags: [MARK],
        district: 'Bostanci',
        consentChannels: ['SMS', 'WHATSAPP'],
        lastOrderAt: new Date(now - 60 * DAY_MS),
      },
      {
        fullName: 'Segment Uc',
        orderCount: 0,
        tags: [MARK],
        isBusiness: true,
        email: 'segment.uc@ornek.test',
        consentChannels: [],
        lastOrderAt: null,
      },
    ];
    for (const [i, person] of people.entries()) {
      const { fullName, ...fields } = person;
      const user = await ctx.prisma.user.create({ data: { phone: PHONES[i], fullName } });
      const customer = await ctx.prisma.restaurantCustomer.create({
        data: { restaurantId, userId: user.id, ...fields },
        select: { id: true },
      });
      customerIds.push(customer.id);
    }
  });

  afterAll(async () => {
    await ctx.prisma.campaign.deleteMany({ where: { restaurantId, name: { startsWith: 'Segment kampanya' } } });
    await ctx.prisma.segment.deleteMany({ where: { restaurantId, name: { startsWith: 'E2E ' } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { id: { in: customerIds } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'segments_v2' } });
    await ctx.close();
  });

  it('is behind its switch', async () => {
    await ctx.http().get(base()).set(auth()).expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/segments_v2`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    const list = (await ctx.http().get(base()).set(auth()).expect(200)).body as SegmentListDTO;
    expect(list.currency).toMatch(/^[A-Z]{3}$/);
  });

  it('evaluates nested AND / OR rules and counts reach per channel', async () => {
    const either = await preview({
      op: 'AND',
      rules: [
        mark,
        {
          op: 'OR',
          rules: [
            { field: 'orderCount', op: 'gte', value: 3 },
            { field: 'district', op: 'eq', value: 'bostanci' },
          ],
        },
      ],
    });
    expect(either.count).toBe(2);
    expect(either.reachable.SMS).toBe(2);
    expect(either.reachable.WHATSAPP).toBe(1);
    expect(either.reachable.EMAIL).toBe(0);
    expect(either.sample.map((s) => s.fullName).sort()).toEqual(['Segment Bir', 'Segment Iki']);

    // "Not in the last 30 days" includes those who never ordered.
    const lapsed = await preview({ op: 'AND', rules: [mark, { field: 'lastOrderAt', op: 'notWithin', value: 30 }] });
    expect(lapsed.count).toBe(2);
    const recent = await preview({ op: 'AND', rules: [mark, { field: 'lastOrderAt', op: 'within', value: 30 }] });
    expect(recent.count).toBe(1);

    const business = await preview({
      op: 'AND',
      rules: [mark, { field: 'isBusiness', op: 'is', value: true }, { field: 'hasEmail', op: 'is', value: true }],
    });
    expect(business.count).toBe(1);

    const tags = await preview({
      op: 'AND',
      rules: [{ field: 'tags', op: 'hasAll', value: [MARK, 'vip'] }],
    });
    expect(tags.count).toBe(1);
    const noVip = await preview({ op: 'AND', rules: [mark, { field: 'tags', op: 'hasNone', value: ['vip'] }] });
    expect(noVip.count).toBe(2);

    const consented = await preview({
      op: 'AND',
      rules: [mark, { field: 'consentChannel', op: 'notIn', value: ['SMS'] }],
    });
    expect(consented.count).toBe(1);
  });

  it('rejects rules that do not fit the language', async () => {
    const reject = (rule: unknown) => ctx.http().post(`${base()}/preview`).set(auth()).send({ rule }).expect(400);
    await reject({ op: 'AND', rules: [{ field: 'orderCount', op: 'contains', value: 3 }] });
    await reject({ op: 'AND', rules: [{ field: 'firstChannel', op: 'in', value: ['FAX'] }] });
    await reject({ op: 'AND', rules: [{ field: 'nope', op: 'eq', value: 1 }] });
    await reject({
      op: 'AND',
      rules: [{ op: 'OR', rules: [{ op: 'AND', rules: [{ op: 'OR', rules: [mark] }] }] }],
    });
    await reject({ op: 'AND', rules: Array.from({ length: 21 }, () => mark) });
  });

  it('keeps a dynamic segment live and a static one fixed until its snapshot is retaken', async () => {
    const rule = { op: 'AND', rules: [mark, { field: 'orderCount', op: 'gte', value: 3 }] };
    const dynamic = (
      await ctx.http().post(base()).set(auth()).send({ name: 'E2E dinamik', kind: 'DYNAMIC', rule }).expect(201)
    ).body as SegmentDTO;
    const fixed = (
      await ctx.http().post(base()).set(auth()).send({ name: 'E2E statik', kind: 'STATIC', rule }).expect(201)
    ).body as SegmentDTO;
    expect(dynamic.count).toBe(1);
    expect(dynamic.snapshotAt).toBeNull();
    expect(fixed.count).toBe(1);
    expect(fixed.snapshotAt).not.toBeNull();

    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ name: 'E2E dinamik', kind: 'DYNAMIC', rule })
      .expect(409)
      .expect('x-error-code', 'SEGMENT_NAME_TAKEN');

    await ctx.prisma.restaurantCustomer.update({ where: { id: customerIds[2] }, data: { orderCount: 4 } });
    const get = async (id: string) =>
      (await ctx.http().get(`${base()}/${id}`).set(auth()).expect(200)).body as SegmentDTO;
    expect((await get(dynamic.id)).count).toBe(2);
    expect((await get(fixed.id)).count).toBe(1);

    const retaken = (await ctx.http().post(`${base()}/${fixed.id}/snapshot`).set(auth()).expect(200))
      .body as SegmentDTO;
    expect(retaken.count).toBe(2);
    await ctx
      .http()
      .post(`${base()}/${dynamic.id}/snapshot`)
      .set(auth())
      .expect(409)
      .expect('x-error-code', 'SEGMENT_NOT_STATIC');

    // A new rule on a static segment takes a new snapshot.
    const renamed = (
      await ctx
        .http()
        .patch(`${base()}/${fixed.id}`)
        .set(auth())
        .send({
          name: 'E2E statik iki',
          rule: { op: 'AND', rules: [mark, { field: 'orderCount', op: 'gte', value: 5 }] },
        })
        .expect(200)
    ).body as SegmentDTO;
    expect(renamed.name).toBe('E2E statik iki');
    expect(renamed.count).toBe(1);
    await ctx.prisma.restaurantCustomer.update({ where: { id: customerIds[2] }, data: { orderCount: 0 } });
  });

  it('targets a campaign at a saved segment and guards the segment while the campaign is pending', async () => {
    const list = (await ctx.http().get(base()).set(auth()).expect(200)).body as SegmentListDTO;
    const dynamic = list.items.find((s) => s.name === 'E2E dinamik')!;
    // Widen the dynamic segment to all three marked contacts; only the SMS-consented ones are reached.
    await ctx
      .http()
      .patch(`${base()}/${dynamic.id}`)
      .set(auth())
      .send({ rule: { op: 'AND', rules: [mark] } })
      .expect(200);

    const campaign = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/campaigns`)
        .set(auth())
        .send({ name: 'Segment kampanya', channel: 'SMS', body: 'Hafta sonu indirimi', segmentId: dynamic.id })
        .expect(201)
    ).body as CampaignDTO;
    expect(campaign.segmentId).toBe(dynamic.id);
    const summary = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/campaigns/${campaign.id}/preview`)
        .set(auth())
        .send({})
        .expect(200)
    ).body as CampaignPreviewDTO;
    expect(summary.audienceCount).toBe(2);

    await ctx.http().delete(`${base()}/${dynamic.id}`).set(auth()).expect(409).expect('x-error-code', 'SEGMENT_IN_USE');
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/${campaign.id}/cancel`)
      .set(auth())
      .send({})
      .expect(200);
    await ctx.http().delete(`${base()}/${dynamic.id}`).set(auth()).expect(204);

    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns`)
      .set(auth())
      .send({
        name: 'Segment kampanya yok',
        channel: 'SMS',
        body: 'Hafta sonu indirimi',
        segmentId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(404)
      .expect('x-error-code', 'SEGMENT_NOT_FOUND');
  });
});
