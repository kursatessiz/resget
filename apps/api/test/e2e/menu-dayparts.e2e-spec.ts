import { WEEKDAY_KEYS, localClock } from '@resget/shared';
import type { MenuCategoryAdminDTO, StorefrontDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Menu dayparts (docs/OGUN_SAATLERI.md): category windows, shown to guests and enforced on consumer orders. */
describe('Menu dayparts (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let timezone: string;
  let categoryId: string;
  let itemId: string;
  const created: string[] = [];
  const owner = () => bearer(ownerToken, restaurantId);
  const patch = (body: object, expected = 200) =>
    ctx
      .http()
      .patch(`/restaurants/${restaurantId}/menu/categories/${categoryId}`)
      .set(owner())
      .send(body)
      .expect(expected);
  const storefrontCategory = async () => {
    const page = (await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200))
      .body as StorefrontDTO;
    return page.categories.find((c) => c.id === categoryId);
  };
  const place = (expected: number) =>
    ctx
      .http()
      .post(`/public/restaurants/${SEED.restaurantSlug}/orders`)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Ogun Musteri', phone: '05329990951' },
        payment: { method: 'CASH_ON_DELIVERY' },
      })
      .expect(expected)
      .then(async (res) => {
        if (res.status === 201) {
          const order = await ctx.prisma.order.findUniqueOrThrow({ where: { trackingToken: res.body.trackingToken } });
          created.push(order.id);
        }
        return res;
      });
  /** A two-hour window that starts two hours from now, on today's (or tomorrow's) local weekday. */
  const laterWindow = () => {
    const clock = localClock(new Date(), timezone);
    let start = Math.ceil((clock.minutes + 120) / 60) * 60;
    let day = WEEKDAY_KEYS.indexOf(clock.day);
    // A window that would run past midnight moves to the next day, never to a negative minute.
    if (start + 120 > 1440) {
      start = Math.max(0, start - 1440);
      day = (day + 1) % 7;
    }
    return { [WEEKDAY_KEYS[day]]: [[hhmm(start), hhmm(start + 120)]] };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, timezone: true },
    });
    restaurantId = restaurant.id;
    timezone = restaurant.timezone;
    const category = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/menu/categories`)
        .set(owner())
        .send({ name: 'Kahvalti testi' })
        .expect(201)
    ).body as MenuCategoryAdminDTO;
    categoryId = category.id;
    itemId = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/menu/items`)
        .set(owner())
        .send({ categoryId, name: 'Menemen testi', priceMinor: 15000, vatRateBps: 1000 })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    if (created.length) await ctx.prisma.order.deleteMany({ where: { id: { in: created } } });
    await ctx.prisma.menuItem.deleteMany({ where: { categoryId } });
    await ctx.prisma.menuCategory.deleteMany({ where: { id: categoryId } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'menu_dayparts' } });
    await ctx.close();
  });

  it('stores valid windows and refuses one that ends where it starts', async () => {
    await patch({ availableHours: { mon: [['09:00', '09:00']] } }, 400);
    const saved = (await patch({ availableHours: laterWindow() })).body as MenuCategoryAdminDTO;
    expect(saved.availableHours).toEqual(laterWindow());
  });

  it('changes nothing for guests while the module is off', async () => {
    expect((await storefrontCategory())?.availableHours).toBeNull();
    await place(201);
  });

  it('shows the windows and refuses consumer orders outside them once on', async () => {
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/menu_dayparts`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    expect((await storefrontCategory())?.availableHours).toEqual(laterWindow());
    const refused = await place(409);
    expect(refused.headers['x-error-code']).toBe('MENU_ITEM_NOT_SERVED');

    const today = localClock(new Date(), timezone).day;
    await patch({ availableHours: { [today]: [['00:00', '24:00']] } });
    await place(201);

    await patch({ availableHours: null });
    expect((await storefrontCategory())?.availableHours).toBeNull();
    await place(201);
  });
});
