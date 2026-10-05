import type { GroupCartDTO, GroupMembershipDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-group-orders';

/** A shared basket: everyone adds their own lines, the host places one order (docs/GRUP_SIPARISI.md). */
describe('Group orders (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let restaurantId: string;
  let kofteId: string;
  let ayranId: string;
  let host: GroupMembershipDTO;
  let guest: GroupMembershipDTO;
  // Our own client address, so the public limits are not shared with other suites.
  const client = `10.80.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
  const http = () => ctx.http();
  const as = (req: ReturnType<ReturnType<typeof http>['get']>, key?: string) =>
    key ? req.set('x-forwarded-for', client).set('x-group-key', key) : req.set('x-forwarded-for', client);
  const cart = async (key?: string) =>
    (await as(http().get(`/public/group-carts/${host.token}`), key).expect(200)).body as GroupCartDTO;
  const setLines = (who: GroupMembershipDTO, lines: unknown[], key = who.key) =>
    as(http().put(`/public/group-carts/${who.token}/participants/${who.participantId}/lines`), key).send({ lines });
  const checkout = (key?: string) =>
    as(http().post(`/public/group-carts/${host.token}/orders`), key).send({
      fulfillment: 'PICKUP',
      items: [{ menuItemId: kofteId, quantity: 99 }],
      customer: { fullName: 'Grup Sahibi', phone: '05329990995' },
      payment: { method: 'CASH_ON_DELIVERY' },
      note: NOTE,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { menuItems: true },
    });
    restaurantId = restaurant.id;
    kofteId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    ayranId = restaurant.menuItems.find((m) => m.name === 'Ayran')!.id;
    adminToken = await ctx.login(SEED.superAdminPhone);
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
  });

  afterAll(async () => {
    await ctx.prisma.groupCart.deleteMany({ where: { restaurantId } });
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'group_orders' } });
    await ctx.close();
  });

  it('is off by default', async () => {
    const res = await as(http().post(`/public/restaurants/${SEED.restaurantSlug}/group-carts`))
      .send({ name: 'Ev sahibi' })
      .expect(403);
    expect(res.headers['x-error-code']).toBe('FEATURE_DISABLED');
    const menu = await http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.groupOrders).toBe(false);
  });

  it('lets each person keep their own lines and nobody else edit them', async () => {
    await http()
      .put(`/admin/restaurants/${restaurantId}/features/group_orders`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    expect((await http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200)).body.groupOrders).toBe(
      true,
    );
    host = (
      await as(http().post(`/public/restaurants/${SEED.restaurantSlug}/group-carts`))
        .send({ name: 'Ayse' })
        .expect(201)
    ).body as GroupMembershipDTO;
    guest = (
      await as(http().post(`/public/group-carts/${host.token}/participants`))
        .send({ name: 'Mehmet' })
        .expect(201)
    ).body as GroupMembershipDTO;

    await setLines(host, [{ menuItemId: kofteId, quantity: 2 }]).expect(200);
    await setLines(guest, [{ menuItemId: ayranId, quantity: 1 }]).expect(200);
    // A key for someone else's lines is refused; so is an invented price.
    expect((await setLines(guest, [], host.key).expect(403)).headers['x-error-code']).toBe('GROUP_CART_FORBIDDEN');
    expect(
      (
        await setLines(guest, [
          { menuItemId: ayranId, quantity: 1, modifiers: [{ name: 'Indirim', priceDeltaMinor: -500 }] },
        ]).expect(409)
      ).headers['x-error-code'],
    ).toBe('MODIFIER_INVALID');

    const view = await cart(guest.key);
    expect(view.youId).toBe(guest.participantId);
    expect(view.youAreHost).toBe(false);
    expect(view.participants.map((p) => [p.name, p.isHost, p.lines.length])).toEqual([
      ['Ayse', true, 1],
      ['Mehmet', false, 1],
    ]);
    expect(view.totalMinor).toBe(view.participants[0].subtotalMinor + view.participants[1].subtotalMinor);
    expect((await cart()).youId).toBeNull();
  });

  it('only the host locks and pays, for everyone and exactly once', async () => {
    await as(http().post(`/public/group-carts/${host.token}/lock`), guest.key).expect(403);
    await as(http().post(`/public/group-carts/${host.token}/lock`), host.key).expect(200);
    expect((await setLines(guest, []).expect(409)).headers['x-error-code']).toBe('GROUP_CART_CLOSED');
    await checkout(guest.key).expect(403);

    const [first, second] = await Promise.all([checkout(host.key), checkout(host.key)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const placed = first.status === 201 ? first : second;
    const order = await ctx.prisma.order.findFirstOrThrow({
      where: { trackingToken: placed.body.trackingToken },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    // The client's own item list was replaced by everyone's lines.
    expect(order.items.map((i) => [i.nameSnapshot, i.quantity])).toEqual([
      ['Izgara kofte', 2],
      ['Ayran', 1],
    ]);
    const after = await cart(host.key);
    expect(after.status).toBe('PLACED');
    expect((await ctx.prisma.groupCart.findUniqueOrThrow({ where: { token: host.token } })).orderId).toBe(order.id);
    await as(http().post(`/public/group-carts/${host.token}/participants`))
      .send({ name: 'Gec' })
      .expect(409);
  });

  it('gives the basket back when placement fails', async () => {
    const other = (
      await as(http().post(`/public/restaurants/${SEED.restaurantSlug}/group-carts`))
        .send({ name: 'Ali' })
        .expect(201)
    ).body as GroupMembershipDTO;
    expect(
      (
        await as(http().post(`/public/group-carts/${other.token}/orders`), other.key)
          .send({
            fulfillment: 'PICKUP',
            items: [{ menuItemId: kofteId, quantity: 1 }],
            customer: { fullName: 'Ali', phone: '05329990996' },
            payment: { method: 'CASH_ON_DELIVERY' },
            note: NOTE,
          })
          .expect(409)
      ).headers['x-error-code'],
    ).toBe('GROUP_CART_EMPTY');
    await setLines(other, [{ menuItemId: kofteId, quantity: 1 }]).expect(200);
    await ctx.prisma.menuItem.update({ where: { id: kofteId }, data: { isAvailable: false } });
    try {
      await as(http().post(`/public/group-carts/${other.token}/orders`), other.key)
        .send({
          fulfillment: 'PICKUP',
          items: [{ menuItemId: kofteId, quantity: 1 }],
          customer: { fullName: 'Ali', phone: '05329990996' },
          payment: { method: 'CASH_ON_DELIVERY' },
          note: NOTE,
        })
        .expect(409);
    } finally {
      await ctx.prisma.menuItem.update({ where: { id: kofteId }, data: { isAvailable: true } });
    }
    const back = (await as(http().get(`/public/group-carts/${other.token}`), other.key).expect(200))
      .body as GroupCartDTO;
    expect(back.status).toBe('LOCKED');
  });
});
