import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';

const PROSPECT_PHONE = normalizePhone('05329990971')!;
const COURIER_PHONE = normalizePhone('05320000004')!;

/** CRM core (docs/CRM.md): prospects, pipeline, activities, tasks, export, platform funnel. */
describe('CRM core (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let courierToken: string;
  let restaurantId: string;

  const owner = () => bearer(ownerToken, restaurantId);
  const setSwitch = (enabled: boolean | null) =>
    ctx.http().put('/admin/features/contacts_crm').set(bearer(adminToken)).send({ enabled }).expect(200);

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken, courierToken] = await Promise.all([
      ctx.login(SEED.superAdminPhone),
      ctx.login(SEED.ownerPhone),
      ctx.login(COURIER_PHONE),
    ]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, user: { phone: PROSPECT_PHONE } } });
    await ctx.prisma.pipelineStage.deleteMany({ where: { restaurantId } });
  });

  afterAll(async () => {
    await ctx.prisma.featureFlag.deleteMany({ where: { key: { in: ['contacts_crm', 'marketing_platform'] } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, user: { phone: PROSPECT_PHONE } } });
    await ctx.prisma.pipelineStage.deleteMany({ where: { restaurantId } });
    await deleteTestRestaurants(ctx.prisma, { isPlatform: true });
    await ctx.close();
  });

  it('ships switched off', async () => {
    const refused = await ctx.http().get(`/restaurants/${restaurantId}/crm/pipeline`).set(owner()).expect(403);
    expect(refused.body.code).toBe('FEATURE_DISABLED');
  });

  it('adds a prospect to the pipeline, moves it and keeps the history', async () => {
    await setSwitch(true);
    const pipeline = await ctx.http().get(`/restaurants/${restaurantId}/crm/pipeline`).set(owner()).expect(200);
    const stages = pipeline.body.stages as { id: string; key: string }[];
    expect(stages.map((s) => s.key)).toEqual(['new', 'contacted', 'won', 'lost']);

    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/crm/contacts`)
      .set(owner())
      .send({
        fullName: 'Kurumsal Aday',
        phone: '05329990971',
        email: 'aday@example.com',
        company: 'Moda Ofis',
        source: 'fuar',
        stageId: stages[0].id,
      })
      .expect(201);
    const contactId = created.body.id as string;
    expect(created.body).toMatchObject({ company: 'Moda Ofis', stageId: stages[0].id, orderCount: 0, openTasks: 0 });
    const duplicate = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/crm/contacts`)
      .set(owner())
      .send({ fullName: 'Kurumsal Aday', phone: '05329990971' })
      .expect(409);
    expect(duplicate.body.code).toBe('CONTACT_EXISTS');

    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/crm/contacts/${contactId}`)
      .set(owner())
      .send({ stageId: stages[1].id })
      .expect(200);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/crm/contacts/${contactId}/activities`)
      .set(owner())
      .send({ type: 'CALL', body: 'Menu ve fiyat konusuldu' })
      .expect(204);

    const ownerMembership = await ctx.prisma.membership.findFirstOrThrow({
      where: { restaurantId, roleTemplate: { isOwner: true } },
      select: { id: true },
    });
    const task = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/crm/contacts/${contactId}/tasks`)
      .set(owner())
      .send({
        title: 'Teklif gonder',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        assigneeMembershipId: ownerMembership.id,
      })
      .expect(201);
    const mine = await ctx.http().get(`/restaurants/${restaurantId}/crm/tasks?mine=true`).set(owner()).expect(200);
    expect((mine.body as { id: string }[]).map((t) => t.id)).toContain(task.body.id);
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/crm/tasks/${task.body.id}`)
      .set(owner())
      .send({ done: true })
      .expect(200);

    const detail = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/crm/contacts/${contactId}`)
      .set(owner())
      .expect(200);
    expect((detail.body.activities as { type: string }[]).map((a) => a.type)).toEqual([
      'TASK_DONE',
      'CALL',
      'STAGE_CHANGE',
    ]);
    expect(detail.body.contact.stageId).toBe(stages[1].id);
    expect(detail.body.tasks[0].doneAt).not.toBeNull();

    const after = await ctx.http().get(`/restaurants/${restaurantId}/crm/pipeline`).set(owner()).expect(200);
    expect((after.body.contacts[stages[1].id] as { id: string }[]).map((c) => c.id)).toContain(contactId);
  });

  it('exports contacts with phones only for those who may see them, and keeps couriers out', async () => {
    const csv = await ctx.http().get(`/restaurants/${restaurantId}/crm/export.csv`).set(owner()).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'fullName,phone,email,company,city,district,source,stage,orderCount,marketingOptIn,createdAt',
    );
    expect(lines.some((l) => l.includes(PROSPECT_PHONE) && l.includes('Moda Ofis'))).toBe(true);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/crm/pipeline`)
      .set(bearer(courierToken, restaurantId))
      .expect(403);
  });

  it('gives the platform tenant the restaurant-owner funnel', async () => {
    await ctx
      .http()
      .put('/admin/features/marketing_platform')
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    const setup = await ctx
      .http()
      .post('/admin/platform/setup')
      .set(bearer(adminToken))
      .send({ name: 'Platform', countryCode: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul', defaultLocale: 'tr' })
      .expect(200);
    const platformId = setup.body.tenant.id as string;
    const pipeline = await ctx
      .http()
      .get(`/restaurants/${platformId}/crm/pipeline`)
      .set(bearer(adminToken, platformId))
      .expect(200);
    expect((pipeline.body.stages as { key: string }[]).map((s) => s.key)).toEqual([
      'lead',
      'contacted',
      'demo',
      'onboarding',
      'live',
      'lost',
    ]);
    await setSwitch(null);
  });
});
