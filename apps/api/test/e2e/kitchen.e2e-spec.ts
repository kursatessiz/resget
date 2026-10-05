import type { KitchenBoardDTO, MenuCategoryAdminDTO } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const NOTE = 'e2e-kitchen';

/** Tickets, stations and line marking on the kitchen display (docs/MUTFAK_EKRANI.md). */
describe('Kitchen display (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let branchId: string;
  let grillId: string;
  let dessertId: string;
  const categories: string[] = [];
  const owner = () => bearer(ownerToken);
  const board = (station?: string) =>
    ctx
      .http()
      .get(`/restaurants/${restaurantId}/kitchen${station ? `?station=${encodeURIComponent(station)}` : ''}`)
      .set(owner());
  const mark = (itemId: string, prepared: boolean, expected = 204) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/kitchen/items/${itemId}/prepared`)
      .set(owner())
      .send({ prepared })
      .expect(expected);
  const ticketOf = (body: KitchenBoardDTO, orderId: string) => body.tickets.find((t) => t.orderId === orderId);

  const section = async (name: string, kitchenStation: string | null, item: string) => {
    const category = (
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/menu/categories`)
        .set(owner())
        .send({ name, kitchenStation })
        .expect(201)
    ).body as MenuCategoryAdminDTO;
    categories.push(category.id);
    expect(category.kitchenStation).toBe(kitchenStation);
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/menu/items`)
      .set(owner())
      .send({ categoryId: category.id, name: item, priceMinor: 10000, vatRateBps: 1000 })
      .expect(201);
    return created.body.id as string;
  };
  const acceptedOrder = async () => {
    const res = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders`)
      .set(owner())
      .send({
        branchId,
        channel: 'PHONE',
        fulfillment: 'PICKUP',
        items: [
          { menuItemId: grillId, quantity: 2 },
          { menuItemId: dessertId, quantity: 1 },
        ],
        note: NOTE,
      })
      .expect(201);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${res.body.id}/transition`)
      .set(owner())
      .send({ to: 'ACCEPTED', prepMinutes: 15 })
      .expect(200);
    return res.body.id as string;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.menuCategory.deleteMany({ where: { restaurantId, name: { startsWith: 'E2E Mutfak' } } });
    grillId = await section('E2E Mutfak Izgara', 'Izgara', 'E2E Adana');
    dessertId = await section('E2E Mutfak Tatli', 'Tatli', 'E2E Kunefe');
  });

  afterAll(async () => {
    await ctx.prisma.order.deleteMany({ where: { restaurantId, customerNote: NOTE } });
    await ctx.prisma.menuCategory.deleteMany({ where: { id: { in: categories } } });
    await ctx.prisma.featureFlag.deleteMany({ where: { restaurantId, key: 'kitchen_display' } });
    await ctx.close();
  });

  it('is off by default', async () => {
    expect((await board().expect(403)).headers['x-error-code']).toBe('FEATURE_DISABLED');
  });

  it('shows accepted orders as tickets, with station screens', async () => {
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/kitchen_display`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);
    const orderId = await acceptedOrder();
    const all = (await board().expect(200)).body as KitchenBoardDTO;
    expect(all.stations).toEqual(expect.arrayContaining(['Izgara', 'Tatli']));
    const ticket = ticketOf(all, orderId)!;
    expect(ticket.status).toBe('ACCEPTED');
    expect(ticket.promisedReadyAt).not.toBeNull();
    expect(ticket.items.map((i) => [i.name, i.quantity, i.station])).toEqual([
      ['E2E Adana', 2, 'Izgara'],
      ['E2E Kunefe', 1, 'Tatli'],
    ]);
    const grill = ticketOf((await board('Izgara').expect(200)).body as KitchenBoardDTO, orderId)!;
    expect(grill.items.map((i) => i.name)).toEqual(['E2E Adana']);
  });

  it('starts the order on the first done line and lets staff mark it ready', async () => {
    const orderId = await acceptedOrder();
    const [adana, kunefe] = ticketOf((await board().expect(200)).body as KitchenBoardDTO, orderId)!.items;
    await mark(adana.id, true);
    const started = ticketOf((await board().expect(200)).body as KitchenBoardDTO, orderId)!;
    expect(started.status).toBe('PREPARING');
    expect(started.items[0].preparedAt).not.toBeNull();
    // Undo is allowed while the order is in the kitchen and does not move the order back.
    await mark(adana.id, false);
    expect(ticketOf((await board().expect(200)).body as KitchenBoardDTO, orderId)!.status).toBe('PREPARING');
    await Promise.all([mark(adana.id, true), mark(kunefe.id, true)]);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/orders/${orderId}/transition`)
      .set(owner())
      .send({ to: 'READY' })
      .expect(200);
    expect(ticketOf((await board().expect(200)).body as KitchenBoardDTO, orderId)).toBeUndefined();
    // A line of an order that left the kitchen cannot be marked.
    await mark(kunefe.id, false, 404);
  });

  it('starts an order once when two cooks mark lines together', async () => {
    const orderId = await acceptedOrder();
    const [adana, kunefe] = ticketOf((await board().expect(200)).body as KitchenBoardDTO, orderId)!.items;
    await Promise.all([mark(adana.id, true), mark(kunefe.id, true)]);
    const history = await ctx.prisma.orderStatusHistory.findMany({ where: { orderId, toStatus: 'PREPARING' } });
    expect(history).toHaveLength(1);
  });

  it('clears a section station', async () => {
    const updated = (
      await ctx
        .http()
        .patch(`/restaurants/${restaurantId}/menu/categories/${categories[1]}`)
        .set(owner())
        .send({ kitchenStation: null })
        .expect(200)
    ).body as MenuCategoryAdminDTO;
    expect(updated.kitchenStation).toBeNull();
  });
});
