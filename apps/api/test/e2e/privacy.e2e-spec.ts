import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const PHONE = normalizePhone('0532 999 08 51')!;
const NOTE = 'e2e-privacy';
const OTP_TEST_CODE = process.env.OTP_TEST_CODE ?? '482915';

/** Personal data export and account deletion (docs/KISISEL_VERI.md). */
describe('Personal data rights (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let menuItemId: string;
  const userIds: string[] = [];

  const signIn = async () => {
    await ctx.prisma.otpCode.deleteMany({ where: { phone: PHONE } });
    await ctx.http().post('/auth/otp/request').send({ phone: PHONE }).expect(200);
    const res = await ctx.http().post('/auth/otp/verify').send({ phone: PHONE, code: OTP_TEST_CODE }).expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  };
  const staffOrder = async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(bearer(ownerToken))
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'DELIVERY',
        items: [{ menuItemId, quantity: 1 }],
        customer: { fullName: 'Gizlilik Musteri', phone: PHONE },
        address: {
          addressLine: 'Moda Cad. No 9 D 2',
          city: 'Istanbul',
          district: 'Kadikoy',
          note: 'Zil bozuk',
          contactName: 'Gizlilik Musteri',
          contactPhone: PHONE,
          point: { lat: 40.988, lng: 29.027 },
        },
        payment: { method: 'CASH_ON_DELIVERY' },
        note: NOTE,
      })
      .expect(201);
    return res.body as { id: string; shortCode: string };
  };
  const transition = (orderId: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(bearer(ownerToken))
      .send({ to, ...extra })
      .expect(200);
  const cleanup = async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    const users = await ctx.prisma.user.findMany({
      where: { OR: [{ phone: PHONE }, { id: { in: userIds } }] },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await ctx.prisma.order.deleteMany({ where: { customerUserId: { in: ids } } });
    await ctx.prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: ids } } });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, branches: { take: 1, select: { id: true } } },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    menuItemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await ctx.close();
  });

  it('exports what the platform holds, refuses deletion while something is open, then deletes for good', async () => {
    const done = await staffOrder();
    await transition(done.id, 'ACCEPTED', { prepMinutes: 10 });
    await transition(done.id, 'READY');
    await transition(done.id, 'OUT_FOR_DELIVERY');
    await transition(done.id, 'DELIVERED');

    const tokens = await signIn();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    userIds.push(user.id);
    await ctx
      .http()
      .post('/me/addresses')
      .set(bearer(tokens.accessToken))
      .send({ label: 'Ev', addressLine: 'Moda Cad. No 9 D 2', city: 'Istanbul', district: 'Kadikoy' })
      .expect(201);
    const customer = await ctx.prisma.restaurantCustomer.findUniqueOrThrow({
      where: { restaurantId_userId: { restaurantId, userId: user.id } },
    });
    await ctx.prisma.restaurantCustomer.update({
      where: { id: customer.id },
      data: { marketingOptIn: true, marketingToken: `tok-${user.id}`, note: 'Acili sever', loyaltyPoints: 40 },
    });

    const exported = await ctx.http().get('/me/data-export').set(bearer(tokens.accessToken)).expect(200);
    expect(exported.body.profile.phone).toBe(PHONE);
    expect(exported.body.addresses).toHaveLength(1);
    expect(exported.body.orders.map((o: { shortCode: string }) => o.shortCode)).toContain(done.shortCode);
    expect(exported.body.restaurants[0]).toMatchObject({ marketingOptIn: true, loyaltyPoints: 40 });

    // An open order blocks the deletion; an owner can never delete themselves here.
    const open = await staffOrder();
    const blocked = await ctx
      .http()
      .post('/me/account/delete')
      .set(bearer(tokens.accessToken))
      .send({ confirm: true })
      .expect(409);
    expect(blocked.body.code).toBe('ACCOUNT_DELETE_ACTIVE_ORDERS');
    await transition(open.id, 'REJECTED');
    const owner = await ctx
      .http()
      .post('/me/account/delete')
      .set(bearer(ownerToken))
      .send({ confirm: true })
      .expect(409);
    expect(owner.body.code).toBe('ACCOUNT_DELETE_OWNER');
    await ctx.http().post('/me/account/delete').set(bearer(tokens.accessToken)).send({}).expect(400);

    await ctx.http().post('/me/account/delete').set(bearer(tokens.accessToken)).send({ confirm: true }).expect(204);

    // The old session is dead, access and refresh alike.
    await ctx.http().get('/me/account').set(bearer(tokens.accessToken)).expect(401);
    await ctx.http().post('/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);

    const tombstone = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(tombstone.phone).toBe(`deleted:${user.id}`);
    expect(tombstone).toMatchObject({ fullName: '', email: null });
    expect(tombstone.deletedAt).not.toBeNull();
    expect(await ctx.prisma.customerAddress.count({ where: { userId: user.id } })).toBe(0);
    const after = await ctx.prisma.restaurantCustomer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after).toMatchObject({ marketingOptIn: false, marketingToken: null, note: null, loyaltyPoints: 0 });
    // Both orders still count in the restaurant's figures.
    expect(after.orderCount).toBe(2);
    const adjustment = await ctx.prisma.loyaltyTransaction.findFirstOrThrow({
      where: { customerId: customer.id, type: 'ADJUSTMENT' },
    });
    expect(adjustment).toMatchObject({ points: -40, balanceAfter: 0 });

    // The kept order has no name, number or street; the area stays.
    const kept = await ctx.prisma.order.findUniqueOrThrow({ where: { id: done.id } });
    expect(kept.addressSnapshot).toEqual({
      addressLine: '',
      city: 'Istanbul',
      district: 'Kadikoy',
      contactName: '',
      contactPhone: '',
      point: null,
    });
    expect(kept.chargedToCustomerMinor).toBeGreaterThan(0);
    const panelOrder = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/orders/${done.id}`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(panelOrder.body.customer).toMatchObject({ fullName: null, phone: null });
    const list = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/customers`)
      .set(bearer(ownerToken))
      .query({ query: 'Gizlilik' })
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('Gizlilik');

    // The number is free again: signing in makes a new, empty account.
    await signIn();
    const fresh = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    userIds.push(fresh.id);
    expect(fresh.id).not.toBe(user.id);
  });
});
