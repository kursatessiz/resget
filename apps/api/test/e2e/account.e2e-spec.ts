import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** The customer's account (docs/VITRIN.md): addresses, profile, own orders only, and the storefront viewer. */
describe('Customer account (e2e)', () => {
  let ctx: TestContext;
  let guestToken: string;
  let ownerToken: string;
  let guestId: string;
  let originalName: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    guestToken = await ctx.login(SEED.guestPhone);
    ownerToken = await ctx.login(SEED.ownerPhone);
    const guest = await ctx.prisma.user.findUniqueOrThrow({
      where: { phone: SEED.guestPhone },
      select: { id: true, fullName: true },
    });
    guestId = guest.id;
    originalName = guest.fullName;
    await ctx.prisma.customerAddress.deleteMany({ where: { userId: guestId } });
  });

  afterAll(async () => {
    await ctx.prisma.customerAddress.deleteMany({ where: { userId: guestId } });
    await ctx.prisma.user.update({ where: { id: guestId }, data: { fullName: originalName } });
    await ctx.close();
  });

  it('keeps addresses: the first is the default, defaults move, removal keeps one default', async () => {
    const first = await ctx
      .http()
      .post('/me/addresses')
      .set(bearer(guestToken))
      .send({
        label: 'Ev',
        addressLine: 'Bahariye Cad. No 20 D 4',
        city: 'Istanbul',
        district: 'Kadikoy',
        point: { lat: 40.98, lng: 29.03 },
      })
      .expect(201);
    expect(first.body).toHaveLength(1);
    expect(first.body[0]).toMatchObject({ label: 'Ev', isDefault: true, point: { lat: 40.98, lng: 29.03 } });
    const second = await ctx
      .http()
      .post('/me/addresses')
      .set(bearer(guestToken))
      .send({ label: 'Is', addressLine: 'Soguksu Sok. No 2', city: 'Istanbul', district: 'Kadikoy' })
      .expect(201);
    expect(second.body.map((a: { label: string; isDefault: boolean }) => [a.label, a.isDefault])).toEqual([
      ['Ev', true],
      ['Is', false],
    ]);
    const work = second.body.find((a: { label: string }) => a.label === 'Is');
    const moved = await ctx
      .http()
      .patch(`/me/addresses/${work.id}`)
      .set(bearer(guestToken))
      .send({ isDefault: true, note: 'Kapi 3' })
      .expect(200);
    expect(moved.body.find((a: { id: string }) => a.id === work.id)).toMatchObject({ isDefault: true, note: 'Kapi 3' });
    expect(moved.body.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
    const left = await ctx.http().delete(`/me/addresses/${work.id}`).set(bearer(guestToken)).expect(200);
    expect(left.body).toHaveLength(1);
    expect(left.body[0].isDefault).toBe(true);
    // Another user's address id is not reachable.
    await ctx.http().delete(`/me/addresses/${left.body[0].id}`).set(bearer(ownerToken)).expect(404);
  });

  it('shows the account with own orders only, the viewer for the storefront, and saves the name', async () => {
    const account = await ctx.http().get('/me/account').set(bearer(guestToken)).expect(200);
    expect(account.body.user.phone).toBe(SEED.guestPhone);
    expect(account.body.addresses).toHaveLength(1);
    const ownOrders = await ctx.prisma.order.count({ where: { customerUserId: guestId } });
    expect(account.body.orders.length).toBe(Math.min(50, ownOrders));
    for (const order of account.body.orders as { trackingUrl: string | null; restaurant: { slug: string } }[]) {
      expect(order.restaurant.slug).toBeTruthy();
    }
    const viewer = await ctx.http().get('/me/viewer').set(bearer(guestToken)).expect(200);
    expect(viewer.body).toMatchObject({ phone: SEED.guestPhone });
    expect(viewer.body.addresses).toHaveLength(1);
    const renamed = await ctx
      .http()
      .patch('/me/profile')
      .set(bearer(guestToken))
      .send({ fullName: 'Misafir Yeni' })
      .expect(200);
    expect(renamed.body.user.fullName).toBe('Misafir Yeni');
    await ctx.http().get('/me/account').expect(401);
  });
});
