import './support/ai-mock';
import type { AiBudgetDTO, AiDraftResultDTO } from '@resget/shared';
import { REDACTION_MARK } from '@resget/shared';
import { AI_PROVIDER } from '../../src/modules/ai-studio/ai-provider';
import type { MockAiProvider } from '../../src/modules/ai-studio/mock-ai.provider';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** AI studio (docs/YAPAY_ZEKA.md): switch, drafts only, no personal data to the model, usage without content, budget. */
describe('AI studio (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let restaurantName: string;
  let provider: MockAiProvider;
  const owner = () => bearer(ownerToken, restaurantId);
  const base = () => `/restaurants/${restaurantId}/ai`;
  const campaignDraft = (body: object) => ctx.http().post(`${base()}/campaign-drafts`).set(owner()).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, name: true },
    });
    restaurantId = restaurant.id;
    restaurantName = restaurant.name;
    provider = ctx.app.get<MockAiProvider>(AI_PROVIDER);
    await ctx.prisma.aiUsage.deleteMany({ where: { restaurantId } });
  });

  afterAll(async () => {
    await ctx.prisma.aiUsage.deleteMany({ where: { restaurantId } });
    await ctx.prisma.aiBudget.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'ai_studio' } });
    await ctx.prisma.auditLog.deleteMany({ where: { action: 'ai_budget.update', entityId: restaurantId } });
    await ctx.close();
  });

  it('is behind its switch', async () => {
    await campaignDraft({ brief: 'Yeni menu tanitimi', channel: 'SMS', locale: 'tr' })
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/ai_studio`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
  });

  it('drafts campaign messages without sending personal data to the model', async () => {
    const result = (
      await campaignDraft({
        brief: 'Hafta sonu pizza kampanyasi; sorular icin 0532 111 22 33 veya kampanya@ornek.com',
        channel: 'SMS',
        tone: 'PLAYFUL',
        locale: 'tr',
        variants: 2,
      }).expect(200)
    ).body as AiDraftResultDTO;
    expect(result.kind).toBe('CAMPAIGN_MESSAGE');
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.every((d) => d.subject === null && d.body.length > 0)).toBe(true);
    expect(result.redactions).toBe(2);
    expect(result.budget.usedThisMonth).toBeGreaterThan(0);

    const sent = provider.seen[provider.seen.length - 1];
    expect(sent.prompt).toContain(REDACTION_MARK);
    expect(sent.prompt).not.toContain('0532');
    expect(sent.prompt).not.toContain('@ornek.com');
    expect(sent.prompt).toContain(restaurantName);
    expect(sent.system).toContain('no emoji');

    // Only tokens are kept: no column holds the brief or the drafts.
    const usage = await ctx.prisma.aiUsage.findMany({ where: { restaurantId } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ kind: 'CAMPAIGN_MESSAGE', model: 'mock', redactions: 2 });
    expect(JSON.stringify(usage[0])).not.toContain('pizza');

    // Nothing was created from the drafts.
    expect(await ctx.prisma.campaign.count({ where: { restaurantId, body: { contains: 'Taslak' } } })).toBe(0);
  });

  it('writes a subject for email and menu descriptions for the menu editor', async () => {
    const email = (
      await campaignDraft({ brief: 'Yeni subemiz acildi', channel: 'EMAIL', locale: 'tr', variants: 1 }).expect(200)
    ).body as AiDraftResultDTO;
    expect(email.drafts).toHaveLength(1);
    expect(email.drafts[0].subject).toEqual(expect.any(String));

    const menu = (
      await ctx
        .http()
        .post(`${base()}/menu-descriptions`)
        .set(owner())
        .send({ itemName: 'Mercimek corbasi', notes: 'kirmizi mercimek, tereyagi', locale: 'tr' })
        .expect(200)
    ).body as AiDraftResultDTO;
    expect(menu.kind).toBe('MENU_DESCRIPTION');
    expect(menu.drafts.length).toBeGreaterThan(0);
    expect(provider.seen[provider.seen.length - 1].prompt).toContain('Mercimek corbasi');

    await campaignDraft({ brief: 'x', channel: 'SMS', locale: 'tr' }).expect(400);
    await campaignDraft({ brief: 'Yeni menu', channel: 'FAX', locale: 'tr' }).expect(400);
  });

  it('stops at the monthly budget the console sets', async () => {
    const path = `/admin/ai-budgets/${restaurantId}`;
    const before = (await ctx.http().get(`${base()}/budget`).set(owner()).expect(200)).body as AiBudgetDTO;
    expect(before.usedThisMonth).toBeGreaterThan(0);
    await ctx.http().put(path).set(owner()).send({ monthlyTokenLimit: 0 }).expect(403);
    const set = (
      await ctx.http().put(path).set(bearer(adminToken)).send({ monthlyTokenLimit: before.usedThisMonth }).expect(200)
    ).body as AiBudgetDTO;
    expect(set).toMatchObject({ monthlyTokenLimit: before.usedThisMonth, remaining: 0 });
    await campaignDraft({ brief: 'Yeni menu tanitimi', channel: 'SMS', locale: 'tr' })
      .expect(409)
      .expect('x-error-code', 'AI_BUDGET_EXHAUSTED');
    expect(await ctx.prisma.aiUsage.count({ where: { restaurantId } })).toBe(3);

    await ctx
      .http()
      .put(path)
      .set(bearer(adminToken))
      .send({ monthlyTokenLimit: before.usedThisMonth + 10_000 })
      .expect(200);
    await campaignDraft({ brief: 'Yeni menu tanitimi', channel: 'SMS', locale: 'tr' }).expect(200);
    await ctx.http().put(path).set(bearer(adminToken)).send({ monthlyTokenLimit: -1 }).expect(400);
  });
});
