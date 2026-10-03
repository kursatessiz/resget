import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Messaging engine: order notifications, wallet debit only on SENT, settings, credit purchase (docs/MESAJLASMA.md). */
describe('Messaging engine (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let branchId: string;
  let ownerToken: string;
  let menuItemId: string;
  let smsWalletId: string;
  let originalBalance = 0;
  const createdOrders: string[] = [];

  const placeOrder = async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId, quantity: 1 }],
        address: {
          addressLine: 'Moda Cad. No 5',
          city: 'Istanbul',
          district: 'Kadikoy',
          contactName: 'E2E Musteri',
          contactPhone: '0532 999 07 07',
          point: { lat: 40.985, lng: 29.03 },
        },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(201);
    createdOrders.push(res.body.id as string);
    return res.body.id as string;
  };
  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(200);
  const balance = async () =>
    (await ctx.prisma.messageWallet.findUniqueOrThrow({ where: { id: smsWalletId }, select: { balance: true } }))
      .balance;
  const logsFor = (templateKey: string) =>
    ctx.prisma.messageLog.findMany({ where: { restaurantId, templateKey }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true, menuItems: { take: 1 } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    menuItemId = restaurant.menuItems[0].id;
    ownerToken = await ctx.login(SEED.ownerPhone);
    const wallet = await ctx.prisma.messageWallet.findUniqueOrThrow({
      where: { restaurantId_channel: { restaurantId, channel: 'SMS' } },
    });
    smsWalletId = wallet.id;
    originalBalance = wallet.balance;
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { notificationSettings: { customerOrderUpdates: true, channel: 'SMS', fallbackToSms: true } },
    });
  });

  afterAll(async () => {
    await ctx.prisma.messageWallet.update({ where: { id: smsWalletId }, data: { balance: originalBalance } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { notificationSettings: { customerOrderUpdates: true, channel: 'SMS', fallbackToSms: true } },
    });
    await ctx.prisma.messageLog.deleteMany({ where: { restaurantId, templateKey: { startsWith: 'order.' } } });
    if (createdOrders.length) await ctx.prisma.order.deleteMany({ where: { id: { in: createdOrders } } });
    await ctx.close();
  });

  it('logs the OTP as platform traffic without charging anyone', async () => {
    const otp = await ctx.prisma.messageLog.findFirst({
      where: { templateKey: 'otp.code', restaurantId: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(otp?.status).toBe('SENT');
    expect(otp?.creditsCharged).toBe(0);
  });

  it('shows wallets, packages in the restaurant currency and default settings', async () => {
    const res = await ctx.http().get(`/restaurants/${restaurantId}/messaging`).set(bearer(ownerToken)).expect(200);
    expect(res.body.wallets.map((w: { channel: string }) => w.channel).sort()).toEqual(['SMS', 'WHATSAPP']);
    expect(res.body.packages.every((p: { currency: string }) => p.currency === 'TRY')).toBe(true);
    expect(res.body.packages.length).toBeGreaterThan(0);
    expect(res.body.settings.customerOrderUpdates).toBe(true);
  });

  it('messages the customer when the order is accepted and debits one credit after the provider accepted', async () => {
    await ctx.prisma.messageWallet.update({ where: { id: smsWalletId }, data: { balance: 5 } });
    const orderId = await placeOrder();
    await transition(orderId, 'ACCEPTED', { prepMinutes: 20 });
    const [log] = await logsFor('order.accepted');
    expect(log.status).toBe('SENT');
    expect(log.creditsCharged).toBe(1);
    expect(log.toMasked).toMatch(/\*/);
    expect(await balance()).toBe(4);
    const tx = await ctx.prisma.messageTransaction.findFirst({ where: { walletId: smsWalletId, reference: log.id } });
    expect(tx?.type).toBe('DEBIT');
    expect(tx?.balanceAfter).toBe(4);
  });

  it('refuses to send without credits and never lets the wallet go negative', async () => {
    await ctx.prisma.messageWallet.update({ where: { id: smsWalletId }, data: { balance: 0 } });
    const orderId = await placeOrder();
    await transition(orderId, 'REJECTED', { reason: 'Mutfak kapali' });
    const [log] = await logsFor('order.rejected');
    expect(log.status).toBe('FAILED');
    expect(log.errorCode).toBe('INSUFFICIENT_CREDITS');
    expect(log.creditsCharged).toBe(0);
    expect(await balance()).toBe(0);
  });

  it('sends nothing when the restaurant switched customer updates off', async () => {
    await ctx.prisma.messageWallet.update({ where: { id: smsWalletId }, data: { balance: 5 } });
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/messaging/settings`)
      .set(bearer(ownerToken))
      .send({ customerOrderUpdates: false, channel: 'SMS', fallbackToSms: true })
      .expect(200);
    const before = (await logsFor('order.accepted')).length;
    const orderId = await placeOrder();
    await transition(orderId, 'ACCEPTED');
    expect((await logsFor('order.accepted')).length).toBe(before);
    expect(await balance()).toBe(5);
  });

  it('falls back to SMS when WhatsApp is preferred but refuses', async () => {
    await ctx.prisma.messageWallet.update({ where: { id: smsWalletId }, data: { balance: 5 } });
    const wa = await ctx.prisma.messageWallet.findUniqueOrThrow({
      where: { restaurantId_channel: { restaurantId, channel: 'WHATSAPP' } },
    });
    const waBefore = wa.balance;
    // No WhatsApp credit: the preferred channel is refused before the provider and the SMS fallback carries the message.
    await ctx.prisma.messageWallet.update({ where: { id: wa.id }, data: { balance: 0 } });
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/messaging/settings`)
      .set(bearer(ownerToken))
      .send({ customerOrderUpdates: true, channel: 'WHATSAPP', fallbackToSms: true })
      .expect(200);
    const orderId = await placeOrder();
    await transition(orderId, 'ACCEPTED');
    const logs = (await logsFor('order.accepted')).slice(0, 2);
    expect(logs.map((l) => `${l.channel}:${l.status}`).sort()).toEqual(['SMS:SENT', 'WHATSAPP:FAILED']);
    expect(await balance()).toBe(4);
    await ctx.prisma.messageWallet.update({ where: { id: wa.id }, data: { balance: waBefore } });
  });

  it('buys a credit package with a saved card through the vault', async () => {
    await ctx.prisma.messageWallet.update({ where: { id: smsWalletId }, data: { balance: 1 } });
    await ctx
      .http()
      .post('/me/payment-methods/link')
      .set(bearer(ownerToken))
      .send({ returnUrl: 'http://localhost:3000/panel/demo-lokanta/plan' })
      .expect(200);
    const cards = await ctx
      .http()
      .post('/me/payment-methods/link/complete')
      .set(bearer(ownerToken))
      .send({ payload: { mockLink: 'owner' } })
      .expect(200);
    const cardId = cards.body[0].id as string;
    const pkg = await ctx.prisma.messageCreditPackage.findFirstOrThrow({ where: { channel: 'SMS', currency: 'TRY' } });
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/messaging/purchase`)
      .set(bearer(ownerToken))
      .send({
        packageCode: pkg.code,
        paymentMethodId: cardId,
        returnUrl: 'http://localhost:3000/panel/demo-lokanta/plan',
      })
      .expect(200);
    expect(res.body.status).toBe('CAPTURED');
    expect(res.body.wallets.find((w: { channel: string }) => w.channel === 'SMS').balance).toBe(1 + pkg.credits);
    const tx = await ctx.prisma.messageTransaction.findFirst({
      where: { walletId: smsWalletId, type: 'PURCHASE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(tx?.delta).toBe(pkg.credits);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/messaging/purchase`)
      .set(bearer(ownerToken))
      .send({ packageCode: 'yok-boyle-paket', paymentMethodId: cardId, returnUrl: 'http://localhost:3000/x' })
      .expect(404)
      .expect('x-error-code', 'PACKAGE_NOT_FOUND');
  });
});
