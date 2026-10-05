import './support/meta-mock';
import { createHmac } from 'node:crypto';
import type { MetaLeadDTO, MetaLeadPageDTO, OAuthStartDTO, SocialAccountDTO } from '@resget/shared';
import { LeadAdsService } from '../../src/modules/lead-ads/lead-ads.service';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const SECRET = 'e2e-meta-app-secret';
const LEAD_PHONE_PREFIX = '+90555000';

/** Lead Ads (docs/LEAD_ADS.md): switch, webhook setup and signature, page subscription, import into the pipeline. */
describe('Lead Ads (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let page: SocialAccountDTO;
  let instagram: SocialAccountDTO;
  const owner = () => bearer(ownerToken, restaurantId);
  const base = () => `/restaurants/${restaurantId}/lead-ads`;
  const delivery = (leadgenId: string, pageId = 'mock-page-1') =>
    JSON.stringify({
      object: 'page',
      entry: [
        { id: pageId, time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: pageId } }] },
      ],
    });
  const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const deliver = (body: string, signature: string | null = sign(body)) => {
    const req = ctx.http().post('/webhooks/meta').set('content-type', 'application/json');
    if (signature) req.set('x-hub-signature-256', signature);
    return req.send(body);
  };
  const lead = (leadgenId: string) =>
    ctx.prisma.metaLead.findUniqueOrThrow({ where: { restaurantId_leadgenId: { restaurantId, leadgenId } } });

  const cleanup = async () => {
    await ctx.prisma.metaLead.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurantCustomer.deleteMany({
      where: { restaurantId, user: { phone: { startsWith: LEAD_PHONE_PREFIX } } },
    });
    await ctx.prisma.user.deleteMany({ where: { phone: { startsWith: LEAD_PHONE_PREFIX } } });
    await ctx.prisma.socialAccount.deleteMany({ where: { restaurantId } });
    await ctx.prisma.oAuthState.deleteMany({ where: { restaurantId } });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    restaurantId = (
      await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug }, select: { id: true } })
    ).id;
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: { in: ['integration_hub', 'lead_ads'] } } });
    await ctx.prisma.auditLog.deleteMany({
      where: { restaurantId, OR: [{ action: { startsWith: 'social.' } }, { action: { startsWith: 'lead_ads.' } }] },
    });
    await ctx.close();
  });

  it('is behind its switch', async () => {
    await ctx.http().get(`${base()}/leads`).set(owner()).expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    for (const key of ['integration_hub', 'lead_ads']) {
      await ctx
        .http()
        .put(`/admin/restaurants/${restaurantId}/features/${key}`)
        .set(bearer(adminToken))
        .send({ enabled: true })
        .expect(200);
    }
    const start = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/social/meta/connect`)
        .set(owner())
        .send({ returnPath: `/panel/${SEED.restaurantSlug}/entegrasyon` })
        .expect(200)
    ).body as OAuthStartDTO;
    const url = new URL(start.authorizeUrl);
    await ctx.http().get(`${url.pathname}${url.search}`).expect(302);
    const accounts = (await ctx.http().get(`/restaurants/${restaurantId}/social/accounts`).set(owner()).expect(200))
      .body as SocialAccountDTO[];
    page = accounts.find((a) => a.kind === 'FACEBOOK_PAGE') as SocialAccountDTO;
    instagram = accounts.find((a) => a.kind === 'INSTAGRAM_BUSINESS') as SocialAccountDTO;
    expect(page.leadsEnabled).toBe(false);
  });

  it('answers the webhook setup challenge only with the verify token', async () => {
    const ok = await ctx
      .http()
      .get('/webhooks/meta?hub.mode=subscribe&hub.verify_token=e2e-meta-verify-token&hub.challenge=1158201444')
      .expect(200);
    expect(ok.text).toBe('1158201444');
    await ctx.http().get('/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1').expect(403);
    await ctx
      .http()
      .get('/webhooks/meta?hub.mode=subscribe&hub.verify_token=e2e-meta-verify-token&hub.challenge=%3Cb%3E1')
      .expect(403);
    await ctx
      .http()
      .get(
        '/webhooks/meta?hub.mode=subscribe&hub.verify_token=e2e-meta-verify-token&hub.verify_token=x&hub.challenge=1',
      )
      .expect(403);
  });

  it('turns lead import on only for a Facebook page in use', async () => {
    await ctx
      .http()
      .put(`${base()}/pages/${instagram.id}`)
      .set(owner())
      .send({ enabled: true })
      .expect(409)
      .expect('x-error-code', 'LEAD_ADS_PAGE_REQUIRED');
    await ctx
      .http()
      .put(`${base()}/pages/${page.id}`)
      .set(owner())
      .send({ enabled: true })
      .expect(409)
      .expect('x-error-code', 'LEAD_ADS_PAGE_REQUIRED');
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/social/accounts/${page.id}`)
      .set(owner())
      .send({ enabled: true })
      .expect(200);
    const res = await ctx.http().put(`${base()}/pages/${page.id}`).set(owner()).send({ enabled: true }).expect(200);
    expect((res.body as SocialAccountDTO).leadsEnabled).toBe(true);
    expect(await ctx.prisma.auditLog.count({ where: { restaurantId, action: 'lead_ads.enable' } })).toBe(1);
  });

  it('refuses unsigned and wrongly signed deliveries', async () => {
    const body = delivery('900001');
    await deliver(body, null).expect(400).expect('x-error-code', 'WEBHOOK_INVALID');
    await deliver(body, sign(body, 'another-secret')).expect(400).expect('x-error-code', 'WEBHOOK_INVALID');
    await deliver(delivery('900002'), sign(body)).expect(400);
    expect(await ctx.prisma.metaLead.count({ where: { restaurantId } })).toBe(0);
  });

  it('imports a signed lead into the pipeline without granting consent, once', async () => {
    const body = delivery('900001');
    expect((await deliver(body).expect(200)).body).toEqual({ received: 1 });
    const row = await lead('900001');
    expect(row.status).toBe('IMPORTED');
    const contact = await ctx.prisma.restaurantCustomer.findUniqueOrThrow({
      where: { id: row.customerId as string },
      include: { user: true, stage: true, activities: true },
    });
    expect(contact.user.phone).toBe(`${LEAD_PHONE_PREFIX}0001`);
    expect(contact.user.fullName).toBe('Aday 0001');
    expect(contact.source).toBe('meta_lead_ad');
    expect(contact.email).toBe('aday0001@example.com');
    expect(contact.city).toBe('Istanbul');
    expect(contact.stage?.key).toBe('new');
    expect(contact.marketingOptIn).toBe(false);
    expect(contact.consentChannels).toEqual([]);
    expect(contact.activities).toHaveLength(1);
    expect(contact.activities[0].type).toBe('FORM');
    expect(contact.activities[0].body).toContain('kac_kisilik: 4');
    expect(contact.activities[0].body).not.toContain(`${LEAD_PHONE_PREFIX}0001`);

    expect((await deliver(body).expect(200)).body).toEqual({ received: 0 });
    expect(await ctx.prisma.metaLead.count({ where: { restaurantId, leadgenId: '900001' } })).toBe(1);

    const list = (await ctx.http().get(`${base()}/leads`).set(owner()).expect(200)).body as MetaLeadPageDTO;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      leadgenId: '900001',
      pageName: 'Deneme Sayfasi',
      status: 'IMPORTED',
      contactName: 'Aday 0001',
      formId: '700001',
    });
  });

  it('keeps an existing contact and only fills what it lacked', async () => {
    const user = await ctx.prisma.user.create({ data: { phone: `${LEAD_PHONE_PREFIX}0003`, fullName: 'Eski Kisi' } });
    const existing = await ctx.prisma.restaurantCustomer.create({
      data: { restaurantId, userId: user.id, source: 'site_form', city: 'Ankara' },
    });
    await deliver(delivery('900003')).expect(200);
    const row = await lead('900003');
    expect(row.customerId).toBe(existing.id);
    const contact = await ctx.prisma.restaurantCustomer.findUniqueOrThrow({ where: { id: existing.id } });
    expect(contact.source).toBe('site_form');
    expect(contact.city).toBe('Ankara');
    expect(contact.email).toBe('aday0003@example.com');
    expect(contact.stageId).toBeNull();
  });

  it('skips a lead without a phone and retries a failed read until it gives up', async () => {
    await deliver(delivery('910001')).expect(200);
    expect(await lead('910001')).toMatchObject({ status: 'SKIPPED', reason: 'NO_PHONE' });

    await deliver(delivery('123')).expect(200);
    expect(await lead('123')).toMatchObject({ status: 'RECEIVED', reason: 'GRAPH_ERROR', attempts: 1 });
    const service = ctx.app.get(LeadAdsService);
    // Not due yet: the sweep leaves it alone.
    await service.sweep(new Date());
    expect((await lead('123')).attempts).toBe(1);
    for (let i = 0; i < 4; i += 1) await service.sweep(new Date(Date.now() + (i + 1) * 3_600_000));
    expect(await lead('123')).toMatchObject({ status: 'FAILED', reason: 'GRAPH_ERROR', attempts: 5 });

    const imported = await lead('900001');
    await ctx
      .http()
      .post(`${base()}/leads/${imported.id}/retry`)
      .set(owner())
      .expect(409)
      .expect('x-error-code', 'LEAD_NOT_RETRYABLE');
    const failed = await lead('123');
    const retried = (await ctx.http().post(`${base()}/leads/${failed.id}/retry`).set(owner()).expect(200))
      .body as MetaLeadDTO;
    expect(retried).toMatchObject({ status: 'RECEIVED', attempts: 1, reason: 'GRAPH_ERROR' });
  });

  it('stops importing when the page is turned off or taken out of use', async () => {
    await ctx.http().put(`${base()}/pages/${page.id}`).set(owner()).send({ enabled: false }).expect(200);
    expect((await deliver(delivery('900004')).expect(200)).body).toEqual({ received: 0 });
    await ctx.http().put(`${base()}/pages/${page.id}`).set(owner()).send({ enabled: true }).expect(200);
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/social/accounts/${page.id}`)
      .set(owner())
      .send({ enabled: false })
      .expect(200);
    const account = await ctx.prisma.socialAccount.findUniqueOrThrow({ where: { id: page.id } });
    expect(account.leadsEnabled).toBe(false);
    expect((await deliver(delivery('900005')).expect(200)).body).toEqual({ received: 0 });
  });
});
