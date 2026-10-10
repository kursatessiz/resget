import { normalizePhone } from '@resget/shared';
import type { OrderSummaryDTO, OrderingLinksDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

// A number per order, so the cap on open orders per phone (docs/VITRIN.md) never decides these cases.
let phoneSeq = 0;
const nextPhone = () => normalizePhone(`0532998${String(8100 + (phoneSeq++ % 900)).padStart(4, '0')}`)!;
const NOTE = 'e2e-ordering-links';

/** Channel links and the orders they bring (docs/SIPARIS_BAGLANTILARI.md). */
describe('Ordering links (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let itemId: string;
  let tableToken: string;
  // Our own client address, so the public order limit is not shared with other suites.
  const client = `10.78.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;

  const setSwitch = (enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/ordering_links`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  const order = (path: string, extra: Record<string, unknown>) =>
    ctx
      .http()
      .post(path)
      .set('x-forwarded-for', client)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Kanal Musteri', phone: nextPhone() },
        payment: { method: 'CASH_ON_DELIVERY' },
        note: NOTE,
        ...extra,
      });
  const sourceOf = async (trackingToken: string) =>
    (await ctx.prisma.order.findFirstOrThrow({ where: { trackingToken }, select: { source: true } })).source;
  const links = () =>
    ctx.http().get(`/restaurants/${restaurantId}/ordering-links`).set(bearer(ownerToken, restaurantId));

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { menuItems: true, tables: true },
    });
    restaurantId = restaurant.id;
    itemId = restaurant.menuItems.find((m) => m.name === 'Izgara kofte')!.id;
    tableToken = restaurant.tables.find((t) => t.isActive)!.qrToken;
    await ctx.prisma.order.deleteMany({
      where: { restaurantId, OR: [{ customerNote: NOTE }, { source: { not: null } }] },
    });
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'ordering_links' } });
    await ctx.close();
  });

  it('is off by default: no screen and no source kept', async () => {
    expect((await links().expect(403)).headers['x-error-code']).toBe('FEATURE_DISABLED');
    const res = await order(`/public/restaurants/${SEED.restaurantSlug}/orders`, { source: 'INSTAGRAM' }).expect(201);
    expect(await sourceOf(res.body.trackingToken)).toBeNull();
  });

  it('keeps the channel of an ordering page order and rejects an unknown one', async () => {
    await setSwitch(true);
    await order(`/public/restaurants/${SEED.restaurantSlug}/orders`, { source: 'MYSPACE' }).expect(400);
    const first = await order(`/public/restaurants/${SEED.restaurantSlug}/orders`, { source: 'INSTAGRAM' }).expect(201);
    expect(await sourceOf(first.body.trackingToken)).toBe('INSTAGRAM');
    await order(`/public/restaurants/${SEED.restaurantSlug}/orders`, { source: 'INSTAGRAM' }).expect(201);
    await order(`/public/restaurants/${SEED.restaurantSlug}/orders`, { source: 'WHATSAPP' }).expect(201);
    // A table QR order is its own channel; a link parameter there is ignored.
    const table = await order(`/public/qr/${tableToken}/orders`, { source: 'GOOGLE' }).expect(201);
    expect(await sourceOf(table.body.trackingToken)).toBeNull();

    const list = (
      await ctx.http().get(`/restaurants/${restaurantId}/orders`).set(bearer(ownerToken, restaurantId)).expect(200)
    ).body as OrderSummaryDTO[];
    expect(list.filter((o) => o.source === 'INSTAGRAM')).toHaveLength(2);
  });

  it('lists one link per channel with what each brought', async () => {
    const body = (await links().expect(200)).body as OrderingLinksDTO;
    expect(body.baseUrl).toMatch(new RegExp(`/${SEED.restaurantSlug}$`));
    expect(body.links.map((l) => l.source)).toEqual(['INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'GOOGLE', 'TIKTOK']);
    const instagram = body.links.find((l) => l.source === 'INSTAGRAM')!;
    expect(instagram.orders).toBe(2);
    expect(instagram.revenueMinor).toBeGreaterThan(0);
    const url = new URL(instagram.url);
    expect(url.searchParams.get('via')).toBe('instagram');
    expect(url.searchParams.get('utm_source')).toBe('instagram');
    expect(body.links.find((l) => l.source === 'WHATSAPP')!.orders).toBe(1);
    expect(body.links.find((l) => l.source === 'GOOGLE')!.orders).toBe(0);
    expect(body.otherOrders).toBeGreaterThanOrEqual(1);
  });

  it('leaves out orders that never went ahead', async () => {
    const before = (await links().expect(200)).body as OrderingLinksDTO;
    const res = await order(`/public/restaurants/${SEED.restaurantSlug}/orders`, { source: 'FACEBOOK' }).expect(201);
    const placed = await ctx.prisma.order.findFirstOrThrow({ where: { trackingToken: res.body.trackingToken } });
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${placed.id}/transition`)
      .set(bearer(ownerToken, restaurantId))
      .send({ to: 'REJECTED', reason: 'kapali' })
      .expect(200);
    const after = (await links().expect(200)).body as OrderingLinksDTO;
    expect(after.links.find((l) => l.source === 'FACEBOOK')!.orders).toBe(
      before.links.find((l) => l.source === 'FACEBOOK')!.orders,
    );
  });
});
