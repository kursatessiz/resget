import { randomBytes } from 'node:crypto';
import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const CUSTOMER_PHONE = normalizePhone('05329990971')!;
const LEAD_PHONE = normalizePhone('05329990972')!;
const SIGNUP_PHONE = normalizePhone('05329990973')!;

const id = () => randomBytes(16).toString('hex');

/** Visits, consent, conversions and the attribution report (docs/ATIF.md). */
describe('Attribution (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let itemId: string;
  let platformId: string | null = null;
  const orderIds: string[] = [];
  const createdRestaurants: string[] = [];
  // Our own client address, so the public order limit is not shared with other suites.
  const client = `10.77.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;

  const touch = (target: string, body: Record<string, unknown>, userAgent = BROWSER) =>
    ctx
      .http()
      .post(`/public/track/${target}/touchpoint`)
      .set('user-agent', userAgent)
      .set('x-forwarded-for', client)
      .send(body)
      .expect(204);
  const beacon = (visitorId: string, url: string, extra: Record<string, unknown> = {}) => ({
    visitorId,
    sessionId: id(),
    url,
    referrer: null,
    consent: { analytics: true, advertising: false },
    locale: 'tr-TR',
    tableToken: null,
    ...extra,
  });
  const setSwitch = (key: string, scope: string | null, enabled: boolean | null) =>
    ctx
      .http()
      .put(scope ? `/admin/restaurants/${scope}/features/${key}` : `/admin/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken, restaurantId))
      .send({ to, ...extra })
      .expect(200);
  const conversionsOf = (where: Record<string, unknown>) =>
    ctx.prisma.conversionEvent.findMany({ where, orderBy: { occurredAt: 'asc' } });
  /** Order listeners run in the background: wait until the conversion lands. */
  const waitFor = async <T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> => {
    for (let i = 0; i < 40; i += 1) {
      const value = await read();
      if (done(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return read();
  };
  const placeAndComplete = async (visitorId: string | null) => {
    const req = ctx.http().post(`/public/restaurants/${SEED.restaurantSlug}/orders`).set('x-forwarded-for', client);
    if (visitorId) req.set('x-visitor-id', visitorId);
    const res = await req
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Atif Musteri', phone: CUSTOMER_PHONE },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { trackingToken: res.body.trackingToken as string },
      select: { id: true },
    });
    orderIds.push(order.id);
    await transition(order.id, 'ACCEPTED', { prepMinutes: 5 });
    await transition(order.id, 'READY');
    await transition(order.id, 'PICKED_UP');
    return order.id;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true },
    });
    restaurantId = restaurant.id;
    itemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    await ctx.prisma.restaurant.deleteMany({ where: { isPlatform: true } });
    const user = await ctx.prisma.user.findUnique({ where: { phone: CUSTOMER_PHONE }, select: { id: true } });
    if (user) await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, userId: user.id } });
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.conversionEvent.deleteMany({ where: { restaurantId } });
    await ctx.prisma.visitor.deleteMany({ where: { restaurantId } });
    const user = await ctx.prisma.user.findUnique({ where: { phone: CUSTOMER_PHONE }, select: { id: true } });
    if (user) await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, userId: user.id } });
    if (createdRestaurants.length)
      await ctx.prisma.restaurant.deleteMany({ where: { id: { in: createdRestaurants } } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { key: { in: ['attribution', 'marketing_platform', 'contacts_crm'] } },
    });
    await ctx.prisma.restaurant.deleteMany({ where: { isPlatform: true } });
    await ctx.close();
  });

  it('stores nothing while the module is off, without consent, or for a bot', async () => {
    const visitorId = id();
    await touch(SEED.restaurantSlug, beacon(visitorId, 'https://resget.test/demo-lokanta?utm_source=flyer'));
    expect(await ctx.prisma.visitor.count({ where: { restaurantId, id: visitorId } })).toBe(0);

    await setSwitch('attribution', restaurantId, true);
    await touch(
      SEED.restaurantSlug,
      beacon(visitorId, 'https://resget.test/demo-lokanta', { consent: { analytics: false, advertising: false } }),
    );
    await touch(SEED.restaurantSlug, beacon(visitorId, 'https://resget.test/demo-lokanta'), 'Googlebot/2.1');
    // A malformed beacon is dropped without an error, too.
    await touch(SEED.restaurantSlug, { visitorId: 'nope' });
    expect(await ctx.prisma.touchpoint.count({ where: { restaurantId, visitorId } })).toBe(0);
  });

  it('keeps only host, path and tracking parameters, and click ids only with advertising consent', async () => {
    const visitorId = id();
    await touch(
      SEED.restaurantSlug,
      beacon(
        visitorId,
        'https://resget.test/demo-lokanta?utm_source=Google&utm_campaign=Moda&gclid=abc&email=a@b.c#x',
        {
          referrer: 'https://www.google.com/search?q=lokanta',
        },
      ),
    );
    const [stored] = await ctx.prisma.touchpoint.findMany({ where: { restaurantId, visitorId } });
    expect(stored).toMatchObject({
      landingHost: 'resget.test',
      landingPath: '/demo-lokanta',
      referrerHost: 'www.google.com',
      utmSource: 'google',
      utmCampaign: 'Moda',
      advertisingConsent: false,
      untaggedPaid: true,
      deviceType: 'MOBILE',
    });
    expect(stored.clickIds).toBeNull();
    expect(JSON.stringify(stored)).not.toContain('a@b.c');

    await touch(
      SEED.restaurantSlug,
      beacon(visitorId, 'https://resget.test/demo-lokanta?gclid=xyz&rg_cid=c1&rg_asid=s1', {
        consent: { analytics: true, advertising: true },
      }),
    );
    const withAds = await ctx.prisma.touchpoint.findFirstOrThrow({
      where: { restaurantId, visitorId, advertisingConsent: true },
    });
    expect(withAds).toMatchObject({ adPlatform: 'GOOGLE', campaignId: 'c1', untaggedPaid: false });
    expect(withAds.clickIds).toEqual({ gclid: 'xyz' });
  });

  it('ties a table QR visit to its table, links the visitor at order time and records first and repeat orders', async () => {
    const visitorId = id();
    await touch(
      SEED.restaurantSlug,
      beacon(visitorId, `https://resget.test/m/${SEED.tableToken}`, { tableToken: SEED.tableToken }),
    );
    const qr = await ctx.prisma.touchpoint.findFirstOrThrow({ where: { restaurantId, visitorId } });
    expect(qr.tableId).not.toBeNull();
    expect(qr.customerId).toBeNull();

    const firstId = await placeAndComplete(visitorId);
    const visitor = await ctx.prisma.visitor.findUniqueOrThrow({
      where: { restaurantId_id: { restaurantId, id: visitorId } },
    });
    expect(visitor.customerId).not.toBeNull();
    const linked = await ctx.prisma.touchpoint.findUniqueOrThrow({ where: { id: qr.id } });
    expect(linked.customerId).toBe(visitor.customerId);

    const first = await waitFor(
      () => conversionsOf({ restaurantId, sourceKind: 'order', sourceId: firstId }),
      (rows) => rows.length > 0,
    );
    expect(first).toEqual([
      expect.objectContaining({ type: 'first_order', customerId: visitor.customerId, attributedTouchpointId: qr.id }),
    ]);
    expect(first[0].valueMinor).toBeGreaterThan(0);

    const secondId = await placeAndComplete(null);
    const second = await waitFor(
      () => conversionsOf({ restaurantId, sourceKind: 'order', sourceId: secondId }),
      (rows) => rows.length > 0,
    );
    expect(second[0].type).toBe('repeat_order');

    // Recording is idempotent: the same order never counts twice.
    expect(await ctx.prisma.conversionEvent.count({ where: { restaurantId, sourceId: firstId } })).toBe(1);
    const activity = await ctx.prisma.contactActivity.count({
      where: { customerId: visitor.customerId!, type: 'CONVERSION' },
    });
    expect(activity).toBe(2);
  });

  it('reports conversions by source under each model, and shows them on the contact card', async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const report = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/attribution?model=LAST_TOUCH&groupBy=source&from=${from}&to=${to}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(report.body.types).toEqual(['first_order', 'repeat_order']);
    expect(report.body.totals.conversions).toEqual({ first_order: 1, repeat_order: 1 });
    const qrRow = (report.body.rows as { key: string; conversions: Record<string, number> }[]).find(
      (r) => r.key === 'qr',
    );
    expect(qrRow?.conversions).toEqual({ first_order: 1, repeat_order: 1 });
    expect(report.body.visits).toBeGreaterThanOrEqual(3);
    expect(report.body.untaggedPaidVisits).toBeGreaterThanOrEqual(1);

    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/attribution?from=${to}&to=${from}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(400);

    await setSwitch('contacts_crm', restaurantId, true);
    const customer = await ctx.prisma.restaurantCustomer.findFirstOrThrow({
      where: { restaurantId, user: { phone: CUSTOMER_PHONE } },
      select: { id: true },
    });
    const card = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/crm/contacts/${customer.id}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(card.body.attribution.conversions.map((c: { type: string }) => c.type).sort()).toEqual([
      'first_order',
      'repeat_order',
    ]);
    expect(card.body.attribution.touchpoints[0]).toMatchObject({ source: 'qr', medium: 'table' });

    await setSwitch('attribution', restaurantId, false);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/attribution?from=${from}&to=${to}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
    const off = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/crm/contacts/${customer.id}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(off.body.attribution).toBeNull();
  });

  it('takes platform leads and sign-ups into the platform pipeline with their conversions', async () => {
    const closed = await ctx.http().get('/public/platform/site').expect(200);
    expect(closed.body).toEqual({ tracking: false, leadForm: false });
    // Without a platform tenant the form answers the same and stores nothing.
    await ctx
      .http()
      .post('/public/platform/leads')
      .set('x-forwarded-for', client)
      .send({ fullName: 'Aday Sahip', phone: LEAD_PHONE, restaurantName: 'Aday Kebap', privacyAccepted: true })
      .expect(204);

    const setup = await ctx
      .http()
      .post('/admin/platform/setup')
      .set(bearer(adminToken))
      .send({ name: 'Platform', countryCode: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul', defaultLocale: 'tr' })
      .expect(200);
    platformId = setup.body.tenant.id as string;
    await setSwitch('marketing_platform', null, true);
    await setSwitch('contacts_crm', platformId, true);
    await setSwitch('attribution', platformId, true);
    const open = await ctx.http().get('/public/platform/site').expect(200);
    expect(open.body).toEqual({ tracking: true, leadForm: true });

    const visitorId = id();
    await touch('platform', beacon(visitorId, 'https://resget.test/?utm_source=linkedin&utm_medium=social'));
    await ctx
      .http()
      .post('/public/platform/leads')
      .set('x-forwarded-for', client)
      .send({ fullName: 'Aday Sahip', phone: LEAD_PHONE, restaurantName: 'Aday Kebap' })
      .expect(400);
    for (let i = 0; i < 2; i += 1) {
      await ctx
        .http()
        .post('/public/platform/leads')
        .set('x-forwarded-for', client)
        .set('x-visitor-id', visitorId)
        .send({
          fullName: 'Aday Sahip',
          phone: '0532 999 09 72',
          restaurantName: 'Aday Kebap',
          district: 'Kadikoy',
          privacyAccepted: true,
        })
        .expect(204);
    }
    const contact = await ctx.prisma.restaurantCustomer.findFirstOrThrow({
      where: { restaurantId: platformId, user: { phone: LEAD_PHONE } },
      select: { id: true, company: true, source: true, stage: { select: { key: true } } },
    });
    expect(contact).toMatchObject({ company: 'Aday Kebap', source: 'site_form', stage: { key: 'lead' } });
    expect(await ctx.prisma.contactActivity.count({ where: { customerId: contact.id, type: 'FORM' } })).toBe(2);
    const leads = await conversionsOf({ restaurantId: platformId, type: 'lead' });
    expect(leads).toHaveLength(1);
    expect(leads[0].attributedTouchpointId).not.toBeNull();

    const signupVisitor = id();
    await touch('platform', beacon(signupVisitor, 'https://resget.test/kayit?utm_source=google&utm_medium=cpc'));
    const signupToken = await ctx.login(SIGNUP_PHONE);
    const created = await ctx
      .http()
      .post('/restaurants')
      .set(bearer(signupToken))
      .set('x-visitor-id', signupVisitor)
      .send({
        name: 'Atif Ocakbasi',
        countryCode: 'TR',
        currency: 'TRY',
        timezone: 'Europe/Istanbul',
        defaultLocale: 'tr',
        branch: { addressLine: 'Moda Cad. 1', city: 'Istanbul', district: 'Kadikoy' },
      })
      .expect(201);
    createdRestaurants.push(created.body.id as string);
    // Other suites may sign restaurants up while this platform tenant exists; only this test's sign-up is asserted.
    const signups = await conversionsOf({
      restaurantId: platformId,
      type: 'restaurant_signup',
      sourceId: created.body.id,
    });
    expect(signups).toHaveLength(1);
    const owner = await ctx.prisma.restaurantCustomer.findFirstOrThrow({
      where: { restaurantId: platformId, user: { phone: SIGNUP_PHONE } },
      select: { id: true, company: true },
    });
    expect(owner.company).toBe('Atif Ocakbasi');
    expect(signups[0].customerId).toBe(owner.id);

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const report = await ctx
      .http()
      .get(`/restaurants/${platformId}/attribution?groupBy=medium&from=${from}&to=${to}`)
      .set(bearer(adminToken, platformId))
      .expect(200);
    expect(report.body.types).toEqual(['lead', 'restaurant_signup', 'first_payment']);
    const media = Object.fromEntries(
      (report.body.rows as { key: string; conversions: Record<string, number> }[]).map((r) => [r.key, r.conversions]),
    );
    expect(media.social).toEqual({ lead: 1 });
    expect(media.cpc).toEqual({ restaurant_signup: 1 });

    // The restaurant's first paid platform invoice is first_payment, once, on the owner's platform contact.
    const invoice = (periodStart: Date) =>
      ctx.prisma.commissionInvoice.create({
        data: {
          restaurantId: created.body.id as string,
          periodStart,
          periodEnd: new Date(periodStart.getTime() + 28 * 86_400_000),
          currency: 'TRY',
          orderCount: 1,
          baseMinor: 10000,
          commissionMinor: 100,
          vatMinor: 20,
          totalMinor: 120,
          status: 'ISSUED',
          issuedAt: new Date(),
          dueAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      });
    const firstInvoice = await invoice(new Date(Date.UTC(2026, 6, 1)));
    const secondInvoice = await invoice(new Date(Date.UTC(2026, 7, 1)));
    for (const inv of [firstInvoice, secondInvoice]) {
      await ctx
        .http()
        .post(`/admin/billing/invoices/${inv.id}/mark-paid`)
        .set(bearer(adminToken))
        .send({ paymentRef: `atif-${inv.id.slice(0, 8)}` })
        .expect(200);
    }
    // Scoped to the restaurant created here: suites running in parallel (billing) may pay the seed restaurant's
    // invoice while this platform tenant exists, which records that restaurant's own first_payment.
    const payments = await conversionsOf({
      restaurantId: platformId,
      type: 'first_payment',
      sourceId: created.body.id,
    });
    expect(payments).toEqual([
      expect.objectContaining({ customerId: owner.id, valueMinor: 120, currency: 'TRY', sourceId: created.body.id }),
    ]);
  });
});
