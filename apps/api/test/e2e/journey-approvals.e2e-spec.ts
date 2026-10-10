import { normalizePhone } from '@resget/shared';
import type { AuditPageDTO, JourneyDTO, JourneyListDTO, SendLimitDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { JourneysService } from '../../src/modules/journeys/journeys.service';
import { ConsentService } from '../../src/modules/consent/consent.service';
import { MockSmsProvider } from '../../src/modules/messaging/sms.provider';

const DAY_MS = 86_400_000;
const CUSTOMER_PHONES = ['05329994001', '05329994002', '05329994003'].map((p) => normalizePhone(p)!);
const APPROVER_PHONE = normalizePhone('05329994009')!;
const BODY = 'Merhaba {name}, sizi ozledik; onayli akis.';

/** A fixed-offset zone where it is now around noon: inside the send window. */
function noonZone(now: Date): string {
  const offset = 12 - now.getUTCHours();
  if (offset === 0) return 'Etc/UTC';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** Automated flows under send approvals and limits (docs/ONAYLAR.md, docs/AKISLAR.md). */
describe('Journey approvals and limits (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let approverToken: string;
  let restaurantId: string;
  let originalTimezone: string;
  let walletId: string;
  let walletOriginal: number;
  let roleId: string;
  let journeys: JourneysService;
  let sms: jest.SpyInstance;
  let flow: JourneyDTO;
  const customerIds: string[] = [];
  const base = () => `/restaurants/${restaurantId}/journeys`;
  const owner = () => bearer(ownerToken, restaurantId);
  const approver = () => bearer(approverToken, restaurantId);
  const feature = (key: string, enabled: boolean) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const act = (who: () => Record<string, string>, id: string, path: string, body: object = {}) =>
    ctx.http().post(`${base()}/${id}/${path}`).set(who()).send(body);
  const patch = (who: () => Record<string, string>, id: string, body: object) =>
    ctx.http().patch(`${base()}/${id}`).set(who()).send(body);
  const runs = (journeyId: string) => ctx.prisma.journeyRun.findMany({ where: { journeyId } });
  const sentTexts = () => sms.mock.calls.map((call) => String(call[1])).filter((text) => text.includes('onayli akis'));
  const limitPath = () => `/admin/send-limits/${restaurantId}`;
  const usedLast24h = async () =>
    ((await ctx.http().get(limitPath()).set(bearer(adminToken)).expect(200)).body as SendLimitDTO).usedLast24h;
  const listed = async (id: string) =>
    ((await ctx.http().get(base()).set(owner()).expect(200)).body as JourneyListDTO).items.find((j) => j.id === id)!;

  beforeAll(async () => {
    ctx = await createTestApp();
    journeys = ctx.app.get(JourneysService);
    sms = jest.spyOn(ctx.app.get(MockSmsProvider), 'send');
    [adminToken, ownerToken, approverToken] = await Promise.all([
      ctx.login(SEED.superAdminPhone),
      ctx.login(SEED.ownerPhone),
      ctx.login(APPROVER_PHONE),
    ]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, timezone: true },
    });
    restaurantId = restaurant.id;
    originalTimezone = restaurant.timezone;
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: noonZone(new Date()) } });
    const wallet = await ctx.prisma.messageWallet.findUniqueOrThrow({
      where: { restaurantId_channel: { restaurantId, channel: 'SMS' } },
    });
    walletId = wallet.id;
    walletOriginal = wallet.balance;
    await ctx.prisma.messageWallet.update({ where: { id: walletId }, data: { balance: 100 } });
    await ctx.prisma.journey.deleteMany({ where: { restaurantId } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: CUSTOMER_PHONES } } });
    // Three lapsed customers with SMS consent: a win-back flow reaches all of them.
    for (const [i, phone] of CUSTOMER_PHONES.entries()) {
      const user = await ctx.prisma.user.create({ data: { phone, fullName: `Onay Akis ${i}` } });
      const customer = await ctx.prisma.restaurantCustomer.create({
        data: { restaurantId, userId: user.id, lastOrderAt: new Date(Date.now() - 40 * DAY_MS) },
        select: { id: true },
      });
      customerIds.push(customer.id);
      await ctx.app.get(ConsentService).grant({
        restaurantId,
        customerId: customer.id,
        channels: ['SMS'],
        source: 'SITE_FORM',
        phoneVerified: true,
      });
    }
    // A second person who may approve but not prepare flows.
    const approverUser = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: APPROVER_PHONE } });
    roleId = (
      await ctx.prisma.roleTemplate.create({
        data: {
          restaurantId,
          name: 'E2E Akis Onayci',
          permissions: { create: [{ permissionKey: 'campaigns.view' }, { permissionKey: 'campaigns.approve' }] },
        },
        select: { id: true },
      })
    ).id;
    await ctx.prisma.membership.create({
      data: { userId: approverUser.id, restaurantId, roleTemplateId: roleId, status: 'ACTIVE' },
    });
    await feature('journeys', true);
  });

  afterAll(async () => {
    sms.mockRestore();
    const ids = (await ctx.prisma.journey.findMany({ where: { restaurantId }, select: { id: true } })).map((j) => j.id);
    await ctx.prisma.auditLog.deleteMany({ where: { entity: 'journey', entityId: { in: ids } } });
    await ctx.prisma.journey.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { id: { in: customerIds } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: CUSTOMER_PHONES } } });
    await ctx.prisma.membership.deleteMany({ where: { roleTemplateId: roleId } });
    await ctx.prisma.roleTemplate.deleteMany({ where: { id: roleId } });
    await ctx.prisma.campaignSendLimit.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { restaurantId, key: { in: ['journeys', 'marketing_approvals', 'audit_viewer'] } },
    });
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'audit_viewer' } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: originalTimezone } });
    await ctx.prisma.messageWallet.update({ where: { id: walletId }, data: { balance: walletOriginal } });
    await ctx.close();
  });

  it('needs the module for the approval routes', async () => {
    const plain = (
      await ctx
        .http()
        .post(base())
        .set(owner())
        .send({ name: 'Onaysiz akis', trigger: 'ORDER_COMPLETED', channel: 'SMS', body: 'Tesekkurler {name}.' })
        .expect(201)
    ).body as JourneyDTO;
    await act(approver, plain.id, 'approval/approve').expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await ctx.http().delete(`${base()}/${plain.id}`).set(owner()).expect(204);
  });

  it('does not send an activated flow until another person approves it', async () => {
    await feature('marketing_approvals', true);
    flow = (
      await ctx
        .http()
        .post(base())
        .set(owner())
        .send({ name: 'Onayli geri kazanim', trigger: 'WIN_BACK', channel: 'SMS', body: BODY, inactiveDays: 30 })
        .expect(201)
    ).body as JourneyDTO;
    await patch(owner, flow.id, { status: 'ACTIVE' }).expect(200);

    sms.mockClear();
    await journeys.runPass(new Date());
    expect((await runs(flow.id)).filter((r) => r.status === 'SENT')).toHaveLength(0);
    expect(sentTexts()).toHaveLength(0);

    const pending = await listed(flow.id);
    expect(pending.status).toBe('ACTIVE');
    expect(pending.approval).toMatchObject({ status: 'PENDING', requestedBy: expect.any(String) });
    // The person who wrote the content cannot approve it; approving needs campaigns.approve.
    await act(owner, flow.id, 'approval/approve').expect(403).expect('x-error-code', 'APPROVAL_SELF_FORBIDDEN');
    await patch(approver, flow.id, { status: 'PAUSED' }).expect(403);

    const approved = (await act(approver, flow.id, 'approval/approve').expect(200)).body as JourneyDTO;
    expect(approved.approval).toMatchObject({ status: 'APPROVED', decidedBy: expect.any(String) });
    await act(approver, flow.id, 'approval/approve').expect(409).expect('x-error-code', 'JOURNEY_STATE_INVALID');
  });

  it('counts flow messages toward the 24-hour limit and holds the flow at the limit', async () => {
    const used = await usedLast24h();
    await ctx
      .http()
      .put(limitPath())
      .set(bearer(adminToken))
      .send({ maxPerCampaign: 1, maxPerDay: used + 1 })
      .expect(200);

    sms.mockClear();
    await journeys.runPass(new Date());
    expect(sentTexts()).toHaveLength(1);
    expect((await runs(flow.id)).filter((r) => r.status === 'SENT')).toHaveLength(1);
    expect(await usedLast24h()).toBe(used + 1);
    expect((await listed(flow.id)).lastError).toBe('SEND_LIMIT_EXCEEDED');

    // The per-campaign limit does not apply to an open-ended flow; raising the daily one lets the rest go.
    await ctx
      .http()
      .put(limitPath())
      .set(bearer(adminToken))
      .send({ maxPerCampaign: 1, maxPerDay: used + 10 })
      .expect(200);
    await journeys.runPass(new Date());
    expect((await runs(flow.id)).filter((r) => r.status === 'SENT')).toHaveLength(CUSTOMER_PHONES.length);
    expect((await listed(flow.id)).lastError).toBeNull();
    expect(await usedLast24h()).toBe(used + CUSTOMER_PHONES.length);
  });

  it('takes the approval back when the content of an active flow changes', async () => {
    const edited = (await patch(owner, flow.id, { body: 'Yeni metin {name}; onayli akis.' }).expect(200))
      .body as JourneyDTO;
    expect(edited.status).toBe('ACTIVE');
    expect(edited.approval.status).toBe('PENDING');
    // A new pending message for a fresh customer is held until the new text is approved.
    await ctx.prisma.journeyRun.create({
      data: { journeyId: flow.id, customerId: customerIds[0], dueAt: new Date() },
    });
    sms.mockClear();
    await journeys.runPass(new Date());
    expect(sentTexts()).toHaveLength(0);
    expect((await listed(flow.id)).lastError).toBe('JOURNEY_APPROVAL_REQUIRED');

    // A rejection keeps it held, with the reason on the flow.
    await act(approver, flow.id, 'approval/reject', { note: 'x' }).expect(400);
    const rejected = (await act(approver, flow.id, 'approval/reject', { note: 'Metin uzun' }).expect(200))
      .body as JourneyDTO;
    expect(rejected.approval).toMatchObject({ status: 'REJECTED', note: 'Metin uzun' });

    // Renaming is not a content change; pausing and switching it on asks again.
    expect((await patch(owner, flow.id, { name: 'Yeni ad' }).expect(200)).body.approval.status).toBe('REJECTED');
    await patch(owner, flow.id, { status: 'PAUSED' }).expect(200);
    const again = (await patch(owner, flow.id, { status: 'ACTIVE' }).expect(200)).body as JourneyDTO;
    expect(again.approval.status).toBe('PENDING');
    await act(approver, flow.id, 'approval/approve').expect(200);
    await journeys.runPass(new Date());
    expect(sentTexts()).toHaveLength(1);
  });

  it('writes the flow trail to the audit log', async () => {
    await ctx.http().put('/admin/features/audit_viewer').set(bearer(adminToken)).send({ enabled: true }).expect(200);
    const page = (
      await ctx.http().get(`/admin/audit?restaurant=${SEED.restaurantSlug}&action=journey.`).set(bearer(adminToken))
    ).body as AuditPageDTO;
    const mine = page.items.filter((item) => item.entityId === flow.id).map((item) => item.action);
    for (const action of [
      'journey.create',
      'journey.activate',
      'journey.approval.request',
      'journey.approval.approve',
      'journey.approval.reject',
      'journey.update',
      'journey.pause',
      'journey.held',
    ]) {
      expect(mine).toContain(action);
    }
    const reset = page.items.find(
      (item) => item.entityId === flow.id && item.action === 'journey.update' && item.meta?.includes('approvalReset'),
    );
    expect(reset?.actor?.fullName).toEqual(expect.any(String));
  });
});
