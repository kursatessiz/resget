import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import type { ConsentRegistryAdapter } from '@resget/shared';
import { CampaignsRunner } from '../../src/modules/campaigns/campaigns.runner';
import { CONSENT_REGISTRY } from '../../src/modules/campaigns/consent-registry';

/** PRO campaigns (docs/KAMPANYALAR.md): consent, segment, preview, batch send with credits, opt-out, quiet hours, plan gate. */
describe('Campaigns (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  let runner: CampaignsRunner;
  let walletBefore: number;
  let walletOriginal: number;
  let walletId: string;
  /** Tomorrow 12:00 UTC: after any scheduledAt the suite sets, inside the restaurant's (UTC) send window. */
  const tomorrowNoon = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(12, 0, 0, 0);
    return d;
  };
  let originalTimezone: string;
  let subscriptionId: string | null = null;
  let trialEndsAt: Date | null = null;
  const phones = ['05329990921', '05329990922', '05329990923'].map((p) => normalizePhone(p)!);
  const campaignIds: string[] = [];
  const orderIds: string[] = [];

  const publicOrder = (phone: string, optIn: boolean, name: string) =>
    ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: name, phone },
        payment: { method: 'CASH_ON_DELIVERY' },
        ...(optIn ? { marketingOptIn: true } : {}),
      })
      .expect(201);

  beforeAll(async () => {
    ctx = await createTestApp();
    runner = ctx.app.get(CampaignsRunner);
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: {
        id: true,
        timezone: true,
        branches: { take: 1, select: { id: true } },
        subscription: { select: { id: true, trialEndsAt: true } },
      },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    originalTimezone = restaurant.timezone;
    subscriptionId = restaurant.subscription?.id ?? null;
    trialEndsAt = restaurant.subscription?.trialEndsAt ?? null;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    await ctx.prisma.user.deleteMany({ where: { phone: { in: phones } } });
    // Daylight: the restaurant's zone is pinned to UTC so "now" sits inside the send window when the suite runs by day
    // and the quiet-hour scenario can pick its own moment explicitly.
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: 'Etc/UTC' } });
    const wallet = await ctx.prisma.messageWallet.findUniqueOrThrow({
      where: { restaurantId_channel: { restaurantId, channel: 'SMS' } },
    });
    walletId = wallet.id;
    walletOriginal = wallet.balance;
    // Enough credits for every scenario below; the original balance comes back in afterAll.
    await ctx.prisma.messageWallet.update({ where: { id: walletId }, data: { balance: 100 } });
    walletBefore = 100;
    void branchId;
  });

  afterAll(async () => {
    if (campaignIds.length) await ctx.prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, user: { phone: { in: phones } } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: phones } } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: originalTimezone } });
    await ctx.prisma.messageWallet.update({ where: { id: walletId }, data: { balance: walletOriginal } });
    if (subscriptionId)
      await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
    await ctx.close();
  });

  it('records consent only when the customer ticks the box, and the customer list shows it', async () => {
    const a = await publicOrder(phones[0], true, 'Izinli Bir');
    const b = await publicOrder(phones[1], true, 'Izinli Iki');
    const c = await publicOrder(phones[2], false, 'Izinsiz Uc');
    for (const r of [a, b, c]) {
      const order = await ctx.prisma.order.findUniqueOrThrow({
        where: { trackingToken: r.body.trackingToken },
        select: { id: true },
      });
      orderIds.push(order.id);
    }
    const customers = await ctx.prisma.restaurantCustomer.findMany({
      where: { restaurantId, user: { phone: { in: phones } } },
      select: { marketingOptIn: true, marketingOptInAt: true, marketingToken: true, user: { select: { phone: true } } },
    });
    expect(customers).toHaveLength(3);
    const optedIn = customers.filter((c) => c.marketingOptIn);
    expect(optedIn).toHaveLength(2);
    expect(optedIn.every((c) => c.marketingOptInAt !== null && c.marketingToken !== null)).toBe(true);
    const audience = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/campaigns/audience`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(audience.body.optedIn).toBeGreaterThanOrEqual(2);
  });

  it('previews the audience and credits, sends in the window, debits one credit per delivered message', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns`)
      .set(bearer(ownerToken))
      .send({
        name: 'Hafta sonu',
        channel: 'SMS',
        body: 'Bu hafta sonu tum tatlilar yuzde 20 indirimli.',
        segment: { minOrders: 1 },
      })
      .expect(201);
    campaignIds.push(created.body.id);
    expect(created.body.status).toBe('DRAFT');

    const preview = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/${created.body.id}/preview`)
      .set(bearer(ownerToken))
      .send({})
      .expect(200);
    expect(preview.body.audienceCount).toBeGreaterThanOrEqual(2);
    expect(preview.body.creditsNeeded).toBe(preview.body.audienceCount);
    expect(preview.body.renderedExample).toContain('/iptal/');
    expect(preview.body.renderedExample).toContain('Demo Lokanta');
    expect(preview.body.timezone).toBe('Etc/UTC');

    const queued = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/${created.body.id}/send`)
      .set(bearer(ownerToken))
      .send({})
      .expect(200);
    expect(queued.body.status).toBe('SCHEDULED');

    // A moment after the queueing and inside the window, whatever the wall clock says.
    const sent = await runner.tick(tomorrowNoon());
    expect(sent).toBeGreaterThanOrEqual(2);
    const detail = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/campaigns/${created.body.id}`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(detail.body.status).toBe('SENT');
    expect(detail.body.sentCount).toBe(detail.body.audienceCount);
    expect(detail.body.recipients.every((r: { status: string }) => r.status === 'SENT')).toBe(true);
    const wallet = await ctx.prisma.messageWallet.findUniqueOrThrow({
      where: { restaurantId_channel: { restaurantId, channel: 'SMS' } },
    });
    expect(walletBefore - wallet.balance).toBe(detail.body.sentCount);
    const logs = await ctx.prisma.messageLog.count({
      where: { restaurantId, templateKey: 'campaign.body', status: 'SENT' },
    });
    expect(logs).toBeGreaterThanOrEqual(detail.body.sentCount);
    walletBefore = wallet.balance;
  });

  it('an opted-out customer is skipped and quiet hours hold the send until the window opens', async () => {
    const customer = await ctx.prisma.restaurantCustomer.findFirstOrThrow({
      where: { restaurantId, user: { phone: phones[0] } },
      select: { marketingToken: true },
    });
    const out = await ctx.http().post(`/public/marketing/opt-out/${customer.marketingToken}`).expect(200);
    expect(out.body.restaurantName).toBe('Demo Lokanta');
    await ctx.http().post(`/public/marketing/opt-out/${customer.marketingToken}`).expect(200);

    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns`)
      .set(bearer(ownerToken))
      .send({ name: 'Gece', channel: 'SMS', body: 'Bu mesaj gece gitmemeli.', segment: {} })
      .expect(201);
    campaignIds.push(created.body.id);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/${created.body.id}/send`)
      .set(bearer(ownerToken))
      .send({})
      .expect(200);

    const midnight = new Date();
    midnight.setUTCHours(2, 0, 0, 0);
    midnight.setUTCDate(midnight.getUTCDate() + 1);
    expect(await runner.tick(midnight)).toBe(0);
    const held = await ctx.prisma.campaign.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(held.status).toBe('SENDING');
    expect(held.sentCount).toBe(0);

    const noon = new Date(midnight.getTime() + 10 * 3_600_000);
    const sent = await runner.tick(noon);
    const done = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/campaigns/${created.body.id}`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(done.body.status).toBe('SENT');
    const optedOutRecipient = done.body.recipients.find((r: { fullName: string }) => r.fullName === 'Izinli Bir');
    expect(optedOutRecipient).toBeUndefined();
    expect(sent).toBe(done.body.sentCount);
    expect(
      done.body.recipients.some(
        (r: { fullName: string; status: string }) => r.fullName === 'Izinli Iki' && r.status === 'SENT',
      ),
    ).toBe(true);
  });

  it('asks the consent registry only about channels it covers: SMS in Turkey, never WhatsApp', async () => {
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { countryCode: true },
    });
    expect(restaurant.countryCode).toBe('TR');
    const registry = ctx.app.get<ConsentRegistryAdapter>(CONSENT_REGISTRY);
    // A registry that confirms nobody: whatever it is asked about is skipped.
    const asked = jest.spyOn(registry, 'allowed').mockResolvedValue(new Set<string>());
    try {
      const send = async (name: string, channel: 'SMS' | 'WHATSAPP') => {
        const created = await ctx
          .http()
          .post(`/restaurants/${restaurantId}/campaigns`)
          .set(bearer(ownerToken))
          .send({ name, channel, body: 'Kanal kapsami denemesi.', segment: { minOrders: 1 } })
          .expect(201);
        campaignIds.push(created.body.id);
        await ctx
          .http()
          .post(`/restaurants/${restaurantId}/campaigns/${created.body.id}/send`)
          .set(bearer(ownerToken))
          .send({})
          .expect(200);
        await runner.tick(tomorrowNoon());
        return ctx.prisma.campaignRecipient.findMany({
          where: { campaignId: created.body.id },
          select: { status: true, errorCode: true },
        });
      };

      const sms = await send('IYS SMS', 'SMS');
      expect(asked).toHaveBeenCalledWith('TR', 'SMS', expect.any(Array));
      expect(sms.some((r) => r.errorCode === 'CONSENT_REGISTRY')).toBe(true);

      asked.mockClear();
      const whatsapp = await send('IYS WhatsApp', 'WHATSAPP');
      // WhatsApp is not an IYS channel yet: the customer's own opt-in decides, the registry is not consulted.
      expect(asked).not.toHaveBeenCalled();
      expect(whatsapp.length).toBeGreaterThan(0);
      expect(whatsapp.some((r) => r.errorCode === 'CONSENT_REGISTRY')).toBe(false);
    } finally {
      asked.mockRestore();
    }
  });

  it('pauses on empty credits and resumes without double sends; cancels a draft; closes to BASIC', async () => {
    const wallet = await ctx.prisma.messageWallet.findUniqueOrThrow({
      where: { restaurantId_channel: { restaurantId, channel: 'SMS' } },
    });
    await ctx.prisma.messageWallet.update({ where: { id: wallet.id }, data: { balance: 0 } });
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns`)
      .set(bearer(ownerToken))
      .send({ name: 'Kredisiz', channel: 'SMS', body: 'Kredi bitince durmali.', segment: {} })
      .expect(201);
    campaignIds.push(created.body.id);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/${created.body.id}/send`)
      .set(bearer(ownerToken))
      .send({})
      .expect(200);
    const noon = tomorrowNoon();
    expect(await runner.tick(noon)).toBe(0);
    const paused = await ctx.prisma.campaign.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(paused.status).toBe('SENDING');
    expect(paused.lastError).toBe('INSUFFICIENT_CREDITS');
    await ctx.prisma.messageWallet.update({ where: { id: wallet.id }, data: { balance: wallet.balance } });
    const resumed = await runner.tick(noon);
    const done = await ctx.prisma.campaign.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(done.status).toBe('SENT');
    expect(done.sentCount).toBe(resumed);
    expect(done.lastError).toBeNull();
    const logs = await ctx.prisma.messageLog.count({
      where: { restaurantId, templateKey: 'campaign.body', status: 'FAILED', errorCode: 'INSUFFICIENT_CREDITS' },
    });
    expect(logs).toBeGreaterThanOrEqual(1);

    const draft = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns`)
      .set(bearer(ownerToken))
      .send({ name: 'Taslak', channel: 'WHATSAPP', body: 'Hic gitmeyecek.', segment: {} })
      .expect(201);
    campaignIds.push(draft.body.id);
    const cancelled = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/${draft.body.id}/cancel`)
      .set(bearer(ownerToken))
      .send({})
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/${draft.body.id}/send`)
      .set(bearer(ownerToken))
      .send({})
      .expect(409);

    if (!subscriptionId) throw new Error('seed restaurant has no subscription');
    await ctx.prisma.restaurantSubscription.update({
      where: { id: subscriptionId },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    const basicToken = await ctx.login(SEED.ownerPhone);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/campaigns`)
      .set(bearer(basicToken))
      .expect(403)
      .expect('x-error-code', 'PLAN_FEATURE_REQUIRED');
    await ctx.prisma.restaurantSubscription.update({ where: { id: subscriptionId }, data: { trialEndsAt } });
  });
});
