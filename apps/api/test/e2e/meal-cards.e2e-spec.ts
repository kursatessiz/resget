import { createHmac } from 'node:crypto';
import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;
const NOTE = 'e2e-mealcard';
const POINT = { lat: 40.988, lng: 29.027 };

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('Meal cards, checkout, webhooks and collection at the door (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let branchId: string;
  let kofteId: string;
  let ownerToken: string;
  let courierToken: string;
  let courierMembershipId: string;
  const tripIds: string[] = [];

  const address = {
    addressLine: 'Moda Cad. No 5 D 1',
    city: 'Istanbul',
    district: 'Kadikoy',
    contactName: 'Ayse',
    contactPhone: '0532 999 02 00',
    point: POINT,
  };

  const createOrder = (payment: Record<string, unknown>, expected = 201) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'RESTAURANT_SITE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId: kofteId, quantity: 1 }],
        address,
        deliveryFeeMinor: 1000,
        note: NOTE,
        payment,
      })
      .expect(expected);

  const getOrder = async (orderId: string) =>
    (await ctx.http().get(`/restaurants/${restaurantId}/orders/${orderId}`).set(bearer(ownerToken)).expect(200)).body;
  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(200);

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    kofteId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    courierMembershipId = (
      await ctx.prisma.membership.findFirstOrThrow({ where: { restaurantId, user: { phone: COURIER_PHONE } } })
    ).id;
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.deliveryTrip.deleteMany({ where: { restaurantId, stops: { none: {} } } });
    await ctx.prisma.mealCardConnection.deleteMany({ where: { restaurantId, providerCode: 'MOCK' } });
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    [ownerToken, courierToken] = await Promise.all([ctx.login(SEED.ownerPhone), ctx.login(COURIER_PHONE)]);
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    if (tripIds.length > 0) await ctx.prisma.deliveryTrip.deleteMany({ where: { id: { in: tripIds } } });
    await ctx.prisma.mealCardConnection.deleteMany({ where: { restaurantId, providerCode: 'MOCK' } });
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    await ctx.close();
  });

  it('lists the issuer catalogue and the seeded door acceptances, publicly without credentials', async () => {
    const settings = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/payments/meal-cards`)
      .set(bearer(ownerToken))
      .expect(200);
    const codes = settings.body.catalog.map((c: { providerCode: string }) => c.providerCode);
    expect(codes).toEqual(
      expect.arrayContaining([
        'MULTINET',
        'EDENRED',
        'PLUXEE',
        'SETCARD',
        'METROPOL',
        'YEMEKMATIK',
        'PAYE',
        'TOKENFLEX',
        'MOCK',
      ]),
    );
    expect(
      settings.body.catalog.find((c: { providerCode: string }) => c.providerCode === 'MULTINET').onlineAvailable,
    ).toBe(false);
    expect(settings.body.connections.map((c: { providerCode: string }) => c.providerCode)).toEqual([
      'EDENRED',
      'MULTINET',
    ]);

    const accepted = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/payment-methods`).expect(200);
    expect(accepted.body.onlineCard).toBe(false);
    expect(accepted.body.mealCardsOnline).toEqual([]);
    expect(accepted.body.mealCardsOnDelivery.map((c: { name: string }) => c.name)).toEqual(['Edenred', 'Multinet']);
    expect(JSON.stringify(accepted.body)).not.toContain('"id"');
    const menu = await ctx.http().get(`/public/qr/${SEED.tableToken}`).expect(200);
    expect(menu.body.payment.mealCardsOnDelivery).toHaveLength(2);
  });

  it('refuses online acceptance without an adapter, verifies credentials and never returns them', async () => {
    const unavailable = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/meal-cards`)
      .set(bearer(ownerToken))
      .send({
        providerCode: 'MULTINET',
        acceptsOnline: true,
        credentials: { merchantId: 'm', apiKey: 'k', apiSecret: 's' },
      })
      .expect(409);
    expect(unavailable.body.code).toBe('MEAL_CARD_PROVIDER_UNAVAILABLE');

    const failed = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/meal-cards`)
      .set(bearer(ownerToken))
      .send({
        providerCode: 'MOCK',
        acceptsOnline: true,
        acceptsOnDelivery: false,
        credentials: { merchantId: 'bad-1' },
      })
      .expect(200);
    const failedRow = failed.body.connections.find((c: { providerCode: string }) => c.providerCode === 'MOCK');
    expect(failedRow.status).toBe('FAILED');

    const ok = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/meal-cards`)
      .set(bearer(ownerToken))
      .send({
        providerCode: 'MOCK',
        acceptsOnline: true,
        acceptsOnDelivery: false,
        credentials: { merchantId: 'mock-1234', apiSecret: 'issuer-secret' },
      })
      .expect(200);
    const row = ok.body.connections.find((c: { providerCode: string }) => c.providerCode === 'MOCK');
    expect(row.status).toBe('ACTIVE');
    expect(row.label).toBe('Test kart ****1234');
    expect(JSON.stringify(ok.body)).not.toContain('issuer-secret');
    const stored = await ctx.prisma.mealCardConnection.findUniqueOrThrow({
      where: { restaurantId_providerCode: { restaurantId, providerCode: 'MOCK' } },
    });
    expect(stored.encryptedCredentials).not.toContain('issuer-secret');
    const accepted = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/payment-methods`).expect(200);
    expect(accepted.body.mealCardsOnline.map((c: { providerCode: string }) => c.providerCode)).toEqual(['MOCK']);
  });

  it('an online meal card order waits for payment, checks out and is placed by the signed webhook', async () => {
    const created = await createOrder({ method: 'MEAL_CARD', providerCode: 'MOCK' });
    expect(created.body.status).toBe('PENDING_PAYMENT');
    expect(created.body.payment).toMatchObject({ method: 'MEAL_CARD', providerCode: 'MOCK', status: 'PENDING' });
    expect(created.body.payment.dueMinor).toBe(created.body.chargedToCustomerMinor);
    const orderId = created.body.id as string;
    const token = (created.body.trackingUrl as string).split('/t/')[1];

    const checkout = await ctx
      .http()
      .post(`/public/orders/${token}/checkout`)
      .send({ returnUrl: 'https://app.example.com/odeme' })
      .expect(200);
    expect(checkout.body.session.redirectUrl).toContain('mockSession=');
    expect(checkout.body.session.providerCode).toBe('MOCK');

    const connection = await ctx.prisma.mealCardConnection.findUniqueOrThrow({
      where: { restaurantId_providerCode: { restaurantId, providerCode: 'MOCK' } },
    });
    const body = JSON.stringify({
      providerRef: 'issuer-tx-1',
      orderRef: orderId,
      status: 'CAPTURED',
      amountMinor: created.body.chargedToCustomerMinor,
      currency: 'TRY',
      pspFeeMinor: null,
      occurredAt: new Date().toISOString(),
    });
    const bad = await ctx
      .http()
      .post(`/webhooks/payments/meal-cards/${connection.id}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign('wrong', body))
      .send(body)
      .expect(400);
    expect(bad.body.code).toBe('WEBHOOK_INVALID');
    expect((await getOrder(orderId)).status).toBe('PENDING_PAYMENT');

    const good = await ctx
      .http()
      .post(`/webhooks/payments/meal-cards/${connection.id}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign('issuer-secret', body))
      .send(body)
      .expect(200);
    expect(good.body.status).toBe('CAPTURED');
    const placed = await getOrder(orderId);
    expect(placed.status).toBe('PLACED');
    expect(placed.payment).toMatchObject({ status: 'CAPTURED', dueMinor: 0 });
    expect(placed.history.at(-1)).toMatchObject({ from: 'PENDING_PAYMENT', to: 'PLACED', reason: 'payment captured' });
    // Delivery of the same notification twice changes nothing.
    await ctx
      .http()
      .post(`/webhooks/payments/meal-cards/${connection.id}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign('issuer-secret', body))
      .send(body)
      .expect(200);
    expect((await getOrder(orderId)).history).toHaveLength(2);
  });

  it('refuses cards the restaurant does not take and settles door payments like OWN_POS even in PLATFORM_PSP', async () => {
    const refused = await createOrder({ method: 'MEAL_CARD', providerCode: 'PLUXEE' }, 409);
    expect(refused.body.code).toBe('PAYMENT_METHOD_NOT_ACCEPTED');
    // No online adapter for the issuer: the card is taken at the door and the order is placed at once.
    const fallback = await createOrder({ method: 'MEAL_CARD', providerCode: 'MULTINET' });
    expect(fallback.body.status).toBe('PLACED');
    expect(fallback.body.payment).toMatchObject({ method: 'MEAL_CARD', providerCode: 'MULTINET', status: 'PENDING' });
    const noPos = await createOrder({ method: 'ONLINE_CARD' }, 409);
    expect(noPos.body.code).toBe('PAYMENT_METHOD_NOT_ACCEPTED');

    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    try {
      const cash = await createOrder({ method: 'CASH_ON_DELIVERY' });
      expect(cash.body.status).toBe('PLACED');
      const row = await ctx.prisma.order.findUniqueOrThrow({ where: { id: cash.body.id } });
      expect(row.paymentMode).toBe('OWN_POS');
      expect(row.platformReceivableMinor).toBeGreaterThan(0);
      expect(row.pspFeeMinor).toBe(0);
    } finally {
      await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    }
  });

  it('an online card order uses the restaurant POS gateway and its webhook', async () => {
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/connection`)
      .set(bearer(ownerToken))
      .send({ providerCode: 'MOCK', credentials: { merchantId: 'merchant-77' } })
      .expect(200);
    const created = await createOrder({ method: 'ONLINE_CARD' });
    expect(created.body.status).toBe('PENDING_PAYMENT');
    const session = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${created.body.id}/checkout`)
      .set(bearer(ownerToken))
      .send({ returnUrl: 'https://app.example.com/odeme' })
      .expect(200);
    expect(session.body.session.redirectUrl).toContain('mockSession=');
    const pos = await ctx.prisma.paymentProviderConnection.findUniqueOrThrow({ where: { restaurantId } });
    const body = JSON.stringify({
      providerRef: 'pos-tx-1',
      orderRef: created.body.id,
      status: 'CAPTURED',
      amountMinor: created.body.chargedToCustomerMinor,
      currency: 'TRY',
      pspFeeMinor: 120,
      occurredAt: new Date().toISOString(),
    });
    await ctx
      .http()
      .post(`/webhooks/payments/pos/${pos.id}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign('merchant-77', body))
      .send(body)
      .expect(200);
    expect((await getOrder(created.body.id)).status).toBe('PLACED');
  });

  it('a webhook settles only the payment of its own kind and never moves a captured payment back to failed', async () => {
    const created = await createOrder({ method: 'ONLINE_CARD' });
    expect(created.body.status).toBe('PENDING_PAYMENT');
    const orderId = created.body.id as string;
    const event = (status: string, providerRef: string) =>
      JSON.stringify({
        providerRef,
        orderRef: orderId,
        status,
        amountMinor: created.body.chargedToCustomerMinor,
        currency: 'TRY',
        pspFeeMinor: null,
        occurredAt: new Date().toISOString(),
      });
    // The meal card connection's own secret is valid, but this order is paid by the restaurant POS.
    const mealCard = await ctx.prisma.mealCardConnection.findUniqueOrThrow({
      where: { restaurantId_providerCode: { restaurantId, providerCode: 'MOCK' } },
    });
    const wrongKind = event('CAPTURED', 'issuer-tx-cross');
    const ignored = await ctx
      .http()
      .post(`/webhooks/payments/meal-cards/${mealCard.id}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign('issuer-secret', wrongKind))
      .send(wrongKind)
      .expect(200);
    expect(ignored.body.status).toBe('IGNORED');
    expect((await getOrder(orderId)).status).toBe('PENDING_PAYMENT');

    const pos = await ctx.prisma.paymentProviderConnection.findUniqueOrThrow({ where: { restaurantId } });
    const captured = event('CAPTURED', 'pos-tx-2');
    await ctx
      .http()
      .post(`/webhooks/payments/pos/${pos.id}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign('merchant-77', captured))
      .send(captured)
      .expect(200);
    // A late FAILED for an earlier attempt arrives after the capture.
    const failed = event('FAILED', 'pos-tx-1-late');
    const late = await ctx
      .http()
      .post(`/webhooks/payments/pos/${pos.id}`)
      .set('content-type', 'application/json')
      .set('x-mock-signature', sign('merchant-77', failed))
      .send(failed)
      .expect(200);
    expect(late.body.status).toBe('IGNORED');
    const order = await getOrder(orderId);
    expect(order.status).toBe('PLACED');
    expect(order.payment).toMatchObject({ status: 'CAPTURED', dueMinor: 0 });
  });

  it('an order without a payment intent settles like OWN_POS in a PLATFORM_PSP restaurant', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
    try {
      const created = await ctx
        .http()
        .post(`/restaurants/${restaurantId}/orders`)
        .set(bearer(ownerToken))
        .send({
          branchId,
          channel: 'RESTAURANT_SITE',
          fulfillment: 'DELIVERY',
          items: [{ menuItemId: kofteId, quantity: 1 }],
          address,
          deliveryFeeMinor: 1000,
          note: NOTE,
        })
        .expect(201);
      const row = await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.body.id } });
      // The platform collected nothing, so it owes no payout: commission and VAT go on the month-end invoice.
      expect(row.paymentMode).toBe('OWN_POS');
      expect(row.pspFeeMinor).toBe(0);
      expect(row.platformReceivableMinor).toBeGreaterThan(0);
    } finally {
      await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    }
  });

  it('the courier records a meal card taken at the door for a stop of their own trip', async () => {
    const created = await createOrder({ method: 'MEAL_CARD', providerCode: 'MULTINET', atDoor: true });
    expect(created.body.status).toBe('PLACED');
    expect(created.body.payment).toMatchObject({ method: 'MEAL_CARD', providerCode: 'MULTINET', status: 'PENDING' });
    const orderId = created.body.id as string;
    await transition(orderId, 'ACCEPTED', { prepMinutes: 5 });
    await transition(orderId, 'READY');
    const trip = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/dispatch/trips`)
      .set(bearer(ownerToken))
      .send({ orderIds: [orderId], courierMembershipId })
      .expect(201);
    tripIds.push(trip.body.id);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${trip.body.id}/start`)
      .set(bearer(courierToken))
      .expect(200);
    const stopId = trip.body.stops[0].id as string;

    const early = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${trip.body.id}/stops/${stopId}/collect`)
      .set(bearer(courierToken))
      .send({ method: 'MEAL_CARD', providerCode: 'PLUXEE' })
      .expect(409);
    expect(early.body.code).toBe('PAYMENT_METHOD_NOT_ACCEPTED');

    const collected = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${trip.body.id}/stops/${stopId}/collect`)
      .set(bearer(courierToken))
      .send({ method: 'MEAL_CARD', providerCode: 'MULTINET', reference: 'SLIP-001' })
      .expect(200);
    expect(collected.body.payment).toMatchObject({
      method: 'MEAL_CARD',
      providerCode: 'MULTINET',
      status: 'CAPTURED',
      dueMinor: 0,
    });
    // The courier does not see the customer's full phone number.
    expect(collected.body.customer.phone).toMatch(/\*/);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect(payment.providerRef).toBe('SLIP-001');
    expect(payment.collectedByUserId).toBeTruthy();
    expect(payment.paymentMode).toBe('OWN_POS');

    const again = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${trip.body.id}/stops/${stopId}/collect`)
      .set(bearer(courierToken))
      .send({ method: 'CASH_ON_DELIVERY' })
      .expect(409);
    expect(again.body.code).toBe('PAYMENT_STATE_INVALID');
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/courier/me/trips/${trip.body.id}/stops/${stopId}/deliver`)
      .set(bearer(courierToken))
      .expect(200);
    expect((await getOrder(orderId)).status).toBe('DELIVERED');
  });

  it('a courier cannot manage meal cards', async () => {
    const res = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/payments/meal-cards`)
      .set(bearer(courierToken))
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
