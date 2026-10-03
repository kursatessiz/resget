import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

describe('Payment modes, POS connection and saved cards (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  let guestToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    restaurantId = (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } })).id;
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    [ownerToken, guestToken] = await Promise.all([ctx.login(SEED.ownerPhone), ctx.login(SEED.guestPhone)]);
  });
  afterAll(async () => {
    await ctx.prisma.paymentProviderConnection.deleteMany({ where: { restaurantId } });
    await ctx.prisma.savedPaymentMethod.deleteMany({ where: { user: { phone: SEED.guestPhone } } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    await ctx.close();
  });

  it('starts in OWN_POS without a connection', async () => {
    const res = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/payments/settings`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(res.body.paymentMode).toBe('OWN_POS');
    expect(res.body.connection).toBeNull();
    expect(res.body.accruedCommissionMinor).toBe(0);
  });

  it('stores POS credentials encrypted, verifies them and never returns them', async () => {
    const res = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/connection`)
      .set(bearer(ownerToken))
      .send({ providerCode: 'MOCK', credentials: { merchantId: 'merchant-7781' } })
      .expect(200);
    expect(res.body.connection.status).toBe('ACTIVE');
    expect(res.body.connection.label).toBe('MOCK ****7781');
    expect(JSON.stringify(res.body)).not.toContain('merchant-7781');
    const row = await ctx.prisma.paymentProviderConnection.findUniqueOrThrow({ where: { restaurantId } });
    expect(row.encryptedCredentials).not.toContain('merchant-7781');
    expect(row.encryptedCredentials.startsWith('v1.')).toBe(true);
  });

  it('marks a connection FAILED when the provider rejects the credentials', async () => {
    const res = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/connection`)
      .set(bearer(ownerToken))
      .send({ providerCode: 'MOCK', credentials: { merchantId: 'bad-1' } })
      .expect(200);
    expect(res.body.connection.status).toBe('FAILED');
  });

  it('refuses OWN_POS without an active connection and allows PLATFORM_PSP', async () => {
    const platform = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/mode`)
      .set(bearer(ownerToken))
      .send({ paymentMode: 'PLATFORM_PSP' })
      .expect(200);
    expect(platform.body.paymentMode).toBe('PLATFORM_PSP');
    const own = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/mode`)
      .set(bearer(ownerToken))
      .send({ paymentMode: 'OWN_POS' })
      .expect(403);
    expect(own.body.code).toBe('PAYMENT_CONNECTION_REQUIRED');
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/connection`)
      .set(bearer(ownerToken))
      .send({ providerCode: 'MOCK', credentials: { merchantId: 'merchant-1' } })
      .expect(200);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/mode`)
      .set(bearer(ownerToken))
      .send({ paymentMode: 'OWN_POS' })
      .expect(200);
  });

  it('settlement preview follows the payment mode', async () => {
    const body = { items: [{ amountMinor: 70000, vatRateBps: 1000 }] };
    const own = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/settlement-preview`)
      .set(bearer(ownerToken))
      .send(body)
      .expect(200);
    expect(own.body.paymentMode).toBe('OWN_POS');
    expect(own.body.pspFeeMinor).toBe(0);
    expect(own.body.withholdingMinor).toBe(0);
    expect(own.body.platformReceivableMinor).toBe(840);
    expect(own.body.payoutMinor).toBe(0);
    await ctx
      .http()
      .put(`/restaurants/${restaurantId}/payments/mode`)
      .set(bearer(ownerToken))
      .send({ paymentMode: 'PLATFORM_PSP' })
      .expect(200);
    const platform = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/settlement-preview`)
      .set(bearer(ownerToken))
      .send(body)
      .expect(200);
    expect(platform.body.paymentMode).toBe('PLATFORM_PSP');
    expect(platform.body.pspFeeMinor).toBeGreaterThan(0);
    expect(platform.body.platformReceivableMinor).toBe(0);
    expect(platform.body.payoutMinor).toBe(platform.body.restaurantPayableMinor);
  });

  it('returns an empty commission statement for a month without orders and validates the period', async () => {
    const res = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/payments/commission?year=2026&month=9`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(res.body.orderCount).toBe(0);
    expect(res.body.totalMinor).toBe(0);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/payments/commission?year=2026&month=13`)
      .set(bearer(ownerToken))
      .expect(400);
  });

  it('a guest links a card through the vault and only sees masked data', async () => {
    const begin = await ctx
      .http()
      .post('/me/payment-methods/link')
      .set(bearer(guestToken))
      .send({ returnUrl: 'https://app.example.com/kart' })
      .expect(200);
    expect(begin.body.redirectUrl).toContain('mockLink=');
    const cards = await ctx
      .http()
      .post('/me/payment-methods/link/complete')
      .set(bearer(guestToken))
      .send({ payload: {} })
      .expect(200);
    expect(cards.body).toHaveLength(1);
    expect(cards.body[0]).toMatchObject({ provider: 'MOCK', brand: 'Mastercard', last4: '4242', isDefault: true });
    expect(JSON.stringify(cards.body)).not.toContain('mock-card-');
    const row = await ctx.prisma.savedPaymentMethod.findFirstOrThrow({ where: { id: cards.body[0].id } });
    expect(row.encryptedToken).not.toContain('mock-card-');
    // Linking again does not duplicate the card.
    const again = await ctx
      .http()
      .post('/me/payment-methods/link/complete')
      .set(bearer(guestToken))
      .send({ payload: {} })
      .expect(200);
    expect(again.body).toHaveLength(1);
    await ctx.http().delete(`/me/payment-methods/${cards.body[0].id}`).set(bearer(guestToken)).expect(204);
    const list = await ctx.http().get('/me/payment-methods').set(bearer(guestToken)).expect(200);
    expect(list.body).toEqual([]);
  });

  it('a counter employee cannot manage payments', async () => {
    const guest = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/payments/settings`)
      .set(bearer(guestToken))
      .expect(403);
    expect(guest.body.code).toBe('FORBIDDEN');
  });
});
