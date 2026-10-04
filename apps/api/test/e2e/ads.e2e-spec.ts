import { createHash, randomUUID } from 'node:crypto';
import { minorDigitsOf, normalizePhone } from '@resget/shared';
import type { AdConnectionDTO, AdPerformanceDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { AdsService } from '../../src/modules/ads/ads.service';
import type { MockAdsAdapter } from '../../src/modules/ads/ads.adapter';
import { AttributionService } from '../../src/modules/attribution/attribution.service';

const PHONES = ['05329990994', '05329990995', '05329990996'].map((p) => normalizePhone(p)!);
const EMAIL = 'reklam.alici@ornek.test';
const MINUTE_MS = 60_000;

/** Ad integrations (docs/REKLAM.md): switch, encrypted credentials, consent-gated delivery, retries, spend, report. */
describe('Ad integrations (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let currency: string;
  let ads: AdsService;
  let attribution: AttributionService;
  const customers: string[] = [];
  const base = () => `/restaurants/${restaurantId}/ads`;
  const auth = () => bearer(ownerToken, restaurantId);
  const feature = (key: string, enabled: boolean) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const mock = (platform: 'META' | 'GOOGLE' | 'TIKTOK') => ads.adapter(platform) as MockAdsAdapter;

  /** A customer whose last visit came from an ad, with or without advertising consent and click ids. */
  const visitThenConvert = async (
    customerId: string,
    touch: { consent: boolean; clickIds: Record<string, string>; adPlatform: string | null },
    type: 'first_order' | 'repeat_order',
    valueMinor: number,
  ) => {
    const visitorId = randomUUID();
    await ctx.prisma.visitor.create({ data: { restaurantId, id: visitorId, customerId } });
    await ctx.prisma.touchpoint.create({
      data: {
        restaurantId,
        visitorId,
        sessionId: randomUUID(),
        landingHost: 'lokanta.test',
        landingPath: '/menu',
        advertisingConsent: touch.consent,
        clickIds: touch.clickIds,
        adPlatform: touch.adPlatform,
        customerId,
        occurredAt: new Date(Date.now() - 10 * MINUTE_MS),
      },
    });
    const sourceId = randomUUID();
    await attribution.record({ restaurantId, type, customerId, valueMinor, currency, sourceKind: 'order', sourceId });
    return ctx.prisma.conversionEvent.findUniqueOrThrow({
      where: { restaurantId_sourceKind_sourceId: { restaurantId, sourceKind: 'order', sourceId } },
      select: { id: true },
    });
  };
  const deliveriesOf = (conversionEventId: string) =>
    ctx.prisma.adConversionDelivery.findMany({
      where: { conversionEventId },
      select: { status: true, errorCode: true, connection: { select: { platform: true } } },
    });
  const statusBy = async (conversionEventId: string) =>
    Object.fromEntries(
      (await deliveriesOf(conversionEventId)).map((d) => [d.connection.platform, `${d.status}:${d.errorCode ?? ''}`]),
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    ads = ctx.app.get(AdsService);
    attribution = ctx.app.get(AttributionService);
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, currency: true },
    });
    restaurantId = restaurant.id;
    currency = restaurant.currency;
    await ctx.prisma.adConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    for (const [i, phone] of PHONES.entries()) {
      const user = await ctx.prisma.user.create({ data: { phone, fullName: `Reklam ${i + 1}` } });
      const customer = await ctx.prisma.restaurantCustomer.create({
        data: { restaurantId, userId: user.id, ...(i === 2 ? { email: EMAIL } : {}) },
        select: { id: true },
      });
      customers.push(customer.id);
    }
  });

  afterAll(async () => {
    await ctx.prisma.adConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.conversionEvent.deleteMany({ where: { customerId: { in: customers } } });
    await ctx.prisma.visitor.deleteMany({ where: { customerId: { in: customers } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { id: { in: customers } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { restaurantId, key: { in: ['ad_integrations', 'attribution'] } },
    });
    await ctx.close();
  });

  it('is behind its switch and keeps credentials encrypted and out of every response', async () => {
    await ctx.http().get(`${base()}/connections`).set(auth()).expect(403).expect('x-error-code', 'FEATURE_DISABLED');
    await feature('ad_integrations', true);
    await feature('attribution', true);

    await ctx
      .http()
      .put(`${base()}/connections/META`)
      .set(auth())
      .send({ credentials: { pixelId: 'PX1' } })
      .expect(400)
      .expect('x-error-code', 'AD_CREDENTIALS_INVALID');
    await ctx
      .http()
      .put(`${base()}/connections/META`)
      .set(auth())
      .send({ credentials: { pixelId: 'PX1', accessToken: 'invalid' } })
      .expect(400)
      .expect('x-error-code', 'AD_CREDENTIALS_REFUSED');
    const meta = await ctx
      .http()
      .put(`${base()}/connections/META`)
      .set(auth())
      .send({ credentials: { pixelId: 'PX1', accessToken: 'meta-secret-token' } })
      .expect(200);
    expect(meta.body).toMatchObject({
      platform: 'META',
      status: 'ACTIVE',
      config: { pixelId: 'PX1' },
      secretsSet: ['accessToken'],
      sendTypes: ['first_order', 'repeat_order'],
      enhancedMatching: false,
    });
    expect(JSON.stringify(meta.body)).not.toContain('meta-secret-token');
    const stored = await ctx.prisma.adConnection.findFirstOrThrow({ where: { restaurantId, platform: 'META' } });
    expect(stored.encryptedCredentials).not.toContain('meta-secret-token');

    // A pixel id change without the token keeps the stored token.
    const changed = await ctx
      .http()
      .put(`${base()}/connections/META`)
      .set(auth())
      .send({ credentials: { pixelId: 'PX2' } })
      .expect(200);
    expect(changed.body).toMatchObject({ config: { pixelId: 'PX2' }, secretsSet: ['accessToken'] });

    await ctx
      .http()
      .put(`${base()}/connections/GOOGLE`)
      .set(auth())
      .send({ credentials: { customerId: '123-456-7890', conversionActionId: '55', refreshToken: 'google-refresh' } })
      .expect(200);
    await ctx
      .http()
      .put(`${base()}/connections/TIKTOK`)
      .set(auth())
      .send({ credentials: { pixelCode: 'TTP', accessToken: 'tiktok-token' } })
      .expect(200);
    const list = (await ctx.http().get(`${base()}/connections`).set(auth()).expect(200)).body as AdConnectionDTO[];
    expect(list.map((c) => c.platform)).toEqual(['GOOGLE', 'META', 'TIKTOK']);
    expect(JSON.stringify(list)).not.toMatch(/google-refresh|tiktok-token|meta-secret-token/);
  });

  it('sends a conversion only with advertising consent and the platform click id', async () => {
    const withClicks = await visitThenConvert(
      customers[0],
      { consent: true, clickIds: { fbclid: 'FBCLICK', gclid: 'GCLICK' }, adPlatform: 'META' },
      'first_order',
      15_000,
    );
    const noConsent = await visitThenConvert(
      customers[1],
      { consent: false, clickIds: {}, adPlatform: null },
      'first_order',
      9_000,
    );
    const metaBefore = mock('META').sent.length;
    const googleBefore = mock('GOOGLE').sent.length;
    await ads.runPass(new Date());

    expect(await statusBy(withClicks.id)).toEqual({ META: 'SENT:', GOOGLE: 'SENT:', TIKTOK: 'SKIPPED:NO_CLICK_ID' });
    expect(await statusBy(noConsent.id)).toEqual({
      META: 'SKIPPED:NO_AD_CONSENT',
      GOOGLE: 'SKIPPED:NO_AD_CONSENT',
      TIKTOK: 'SKIPPED:NO_AD_CONSENT',
    });
    const metaSent = mock('META')
      .sent.slice(metaBefore)
      .find((s) => s.payload.eventId === withClicks.id)!;
    expect(metaSent.credentials).toMatchObject({ pixelId: 'PX2', accessToken: 'meta-secret-token' });
    expect(metaSent.payload).toMatchObject({
      type: 'first_order',
      valueMinor: 15_000,
      currency,
      digits: minorDigitsOf(currency),
      clickIds: { fbclid: 'FBCLICK' },
      hashedPhone: null,
      hashedEmail: null,
    });
    const googleSent = mock('GOOGLE')
      .sent.slice(googleBefore)
      .find((s) => s.payload.eventId === withClicks.id)!;
    expect(googleSent.payload.clickIds).toEqual({ gclid: 'GCLICK' });
  });

  it('sends hashed contact data only where enhanced matching is on, and follows the chosen types', async () => {
    await ctx.http().patch(`${base()}/connections/TIKTOK`).set(auth()).send({ enhancedMatching: true }).expect(200);
    await ctx
      .http()
      .patch(`${base()}/connections/META`)
      .set(auth())
      .send({ sendTypes: ['first_order'] })
      .expect(200);
    const before = mock('TIKTOK').sent.length;
    const conversion = await visitThenConvert(
      customers[2],
      { consent: true, clickIds: {}, adPlatform: 'TIKTOK' },
      'repeat_order',
      4_000,
    );
    await ads.runPass(new Date());
    // META no longer takes repeat orders; Google needs a click id; TikTok matches on the hashed contact data.
    expect(await statusBy(conversion.id)).toEqual({ GOOGLE: 'SKIPPED:NO_CLICK_ID', TIKTOK: 'SENT:' });
    const sent = mock('TIKTOK')
      .sent.slice(before)
      .find((s) => s.payload.eventId === conversion.id)!;
    expect(sent.payload.hashedEmail).toBe(createHash('sha256').update(EMAIL).digest('hex'));
    expect(sent.payload.hashedPhone).toBe(createHash('sha256').update(PHONES[2].replace(/\D/g, '')).digest('hex'));
  });

  it('retries a temporary failure with backoff', async () => {
    await ctx
      .http()
      .put(`${base()}/connections/META`)
      .set(auth())
      .send({ credentials: { accessToken: 'flaky' } })
      .expect(200);
    const conversion = await visitThenConvert(
      customers[0],
      { consent: true, clickIds: { fbclid: 'FB2' }, adPlatform: 'META' },
      'first_order',
      2_000,
    );
    const now = new Date();
    await ads.runPass(now);
    const waiting = await ctx.prisma.adConversionDelivery.findFirstOrThrow({
      where: { conversionEventId: conversion.id, connection: { platform: 'META' } },
    });
    expect(waiting).toMatchObject({ status: 'PENDING', attempts: 1, errorCode: 'TEMPORARY' });
    expect(waiting.nextAttemptAt.getTime()).toBe(now.getTime() + 2 * MINUTE_MS);
    await ads.runPass(new Date(now.getTime() + 3 * MINUTE_MS));
    expect((await statusBy(conversion.id)).META).toBe('SENT:');
  });

  it('pulls spend and reports it against the conversions each platform brought', async () => {
    const sync = await ctx.http().post(`${base()}/spend/sync`).set(auth()).send({}).expect(200);
    expect(sync.body.rows).toBe(21);
    const report = (await ctx.http().get(`${base()}/performance?days=30`).set(auth()).expect(200))
      .body as AdPerformanceDTO;
    const unit = 10 ** minorDigitsOf(currency);
    const meta = report.rows.find((r) => r.platform === 'META' && r.currency === currency)!;
    expect(meta.spendMinor).toBe(7 * 25 * unit);
    expect(meta.clicks).toBe(7 * 40);
    expect(meta.conversions).toBe(2);
    expect(meta.revenueMinor).toBe(17_000);
    expect(meta.roasBps).toBe(Math.round((17_000 * 10_000) / (7 * 25 * unit)));
    const tiktok = report.rows.find((r) => r.platform === 'TIKTOK')!;
    expect(tiktok.conversions).toBe(1);

    await ctx.http().get(`${base()}/performance?days=14`).set(auth()).expect(400);
    await ctx.http().delete(`${base()}/connections/TIKTOK`).set(auth()).expect(204);
    await ctx
      .http()
      .patch(`${base()}/connections/TIKTOK`)
      .set(auth())
      .send({ status: 'PAUSED' })
      .expect(404)
      .expect('x-error-code', 'AD_CONNECTION_NOT_FOUND');
  });
});
