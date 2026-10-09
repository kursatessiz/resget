import { abAutoAssignment, abVariantFor, bestHourDueAt, localHour, normalizePhone } from '@resget/shared';
import type { CampaignDTO, CampaignPreviewDTO, CampaignResultsDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { CampaignsService } from '../../src/modules/campaigns/campaigns.service';
import { ConsentService } from '../../src/modules/consent/consent.service';
import { EMAIL_PROVIDER, MockEmailProvider } from '../../src/modules/email/email.provider';

const TRACK_PHONE = normalizePhone('05329990977')!;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MARK = 'kmp2-e2e';
const MARK_HOUR = 'kmp2-saat-e2e';
const MARK_MAIL = 'kmp2-posta-e2e';
const DOMAIN = 'kampanya-e2e.verified.test';
const PHONES = ['05329990971', '05329990972', '05329990973', '05329990974', '05329990975', '05329990976'].map((p) =>
  normalizePhone(p)!,
);

/** A fixed-offset zone where it is now around noon: inside the send window and the demo branch's opening hours. */
function noonZone(now: Date): string {
  const offset = 12 - now.getUTCHours();
  if (offset === 0) return 'Etc/UTC';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** Campaigns v2 (docs/KAMPANYALAR.md): module switch, channel rules, A/B split, conversions, email, best hour. */
describe('Campaigns v2 (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let menuItemId: string;
  let originalTimezone: string;
  let walletId: string;
  let walletOriginal: number;
  let zone: string;
  let campaigns: CampaignsService;
  const customerIds: string[] = [];
  const campaignIds: string[] = [];
  const orderIds: string[] = [];
  const base = () => `/restaurants/${restaurantId}/campaigns`;
  const auth = () => bearer(ownerToken, restaurantId);
  const enable = (key: string) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
  const create = async (body: Record<string, unknown>) => {
    const res = await ctx.http().post(base()).set(auth()).send(body).expect(201);
    const campaign = res.body as CampaignDTO;
    campaignIds.push(campaign.id);
    return campaign;
  };
  const sendNow = (id: string) => ctx.http().post(`${base()}/${id}/send`).set(auth()).send({}).expect(200);
  const results = async (id: string) =>
    (await ctx.http().get(`${base()}/${id}/results`).set(auth()).expect(200)).body as CampaignResultsDTO;
  const publicOrder = async (phone: string, name: string) => {
    const res = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: name, phone },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { trackingToken: (res.body as { trackingToken: string }).trackingToken },
      select: { id: true, itemsGrossMinor: true },
    });
    orderIds.push(order.id);
    return order;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    campaigns = ctx.app.get(CampaignsService);
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, timezone: true },
    });
    restaurantId = restaurant.id;
    originalTimezone = restaurant.timezone;
    zone = noonZone(new Date());
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: zone } });
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    const wallet = await ctx.prisma.messageWallet.findUniqueOrThrow({
      where: { restaurantId_channel: { restaurantId, channel: 'SMS' } },
    });
    walletId = wallet.id;
    walletOriginal = wallet.balance;
    await ctx.prisma.messageWallet.update({ where: { id: walletId }, data: { balance: 100 } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await ctx.prisma.emailDomain.deleteMany({ where: { domain: DOMAIN } });

    // Four SMS contacts for the A/B test, one for best hour, one email contact.
    const consent = ctx.app.get(ConsentService);
    const people = [
      { tags: [MARK], channels: ['SMS'] as const },
      { tags: [MARK], channels: ['SMS'] as const },
      { tags: [MARK], channels: ['SMS'] as const },
      { tags: [MARK], channels: ['SMS'] as const },
      { tags: [MARK_HOUR], channels: ['SMS'] as const },
      { tags: [MARK_MAIL], channels: ['EMAIL'] as const, email: 'kampanya.alici@ornek.test' },
    ];
    for (const [i, person] of people.entries()) {
      const user = await ctx.prisma.user.create({ data: { phone: PHONES[i], fullName: `Kampanya ${i + 1}` } });
      const customer = await ctx.prisma.restaurantCustomer.create({
        data: { restaurantId, userId: user.id, tags: person.tags, email: person.email ?? null },
        select: { id: true },
      });
      customerIds.push(customer.id);
      await consent.grant({
        restaurantId,
        customerId: customer.id,
        channels: person.channels,
        source: 'SITE_FORM',
        phoneVerified: true,
      });
    }
  });

  afterAll(async () => {
    if (campaignIds.length) await ctx.prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { id: { in: customerIds } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [...PHONES, TRACK_PHONE] } } });
    await ctx.prisma.emailDomain.deleteMany({ where: { domain: DOMAIN } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { restaurantId, key: { in: ['campaigns_v2', 'email_channel', 'email_tracking'] } },
    });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: originalTimezone } });
    await ctx.prisma.messageWallet.update({ where: { id: walletId }, data: { balance: walletOriginal } });
    await ctx.close();
  });

  it('keeps email, A/B and best hour behind the module switches and checks the text per channel', async () => {
    const sms = { name: 'Kampanya v2', channel: 'SMS', body: 'Hafta sonu yuzde on indirim', segment: { tags: [MARK] } };
    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ ...sms, variant: { body: 'Ikinci metin burada' } })
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ ...sms, sendTimeMode: 'BEST_HOUR' })
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
    await enable('campaigns_v2');
    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ ...sms, channel: 'EMAIL', subject: 'Indirim' })
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');

    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ ...sms, subject: 'Konu olmaz' })
      .expect(400);
    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ ...sms, body: 'x'.repeat(301) })
      .expect(400);
    await ctx
      .http()
      .post(base())
      .set(auth())
      .send({ ...sms, channel: 'EMAIL' })
      .expect(400);
    const draft = await create(sms);
    await ctx
      .http()
      .patch(`${base()}/${draft.id}`)
      .set(auth())
      .send({ body: 'y'.repeat(400) })
      .expect(400)
      .expect('x-error-code', 'CAMPAIGN_CONTENT_INVALID');
  });

  it('splits an A/B test deterministically and credits the first order within the window to the message', async () => {
    const campaign = await create({
      name: 'Kampanya AB',
      channel: 'SMS',
      body: 'Metin A: bu aksam tatli ikram',
      variant: { body: 'Metin B: bu aksam ucretsiz icecek', sharePct: 50 },
      attributionDays: 2,
      segment: { tags: [MARK] },
    });
    expect(campaign.variant).toMatchObject({ sharePct: 50 });
    const preview = (await ctx.http().post(`${base()}/${campaign.id}/preview`).set(auth()).send({}).expect(200))
      .body as CampaignPreviewDTO;
    expect(preview.audienceCount).toBe(4);
    expect(preview.renderedVariantExample).toContain('ucretsiz icecek');

    await sendNow(campaign.id);
    await campaigns.runPass(new Date());
    await campaigns.runPass(new Date());
    const recipients = await ctx.prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id },
      select: { id: true, customerId: true, variant: true, status: true },
    });
    expect(recipients).toHaveLength(4);
    for (const r of recipients) {
      expect(r.status).toBe('SENT');
      expect(r.variant).toBe(abVariantFor(campaign.id, r.customerId, 50));
    }
    const before = await results(campaign.id);
    expect(before.variants.map((v) => v.variant)).toEqual(['A', 'B']);
    expect(before.variants.reduce((n, v) => n + v.sent, 0)).toBe(4);
    expect(before.variants.reduce((n, v) => n + v.conversions, 0)).toBe(0);

    // The first recipient orders: credited once, with the order's items gross.
    const buyer = recipients.find((r) => r.customerId === customerIds[0])!;
    const order = await publicOrder(PHONES[0], 'Kampanya 1');
    const credited = await ctx.prisma.campaignRecipient.findUniqueOrThrow({ where: { id: buyer.id } });
    expect(credited.convertedOrderId).toBe(order.id);
    expect(credited.revenueMinor).toBe(order.itemsGrossMinor);
    await publicOrder(PHONES[0], 'Kampanya 1');
    const after = await results(campaign.id);
    const side = after.variants.find((v) => v.variant === buyer.variant)!;
    expect(side.conversions).toBe(1);
    expect(side.revenueMinor).toBe(order.itemsGrossMinor);
    expect(side.conversionRateBps).toBe(Math.round(10_000 / side.sent));
    expect(after.currency).toMatch(/^[A-Z]{3}$/);

    // Outside the window: a message older than the campaign's two days is not credited.
    const late = recipients.find((r) => r.customerId === customerIds[1])!;
    await ctx.prisma.campaignRecipient.update({
      where: { id: late.id },
      data: { sentAt: new Date(Date.now() - 3 * DAY_MS) },
    });
    await publicOrder(PHONES[1], 'Kampanya 2');
    expect(
      (await ctx.prisma.campaignRecipient.findUniqueOrThrow({ where: { id: late.id } })).convertedOrderId,
    ).toBeNull();

    // A cancelled order is not a conversion.
    await ctx.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED_BY_RESTAURANT' } });
    const cancelled = await results(campaign.id);
    expect(cancelled.variants.reduce((n, v) => n + v.conversions, 0)).toBe(0);
  });

  it('sends an email campaign from the verified domain with a one-click unsubscribe and no credits', async () => {
    await enable('email_channel');
    const campaign = await create({
      name: 'Kampanya posta',
      channel: 'EMAIL',
      subject: 'Bu hafta sonu bize gelin',
      body: 'Merhaba,\n\nHafta sonu tum tatlilar yuzde yirmi indirimli.',
      segment: { tags: [MARK_MAIL] },
    });
    // Without a verified sending domain the campaign cannot be queued.
    await ctx
      .http()
      .post(`${base()}/${campaign.id}/send`)
      .set(auth())
      .send({})
      .expect(409)
      .expect('x-error-code', 'EMAIL_DOMAIN_NOT_VERIFIED');
    await ctx.prisma.emailDomain.create({
      data: {
        restaurantId,
        domain: DOMAIN,
        fromLocalPart: 'kampanya',
        fromName: 'Demo Lokanta',
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });
    const preview = (await ctx.http().post(`${base()}/${campaign.id}/preview`).set(auth()).send({}).expect(200))
      .body as CampaignPreviewDTO;
    expect(preview.audienceCount).toBe(1);
    expect(preview.creditsNeeded).toBe(0);
    expect(preview.enoughCredits).toBe(true);

    const outbox = ctx.app.get<MockEmailProvider>(EMAIL_PROVIDER).outbox;
    const before = outbox.length;
    const walletBefore = (await ctx.prisma.messageWallet.findUniqueOrThrow({ where: { id: walletId } })).balance;
    await sendNow(campaign.id);
    await campaigns.runPass(new Date());
    const mail = outbox.slice(before).find((m) => m.to === 'kampanya.alici@ornek.test');
    expect(mail).toBeDefined();
    expect(mail!.from).toBe(`kampanya@${DOMAIN}`);
    expect(mail!.subject).toBe('Bu hafta sonu bize gelin');
    expect(mail!.text).toContain('yuzde yirmi indirimli');
    expect(mail!.headers['List-Unsubscribe']).toMatch(/\/api\/iptal\/[0-9a-f-]{36}>$/);
    expect(mail!.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const recipient = await ctx.prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(recipient.status).toBe('SENT');
    expect((await ctx.prisma.messageWallet.findUniqueOrThrow({ where: { id: walletId } })).balance).toBe(walletBefore);
  });

  it('holds a best-hour recipient until the local hour they order most often', async () => {
    // Past orders of the contact at 16:00 local time.
    const now = new Date();
    const shift = (16 - localHour(now, zone)) * HOUR_MS;
    for (let i = 1; i <= 2; i += 1) {
      const order = await publicOrder(PHONES[4], 'Kampanya 5');
      await ctx.prisma.order.update({
        where: { id: order.id },
        data: { placedAt: new Date(now.getTime() - i * DAY_MS + shift) },
      });
    }
    const campaign = await create({
      name: 'Kampanya saat',
      channel: 'SMS',
      body: 'Aksam yemegine ozel menu bizde',
      sendTimeMode: 'BEST_HOUR',
      segment: { tags: [MARK_HOUR] },
    });
    await sendNow(campaign.id);
    const start = new Date();
    await campaigns.runPass(start);
    const waiting = await ctx.prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(waiting.status).toBe('PENDING');
    expect(waiting.dueAt?.toISOString()).toBe(bestHourDueAt(start, zone, 16).toISOString());
    expect(localHour(waiting.dueAt!, zone)).toBe(16);

    await campaigns.runPass(waiting.dueAt!);
    const sent = await ctx.prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(sent.status).toBe('SENT');
    expect((await ctx.prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENT');
  });

  it('measures opens and clicks of a campaign email without storing anything about the device', async () => {
    await enable('email_channel');
    await enable('email_tracking');
    const phone = TRACK_PHONE;
    await ctx.prisma.user.deleteMany({ where: { phone } });
    const user = await ctx.prisma.user.create({ data: { phone, fullName: 'Kampanya Olcum' } });
    const customer = await ctx.prisma.restaurantCustomer.create({
      data: { restaurantId, userId: user.id, tags: ['kmp2-track'], email: 'olcum.alici@ornek.test' },
      select: { id: true },
    });
    customerIds.push(customer.id);
    await ctx.app
      .get(ConsentService)
      .grant({ restaurantId, customerId: customer.id, channels: ['EMAIL'], source: 'SITE_FORM' });
    await ctx.prisma.emailDomain.upsert({
      where: { domain: DOMAIN },
      update: { status: 'VERIFIED', verifiedAt: new Date() },
      create: {
        restaurantId,
        domain: DOMAIN,
        fromLocalPart: 'kampanya',
        fromName: 'Demo Lokanta',
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });
    const campaign = await create({
      name: 'Kampanya olcum',
      channel: 'EMAIL',
      subject: 'Yeni menu',
      body: 'Yeni menumuz burada: https://ornek.test/menu?kaynak=eposta. Bekleriz.',
      segment: { tags: ['kmp2-track'] },
    });
    const outbox = ctx.app.get<MockEmailProvider>(EMAIL_PROVIDER).outbox;
    const before = outbox.length;
    await sendNow(campaign.id);
    await campaigns.runPass(new Date());
    const mail = outbox.slice(before).find((m) => m.to === 'olcum.alici@ornek.test')!;
    expect(mail).toBeDefined();
    const recipient = await ctx.prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id } });
    const token = recipient.trackingToken!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // The plain text is untouched; the HTML carries the tracked link and the open image, never the unsubscribe link.
    expect(mail.text).toContain('https://ornek.test/menu?kaynak=eposta');
    expect(mail.html).toContain(`/public/email/c/${token}/0">https://ornek.test/menu?kaynak=eposta</a>`);
    expect(mail.html).toContain(`/public/email/o/${token}"`);
    expect(mail.html).not.toContain('/public/email/c/' + token + '/1');

    const pixel = await ctx.http().get(`/public/email/o/${token}`).expect(200);
    expect(pixel.headers['content-type']).toBe('image/gif');
    await ctx
      .http()
      .get(`/public/email/o/${'x'.repeat(32)}`)
      .expect(200)
      .expect('content-type', 'image/gif');
    const click = await ctx.http().get(`/public/email/c/${token}/0`).expect(302);
    expect(click.headers.location).toBe('https://ornek.test/menu?kaynak=eposta');
    // Only the stored text decides where a link leads.
    const stray = await ctx.http().get(`/public/email/c/${token}/7`).expect(302);
    expect(stray.headers.location).not.toContain('ornek.test');
    const after = await ctx.prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
    expect(after.openedAt).not.toBeNull();
    expect(after.clickedAt).not.toBeNull();
    expect(after).toMatchObject({ openCount: 2, clickCount: 1 });

    const report = await results(campaign.id);
    expect(report.tracked).toBe(true);
    expect(report.variants[0]).toMatchObject({
      sent: 1,
      opens: 1,
      clicks: 1,
      openRateBps: 10_000,
      clickRateBps: 10_000,
    });

    // Switched off: the link still leads on, nothing more is counted, and results stop showing it.
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/email_tracking`)
      .set(bearer(adminToken))
      .send({ enabled: false })
      .expect(200);
    await ctx.http().get(`/public/email/c/${token}/0`).expect(302);
    expect((await ctx.prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } })).clickCount).toBe(1);
    expect((await results(campaign.id)).tracked).toBe(false);
  });

  it('tests on part of the audience, picks the better text after the wait and sends it to those who waited', async () => {
    const campaign = await create({
      name: 'Kampanya otomatik kazanan',
      channel: 'SMS',
      body: 'Metin A: bu hafta kahve ikram',
      variant: { body: 'Metin B: bu hafta tatli ikram', autoWinner: { testPct: 50, waitHours: 24 } },
      segment: { tags: [MARK] },
    });
    expect(campaign.variant?.autoWinner).toEqual({ testPct: 50, waitHours: 24 });
    await sendNow(campaign.id);
    // The pass's clock becomes the campaign's start, from which the wait is counted.
    const start = new Date();
    await campaigns.runPass(start);
    const started = await ctx.prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id },
      orderBy: { customerId: 'asc' },
      select: { id: true, customerId: true, variant: true, status: true },
    });
    expect(started).toHaveLength(4);
    // Each recipient lands where the stable split puts it; those waiting are not sent.
    for (const r of started) {
      expect(r.variant).toBe(abAutoAssignment(campaign.id, r.customerId, 50));
      expect(r.status).toBe(r.variant === 'HOLD' ? 'PENDING' : 'SENT');
    }

    // A known split from here on: one tested on each text, two waiting; text B gets an order.
    const [onA, onB, ...waiting] = started;
    await ctx.prisma.campaignRecipient.update({
      where: { id: onA.id },
      data: { variant: 'A', status: 'SENT', sentAt: start },
    });
    await ctx.prisma.campaignRecipient.update({
      where: { id: onB.id },
      data: { variant: 'B', status: 'SENT', sentAt: start },
    });
    await ctx.prisma.campaignRecipient.updateMany({
      where: { id: { in: waiting.map((r) => r.id) } },
      data: { variant: 'HOLD', status: 'PENDING', sentAt: null, messageLogId: null },
    });
    await ctx.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' } });
    const buyer = customerIds.indexOf(onB.customerId);
    await publicOrder(PHONES[buyer], `Kampanya ${buyer + 1}`);
    expect(
      (await ctx.prisma.campaignRecipient.findUniqueOrThrow({ where: { id: onB.id } })).convertedOrderId,
    ).not.toBeNull();

    // Before the wait is over nothing is picked and nobody waiting is sent.
    await campaigns.runPass(new Date(start.getTime() + 2 * 3_600_000));
    const early = await results(campaign.id);
    expect(early.autoWinner).toMatchObject({ testPct: 50, waitHours: 24, winner: null, holding: 2 });
    expect(early.autoWinner?.decideAt).toBe(new Date(start.getTime() + 24 * 3_600_000).toISOString());

    // After it: B wins on conversions and those waiting get B in the same pass; the campaign finishes.
    const later = new Date(start.getTime() + 25 * 3_600_000);
    await campaigns.runPass(later);
    const decided = await results(campaign.id);
    expect(decided.autoWinner).toMatchObject({ winner: 'B', holding: 0, decidedAt: later.toISOString() });
    const handed = await ctx.prisma.campaignRecipient.findMany({
      where: { id: { in: waiting.map((r) => r.id) } },
      select: { variant: true, status: true },
    });
    expect(handed).toEqual([
      { variant: 'B', status: 'SENT' },
      { variant: 'B', status: 'SENT' },
    ]);
    await campaigns.runPass(new Date(later.getTime() + 60_000));
    expect((await ctx.prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENT');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'campaign.ab_winner', entityId: campaign.id } })).toBe(1);
  });
});
