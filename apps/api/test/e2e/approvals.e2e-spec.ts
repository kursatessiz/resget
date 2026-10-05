import type { AuditPageDTO, CampaignDTO, CampaignPreviewDTO, SendLimitDTO } from '@resget/shared';
import { normalizePhone } from '@resget/shared';
import { CampaignsRunner } from '../../src/modules/campaigns/campaigns.runner';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const TAG = 'E2E-ONAY';
const CUSTOMER_PHONES = ['05329990992', '05329990993'].map((p) => normalizePhone(p)!);
const APPROVER_PHONE = '05329990991';

/** Send approvals, limits and the audit viewer (docs/ONAYLAR.md). */
describe('Send approvals and limits (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let approverToken: string;
  let restaurantId: string;
  let roleId: string;
  let campaignId: string;
  const customerIds: string[] = [];
  const campaignIds: string[] = [];
  const base = () => `/restaurants/${restaurantId}/campaigns`;
  const owner = () => bearer(ownerToken, restaurantId);
  const approver = () => bearer(approverToken, restaurantId);
  const setSwitch = (enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/marketing_approvals`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const draft = async (name: string) => {
    const res = await ctx
      .http()
      .post(base())
      .set(owner())
      .send({ name, channel: 'SMS', body: 'Onayli kampanya metni burada.', segment: { tags: [TAG] } })
      .expect(201);
    campaignIds.push(res.body.id as string);
    return res.body as CampaignDTO;
  };
  const preview = async (id: string) =>
    (await ctx.http().post(`${base()}/${id}/preview`).set(owner()).send({}).expect(200)).body as CampaignPreviewDTO;
  const act = (who: () => Record<string, string>, id: string, path: string, body: object = {}) =>
    ctx.http().post(`${base()}/${id}/${path}`).set(who()).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login(SEED.superAdminPhone);
    ownerToken = await ctx.login(SEED.ownerPhone);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    await ctx.prisma.user.deleteMany({ where: { phone: { in: CUSTOMER_PHONES } } });
    for (const [i, phone] of CUSTOMER_PHONES.entries()) {
      const user = await ctx.prisma.user.create({ data: { phone, fullName: `Onay Musteri ${i}` } });
      const customer = await ctx.prisma.restaurantCustomer.create({
        data: { restaurantId, userId: user.id, tags: [TAG], marketingOptIn: true, consentChannels: ['SMS'] },
        select: { id: true },
      });
      customerIds.push(customer.id);
    }
    // A second person who may approve but not prepare or send campaigns.
    approverToken = await ctx.login(APPROVER_PHONE);
    const approverUser = await ctx.prisma.user.findUniqueOrThrow({
      where: { phone: normalizePhone(APPROVER_PHONE)! },
      select: { id: true },
    });
    roleId = (
      await ctx.prisma.roleTemplate.create({
        data: {
          restaurantId,
          name: 'E2E Onayci',
          permissions: { create: [{ permissionKey: 'campaigns.view' }, { permissionKey: 'campaigns.approve' }] },
        },
        select: { id: true },
      })
    ).id;
    await ctx.prisma.membership.create({
      data: { userId: approverUser.id, restaurantId, roleTemplateId: roleId, status: 'ACTIVE' },
    });
  });

  afterAll(async () => {
    await ctx.prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { id: { in: customerIds } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: CUSTOMER_PHONES } } });
    await ctx.prisma.membership.deleteMany({ where: { roleTemplateId: roleId } });
    await ctx.prisma.roleTemplate.deleteMany({ where: { id: roleId } });
    await ctx.prisma.campaignSendLimit.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { OR: [{ key: 'audit_viewer' }, { restaurantId, key: 'marketing_approvals' }] },
    });
    await ctx.prisma.auditLog.deleteMany({ where: { entityId: { in: [...campaignIds, restaurantId] } } });
    await ctx.close();
  });

  it('needs the module for approval routes and lets campaigns go without it', async () => {
    const plain = await draft('E2E Onaysiz');
    expect(plain.approval.status).toBe('NONE');
    expect((await preview(plain.id)).guards).toMatchObject({ approvalRequired: false, limit: null, limitBlock: null });
    await act(owner, plain.id, 'approval/request').expect(403).expect('x-error-code', 'FEATURE_DISABLED');
  });

  it('keeps a campaign from going out until another person approves it', async () => {
    await setSwitch(true);
    await ctx
      .http()
      .post(base())
      .set(owner())
      .send({
        name: 'E2E Zamanli',
        channel: 'SMS',
        body: 'Onayli kampanya metni burada.',
        segment: { tags: [TAG] },
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(409)
      .expect('x-error-code', 'CAMPAIGN_APPROVAL_REQUIRED');

    campaignId = (await draft('E2E Onayli')).id;
    expect((await preview(campaignId)).guards).toMatchObject({
      approvalRequired: true,
      approval: { status: 'NONE' },
    });
    await act(owner, campaignId, 'send').expect(409).expect('x-error-code', 'CAMPAIGN_APPROVAL_REQUIRED');

    const pending = (await act(owner, campaignId, 'approval/request').expect(200)).body as CampaignDTO;
    expect(pending.approval).toMatchObject({ status: 'PENDING', requestedBy: expect.any(String) });
    await act(owner, campaignId, 'approval/approve').expect(403).expect('x-error-code', 'APPROVAL_SELF_FORBIDDEN');
    await act(approver, campaignId, 'approval/reject', { note: 'x' }).expect(400);
    const rejected = (await act(approver, campaignId, 'approval/reject', { note: 'Metin kisaltilsin' }).expect(200))
      .body as CampaignDTO;
    expect(rejected.approval).toMatchObject({ status: 'REJECTED', note: 'Metin kisaltilsin' });

    await act(owner, campaignId, 'approval/request').expect(200);
    const approved = (await act(approver, campaignId, 'approval/approve').expect(200)).body as CampaignDTO;
    expect(approved.approval.status).toBe('APPROVED');
    expect(approved.approval.decidedBy).toEqual(expect.any(String));
    // Approving is not preparing: the approver cannot send.
    await act(approver, campaignId, 'send').expect(403);
    await act(approver, campaignId, 'approval/approve').expect(409).expect('x-error-code', 'CAMPAIGN_STATE_INVALID');
  });

  it('takes the approval back when the content changes', async () => {
    const edited = (
      await ctx
        .http()
        .patch(`${base()}/${campaignId}`)
        .set(owner())
        .send({ body: 'Degisen kampanya metni burada.' })
        .expect(200)
    ).body as CampaignDTO;
    expect(edited.approval.status).toBe('NONE');
    await act(owner, campaignId, 'send').expect(409).expect('x-error-code', 'CAMPAIGN_APPROVAL_REQUIRED');
    await act(owner, campaignId, 'approval/request').expect(200);
    await act(approver, campaignId, 'approval/approve').expect(200);
  });

  it('enforces the console limits per campaign and over 24 hours', async () => {
    const audience = (await preview(campaignId)).audienceCount;
    expect(audience).toBe(CUSTOMER_PHONES.length);
    const limitPath = `/admin/send-limits/${restaurantId}`;
    await ctx.http().put(limitPath).set(owner()).send({ maxPerCampaign: 1, maxPerDay: null }).expect(403);
    await ctx
      .http()
      .put(limitPath)
      .set(bearer(adminToken))
      .send({ maxPerCampaign: audience - 1, maxPerDay: null })
      .expect(200);
    const blocked = await preview(campaignId);
    expect(blocked.guards.limitBlock).toBe('PER_CAMPAIGN');
    await act(owner, campaignId, 'send').expect(409).expect('x-error-code', 'SEND_LIMIT_EXCEEDED');

    const used = ((await ctx.http().get(limitPath).set(bearer(adminToken)).expect(200)).body as SendLimitDTO)
      .usedLast24h;
    await ctx
      .http()
      .put(limitPath)
      .set(bearer(adminToken))
      .send({ maxPerCampaign: null, maxPerDay: used + audience - 1 })
      .expect(200);
    await act(owner, campaignId, 'send').expect(409).expect('x-error-code', 'SEND_LIMIT_EXCEEDED');
    await ctx
      .http()
      .put(limitPath)
      .set(bearer(adminToken))
      .send({ maxPerCampaign: null, maxPerDay: used + audience })
      .expect(200);
    const queued = (await act(owner, campaignId, 'send').expect(200)).body as CampaignDTO;
    expect(queued.status).toBe('SCHEDULED');
    await act(owner, campaignId, 'cancel').expect(200);
  });

  it('holds a campaign queued before approvals were switched on', async () => {
    await setSwitch(false);
    const early = await draft('E2E Erken');
    await act(owner, early.id, 'send', { scheduledAt: new Date(Date.now() - 60_000).toISOString() }).expect(200);
    await setSwitch(true);
    await ctx.app.get(CampaignsRunner).tick(new Date());
    const held = await ctx.prisma.campaign.findUniqueOrThrow({
      where: { id: early.id },
      select: { status: true, lastError: true, startedAt: true },
    });
    expect(held).toEqual({ status: 'DRAFT', lastError: 'CAMPAIGN_APPROVAL_REQUIRED', startedAt: null });
  });

  it('shows the trail in the console audit viewer', async () => {
    const audit = (query: string) => ctx.http().get(`/admin/audit${query}`).set(bearer(adminToken));
    await audit('').expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await ctx.http().put('/admin/features/audit_viewer').set(bearer(adminToken)).send({ enabled: true }).expect(200);
    await ctx.http().get('/admin/audit').set(owner()).expect(403);
    await audit('?action=Bad;').expect(400);

    const page = (await audit(`?restaurant=${SEED.restaurantSlug}&action=campaign.`).expect(200)).body as AuditPageDTO;
    const mine = page.items.filter((item) => item.entityId === campaignId).map((item) => item.action);
    for (const action of [
      'campaign.create',
      'campaign.approval.request',
      'campaign.approval.reject',
      'campaign.approval.approve',
      'campaign.update',
      'campaign.limit_blocked',
      'campaign.send',
      'campaign.cancel',
    ]) {
      expect(mine).toContain(action);
    }
    expect(page.items.every((item) => item.action.startsWith('campaign.'))).toBe(true);
    expect(page.items.every((item) => item.restaurant?.slug === SEED.restaurantSlug)).toBe(true);
    const reset = page.items.find((item) => item.entityId === campaignId && item.action === 'campaign.update');
    expect(reset?.meta).toContain('approvalReset');
    expect(reset?.actor?.fullName).toEqual(expect.any(String));

    const limits = (await audit('?action=send_limit.').expect(200)).body as AuditPageDTO;
    expect(limits.items.some((item) => item.entityId === restaurantId)).toBe(true);
    const future = (await audit('?from=2999-01-01').expect(200)).body as AuditPageDTO;
    expect(future.total).toBe(0);
  });
});
