import type { PaymentMode } from '@resget/database';
import { normalizePhone } from '@resget/shared';
import type {
  AcceptedPaymentMethodsDTO,
  PublicOrderResultDTO,
  StorefrontViewerDTO,
  WalletLinkStartDTO,
  WalletsDTO,
} from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const RETURN_URL = 'https://app.example.com/hesabim';

/** Platform wallets: link Masterpass, pay a platform-collected order with it, refuse elsewhere (docs/CUZDAN.md). */
describe('Platform wallets (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let customerToken: string;
  let otherToken: string;
  let restaurantId: string;
  let menuItemId: string;
  let original: PaymentMode;
  const phone = normalizePhone('05329990941')!;
  const otherPhone = normalizePhone('05329990942')!;
  const orderIds: string[] = [];

  const accepted = async () =>
    (await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/payment-methods`).expect(200))
      .body as AcceptedPaymentMethodsDTO;
  const wallets = async (token = customerToken) =>
    (await ctx.http().get('/me/wallets').set(bearer(token)).expect(200)).body as WalletsDTO;
  const publicOrder = (savedPaymentMethodId: string, token?: string) => {
    const req = ctx.http().post(`/public/restaurants/${SEED.restaurantSlug}/orders`);
    return (token ? req.set(bearer(token)) : req).send({
      fulfillment: 'PICKUP',
      items: [{ menuItemId, quantity: 1 }],
      customer: { fullName: 'Cuzdan Musteri', phone },
      payment: { method: 'ONLINE_CARD', savedPaymentMethodId },
      returnUrl: 'https://app.example.com/t/',
    });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [phone, otherPhone] } } });
    [adminToken, ownerToken, customerToken, otherToken] = await Promise.all([
      ctx.login(SEED.superAdminPhone),
      ctx.login(SEED.ownerPhone),
      ctx.login(phone),
      ctx.login(otherPhone),
    ]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    restaurantId = restaurant.id;
    original = restaurant.paymentMode;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
  });

  afterAll(async () => {
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.featureFlag.deleteMany({ where: { key: 'platform_wallets' } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: original } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: [phone, otherPhone] } } });
    await ctx.close();
  });

  it('is off by default', async () => {
    expect((await wallets()).wallets).toEqual([]);
    expect((await accepted()).wallets).toEqual([]);
    await ctx
      .http()
      .post('/me/wallets/MASTERPASS/link')
      .set(bearer(customerToken))
      .send({ returnUrl: RETURN_URL })
      .expect(404);
    await ctx
      .http()
      .put('/admin/features/platform_wallets')
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    expect((await wallets()).wallets.map((w) => w.code)).toEqual(['MASTERPASS', 'BEX']);
    expect((await accepted()).wallets).toEqual([
      { code: 'MASTERPASS', name: 'Masterpass' },
      { code: 'BEX', name: 'bex' },
    ]);
  });

  it('links a Masterpass card in the account and offers it on the ordering page', async () => {
    const start = (
      await ctx
        .http()
        .post('/me/wallets/MASTERPASS/link')
        .set(bearer(customerToken))
        .send({ returnUrl: RETURN_URL })
        .expect(200)
    ).body as WalletLinkStartDTO;
    expect(start.redirectUrl).toContain(`${RETURN_URL}?mockLink=`);
    const linked = (
      await ctx
        .http()
        .post('/me/wallets/MASTERPASS/link/complete')
        .set(bearer(customerToken))
        .send({ payload: { mockLink: 'x' } })
        .expect(200)
    ).body as WalletsDTO;
    expect(linked.cards).toEqual([
      expect.objectContaining({ provider: 'MASTERPASS', brand: 'Mastercard', last4: '4242' }),
    ]);
    const stored = await ctx.prisma.savedPaymentMethod.findFirstOrThrow({ where: { user: { phone } } });
    expect(stored.encryptedToken).not.toContain('mock-masterpass');
    const viewer = (
      await ctx.http().get(`/me/viewer?restaurantId=${restaurantId}`).set(bearer(customerToken)).expect(200)
    ).body as StorefrontViewerDTO;
    expect(viewer.walletCards.map((c) => c.id)).toEqual([stored.id]);
  });

  it('pays a platform-collected order with the wallet card at once, refunded through the platform gateway', async () => {
    const card = (await wallets()).cards[0];
    expect((await publicOrder(card.id).expect(409)).headers['x-error-code']).toBe('WALLET_SIGN_IN_REQUIRED');
    expect((await publicOrder(card.id, otherToken).expect(409)).headers['x-error-code']).toBe('WALLET_UNAVAILABLE');

    const result = (await publicOrder(card.id, customerToken).expect(201)).body as PublicOrderResultDTO;
    expect(result).toMatchObject({ status: 'PLACED', checkoutUrl: null });
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { trackingToken: result.trackingToken },
      include: { payments: true },
    });
    orderIds.push(order.id);
    expect(order.payments).toEqual([
      expect.objectContaining({
        status: 'CAPTURED',
        provider: 'MOCK',
        paymentMode: 'PLATFORM_PSP',
        savedPaymentMethodId: card.id,
        amountMinor: order.chargedToCustomerMinor,
      }),
    ]);

    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${order.id}/transition`)
      .set(bearer(ownerToken))
      .send({ to: 'REJECTED', reason: 'Malzeme bitti' })
      .expect(200);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment).toMatchObject({ status: 'REFUNDED', refundedMinor: order.chargedToCustomerMinor });
  });

  it('is not taken where the restaurant collects on its own POS', async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'OWN_POS' } });
    expect((await accepted()).wallets).toEqual([]);
    const card = (await wallets()).cards[0];
    expect((await publicOrder(card.id, customerToken).expect(409)).headers['x-error-code']).toBe('WALLET_UNAVAILABLE');
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { paymentMode: 'PLATFORM_PSP' } });
  });

  it('removes a wallet card', async () => {
    const card = (await wallets()).cards[0];
    await ctx.http().delete(`/me/payment-methods/${card.id}`).set(bearer(customerToken)).expect(204);
    expect((await wallets()).cards).toEqual([]);
  });
});
