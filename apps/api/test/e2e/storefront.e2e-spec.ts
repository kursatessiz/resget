import { PUBLIC_ORDER_MAX_OPEN_PER_PHONE, PUBLIC_ORDER_MAX_TOTAL_QUANTITY } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Consumer ordering from the table QR page and the restaurant page, the funnel and the marketplace (docs/VITRIN.md). */
describe('Storefront (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let itemId: string;
  const session = `e2e-shop-${Date.now()}`;
  const created: string[] = [];

  const lines = (quantity = 1) => [{ menuItemId: itemId, quantity }];

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    restaurantId = restaurant.id;
    const item = await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, name: 'Izgara kofte' } });
    itemId = item.id;
  });

  afterAll(async () => {
    await ctx.prisma.qrScanEvent.deleteMany({ where: { sessionId: session } });
    if (created.length) await ctx.prisma.order.deleteMany({ where: { id: { in: created } } });
    await ctx.close();
  });

  it('serves the table page with option groups, ordering options and payment methods', async () => {
    const res = await ctx.http().get(`/public/qr/${SEED.tableToken}`).set('x-qr-session', session).expect(200);
    expect(res.body.table.label).toBe('1');
    expect(res.body.ordering.dineIn).toBe(true);
    expect(res.body.ordering.delivery).toBe(true);
    expect(res.body.ordering.quotedDelivery).toBe(true);
    expect(res.body.payment.cashOnDelivery).toBe(true);
    expect(Array.isArray(res.body.categories[0].items[0].modifierGroups)).toBe(true);
    await ctx
      .http()
      .post(`/public/qr/${SEED.tableToken}/funnel`)
      .set('x-qr-session', session)
      .send({ outcome: 'STARTED_ORDER' })
      .expect(204);
  });

  it('places a dine-in order from the table QR with cash, recording the funnel step', async () => {
    const res = await ctx
      .http()
      .post(`/public/qr/${SEED.tableToken}/orders`)
      .set('x-qr-session', session)
      .send({ fulfillment: 'DINE_IN', items: lines(2), payment: { method: 'CASH_ON_DELIVERY' }, note: 'az tuzlu' })
      .expect(201);
    expect(res.body.status).toBe('PLACED');
    expect(res.body.fulfillment).toBe('DINE_IN');
    expect(res.body.trackingToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.checkoutUrl).toBeNull();
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
    created.push(order.id);
    expect(order.channel).toBe('TABLE_QR');
    expect(order.tableId).toBeTruthy();
    expect(order.chargedToCustomerMinor).toBe(2 * 42000);
    const events = await ctx.prisma.qrScanEvent.findMany({ where: { sessionId: session }, select: { outcome: true } });
    expect(events.map((e) => e.outcome).sort()).toEqual(['PLACED_ORDER', 'STARTED_ORDER', 'VIEWED_MENU']);
    await ctx.http().get(`/public/orders/${res.body.trackingToken}`).expect(200);
  });

  it('places a delivery order from the restaurant page with the courier quote as the fee', async () => {
    const res = await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'DELIVERY',
        items: lines(),
        address: {
          addressLine: 'Moda Cad. No 9 D 2',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'Vitrin Musteri',
          contactPhone: '0532 999 09 09',
          point: { lat: 40.985, lng: 29.03 },
        },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
    created.push(order.id);
    expect(order.channel).toBe('RESTAURANT_SITE');
    expect(order.fulfillment).toBe('DELIVERY');
    // Seeded policy: PASS_THROUGH rounded up to 5 TL steps on the mock network's quote.
    expect(res.body.deliveryFeeMinor).toBeGreaterThan(0);
    expect(res.body.deliveryFeeMinor % 500).toBe(0);
    expect(res.body.chargedToCustomerMinor).toBe(42000 + res.body.deliveryFeeMinor);
  });

  it('refuses dine-in from the restaurant page, delivery without an address and a sold-out item', async () => {
    await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'DINE_IN',
        items: lines(),
        customer: { fullName: 'A B', phone: '05329990910' },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(409);
    await ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'DELIVERY',
        items: lines(),
        customer: { fullName: 'A B', phone: '05329990910' },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(400);
    await ctx.prisma.menuItem.update({ where: { id: itemId }, data: { isAvailable: false } });
    await ctx
      .http()
      .post(`/public/qr/${SEED.tableToken}/orders`)
      .send({ fulfillment: 'DINE_IN', items: lines(), payment: { method: 'CASH_ON_DELIVERY' } })
      .expect(409)
      .expect('x-error-code', 'MENU_ITEM_UNAVAILABLE');
    await ctx.prisma.menuItem.update({ where: { id: itemId }, data: { isAvailable: true } });
  });

  it('refuses an item of a switched-off menu section, from the table and from the restaurant page', async () => {
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const category = await ctx.prisma.menuCategory.create({
      data: { restaurantId, name: 'e2e kapali bolum', isActive: false },
    });
    try {
      const item = await ctx.prisma.menuItem.create({
        data: {
          restaurantId,
          categoryId: category.id,
          name: 'e2e kapali urun',
          priceMinor: 1000,
          currency: restaurant.currency,
          vatRateBps: 1000,
        },
      });
      const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
      expect(JSON.stringify(menu.body.categories)).not.toContain(item.id);
      await ctx
        .http()
        .post(`/public/qr/${SEED.tableToken}/orders`)
        .send({
          fulfillment: 'DINE_IN',
          items: [{ menuItemId: item.id, quantity: 1 }],
          payment: { method: 'CASH_ON_DELIVERY' },
        })
        .expect(409)
        .expect('x-error-code', 'MENU_ITEM_UNAVAILABLE');
      await ctx
        .http()
        .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
        .send({
          fulfillment: 'PICKUP',
          items: [{ menuItemId: item.id, quantity: 1 }],
          customer: { fullName: 'Kapali Bolum', phone: '05329990921' },
          payment: { method: 'CASH_ON_DELIVERY' },
        })
        .expect(409)
        .expect('x-error-code', 'MENU_ITEM_UNAVAILABLE');
    } finally {
      await ctx.prisma.menuCategory.delete({ where: { id: category.id } });
    }
  });

  it('caps the portions of one public order; staff orders are not capped', async () => {
    const refused = await ctx
      .http()
      .post(`/public/qr/${SEED.tableToken}/orders`)
      .set('x-forwarded-for', '203.0.113.81')
      .send({
        fulfillment: 'DINE_IN',
        items: [
          { menuItemId: itemId, quantity: 30 },
          { menuItemId: itemId, quantity: PUBLIC_ORDER_MAX_TOTAL_QUANTITY - 29 },
        ],
        payment: { method: 'CASH_ON_DELIVERY' },
      });
    if (refused.status === 201) {
      created.push(
        (await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: refused.body.trackingToken } })).id,
      );
    }
    expect(refused.status).toBe(409);
    expect(refused.headers['x-error-code']).toBe('ORDER_QUANTITY_LIMIT');

    const ownerToken = await ctx.login(SEED.ownerPhone);
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { restaurantId } });
    const staff = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken, restaurantId))
      .send({
        branchId: branch.id,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: PUBLIC_ORDER_MAX_TOTAL_QUANTITY + 10 }],
      })
      .expect(201);
    created.push(staff.body.id as string);
  });

  it('caps the open, not yet accepted public orders of one phone at a restaurant', async () => {
    const phone = '05329990941';
    const pickup = () =>
      ctx
        .http()
        .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
        .set('x-forwarded-for', '203.0.113.82')
        .send({
          fulfillment: 'PICKUP',
          items: lines(),
          customer: { fullName: 'Acik Siparis', phone },
          payment: { method: 'CASH_ON_DELIVERY' },
        });
    const placed: string[] = [];
    for (let i = 0; i < PUBLIC_ORDER_MAX_OPEN_PER_PHONE; i += 1) {
      const res = await pickup().expect(201);
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
      created.push(order.id);
      placed.push(order.id);
    }
    const refused = await pickup();
    if (refused.status === 201) {
      created.push(
        (await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: refused.body.trackingToken } })).id,
      );
    }
    expect(refused.status).toBe(409);
    expect(refused.headers['x-error-code']).toBe('OPEN_ORDERS_LIMIT');

    // Once the restaurant has accepted one, the phone may order again.
    await ctx.prisma.order.update({ where: { id: placed[0] }, data: { status: 'ACCEPTED' } });
    const again = await pickup().expect(201);
    created.push((await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: again.body.trackingToken } })).id);
  });

  it('lists launched districts and the listed restaurants in them', async () => {
    const areas = await ctx.http().get('/public/marketplace/areas').expect(200);
    expect(areas.body.some((a: { district: string }) => a.district === 'Kadikoy')).toBe(true);
    const market = await ctx
      .http()
      .get('/public/marketplace?countryCode=TR&city=Istanbul&district=Kadikoy')
      .expect(200);
    expect(market.body.restaurants.some((r: { slug: string }) => r.slug === SEED.restaurantSlug)).toBe(true);
    await ctx.http().get('/public/marketplace?countryCode=TR&city=Istanbul&district=Nowhere').expect(404);
    await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    await ctx.http().get('/public/restaurants/yok-boyle-bir-yer/menu').expect(404);
  });

  it('rate limits a client that places too many orders', async () => {
    const limit = Number(process.env.PUBLIC_ORDER_RATE_LIMIT);
    let refused = 0;
    for (let i = 0; i < limit + 2; i += 1) {
      const res = await ctx
        .http()
        .post(`/public/qr/${SEED.tableToken}/orders`)
        .set('x-forwarded-for', '203.0.113.77')
        .send({ fulfillment: 'DINE_IN', items: lines(), payment: { method: 'CASH_ON_DELIVERY' } });
      if (res.status === 201) {
        const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
        created.push(order.id);
      } else {
        expect(res.status).toBe(403);
        expect(res.headers['x-error-code']).toBe('RATE_LIMITED');
        refused += 1;
      }
    }
    expect(refused).toBeGreaterThanOrEqual(2);
  });

  it('keeps reserved words out of restaurant slugs', async () => {
    const ownerToken = await ctx.login(SEED.ownerPhone);
    await ctx
      .http()
      .post('/restaurants')
      .set(bearer(ownerToken))
      .send({
        name: 'Panel Lokantasi',
        slug: 'panel',
        countryCode: 'TR',
        currency: 'TRY',
        timezone: 'Europe/Istanbul',
        branch: { addressLine: 'Sokak No 1', city: 'Istanbul', district: 'Kadikoy' },
      })
      .expect(400);
  });
});
