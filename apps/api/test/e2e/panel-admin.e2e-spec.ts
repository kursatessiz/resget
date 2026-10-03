import { Prisma } from '@resget/database';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

interface ChunkStream {
  on(event: string, listener: (chunk: Buffer) => void): unknown;
}

/** supertest buffers only text and JSON; images are collected by hand. */
function collect(res: ChunkStream, done: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

/** Menu editor, table labels and restaurant settings behind the panel (A3). */
describe('Panel administration: menu, tables, settings (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let branchId: string;
  let ownerToken: string;
  let guestToken: string;
  let categoryId: string | null = null;
  let itemId: string | null = null;
  let tableId: string | null = null;
  let original: {
    name: string;
    themePrimary: string;
    deliveryFeePolicy: Prisma.JsonValue;
    dispatchSettings: Prisma.JsonValue;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      include: { branches: true },
    });
    restaurantId = restaurant.id;
    branchId = restaurant.branches[0].id;
    original = {
      name: restaurant.name,
      themePrimary: restaurant.themePrimary,
      deliveryFeePolicy: restaurant.deliveryFeePolicy,
      dispatchSettings: restaurant.dispatchSettings,
    };
    ownerToken = await ctx.login(SEED.ownerPhone);
    guestToken = await ctx.login(SEED.guestPhone);
  });

  afterAll(async () => {
    if (itemId) await ctx.prisma.menuItem.deleteMany({ where: { id: itemId } });
    if (categoryId) await ctx.prisma.menuCategory.deleteMany({ where: { id: categoryId } });
    if (tableId) await ctx.prisma.diningTable.deleteMany({ where: { id: tableId } });
    // Other suites depend on the seeded policy and tuning; put the row back exactly as it was.
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        name: original.name,
        themePrimary: original.themePrimary,
        deliveryFeePolicy: original.deliveryFeePolicy === null ? Prisma.DbNull : original.deliveryFeePolicy,
        dispatchSettings: original.dispatchSettings === null ? Prisma.DbNull : original.dispatchSettings,
      },
    });
    await ctx.close();
  });

  it('refuses the menu editor to a member without menu.manage', async () => {
    await ctx.http().get(`/restaurants/${restaurantId}/menu/manage`).set(bearer(guestToken)).expect(403);
  });

  it('creates a category and an item with the restaurant currency, then option groups', async () => {
    const category = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/menu/categories`)
      .set(bearer(ownerToken))
      .send({ name: 'E2E Tatlilar' })
      .expect(201);
    categoryId = category.body.id as string;
    expect(category.body.sortOrder).toBeGreaterThan(0);

    const item = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/menu/items`)
      .set(bearer(ownerToken))
      .send({ categoryId, name: 'E2E Sutlac', priceMinor: 9500, vatRateBps: 1000, description: 'Firinda' })
      .expect(201);
    itemId = item.body.id as string;
    expect(item.body.currency).toBe('TRY');
    expect(item.body.isAvailable).toBe(true);

    const withGroups = await ctx
      .http()
      .put(`/restaurants/${restaurantId}/menu/items/${itemId}/modifier-groups`)
      .set(bearer(ownerToken))
      .send({
        groups: [
          {
            name: 'Boyut',
            minSelect: 1,
            maxSelect: 1,
            modifiers: [
              { name: 'Kucuk', priceDeltaMinor: 0 },
              { name: 'Buyuk', priceDeltaMinor: 2000 },
            ],
          },
        ],
      })
      .expect(200);
    expect(withGroups.body.modifierGroups).toHaveLength(1);
    expect(withGroups.body.modifierGroups[0].modifiers.map((m: { name: string }) => m.name)).toEqual([
      'Kucuk',
      'Buyuk',
    ]);

    const manage = await ctx.http().get(`/restaurants/${restaurantId}/menu/manage`).set(bearer(ownerToken)).expect(200);
    const found = manage.body.categories.find((c: { id: string }) => c.id === categoryId);
    expect(found.items[0].modifierGroups[0].name).toBe('Boyut');
  });

  it('hides a sold-out item from the guest menu and a hidden category entirely', async () => {
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/menu/items/${itemId}`)
      .set(bearer(ownerToken))
      .send({ isAvailable: false })
      .expect(200);
    const visible = await ctx.http().get(`/public/qr/${SEED.tableToken}`).expect(200);
    const category = visible.body.categories.find((c: { id: string }) => c.id === categoryId);
    expect(category.items[0].isAvailable).toBe(false);

    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/menu/categories/${categoryId}`)
      .set(bearer(ownerToken))
      .send({ isActive: false })
      .expect(200);
    const hidden = await ctx.http().get(`/public/qr/${SEED.tableToken}`).expect(200);
    expect(hidden.body.categories.some((c: { id: string }) => c.id === categoryId)).toBe(false);
  });

  it('rejects a reorder that does not cover every category and refuses to delete a non-empty category', async () => {
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/menu/categories/reorder`)
      .set(bearer(ownerToken))
      .send({ ids: [categoryId] })
      .expect(400)
      .expect('x-error-code', 'REORDER_MISMATCH');
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/menu/categories/${categoryId}`)
      .set(bearer(ownerToken))
      .expect(409)
      .expect('x-error-code', 'MENU_CATEGORY_NOT_EMPTY');
  });

  it('deletes an unused item and then its empty category', async () => {
    await ctx.http().delete(`/restaurants/${restaurantId}/menu/items/${itemId}`).set(bearer(ownerToken)).expect(204);
    itemId = null;
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/menu/categories/${categoryId}`)
      .set(bearer(ownerToken))
      .expect(204);
    categoryId = null;
  });

  it('refuses to delete an item that appears in an order', async () => {
    const used = await ctx.prisma.orderItem.findFirstOrThrow({
      where: { menuItemId: { not: null }, order: { restaurantId } },
      select: { menuItemId: true },
    });
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/menu/items/${used.menuItemId}`)
      .set(bearer(ownerToken))
      .expect(409)
      .expect('x-error-code', 'MENU_ITEM_IN_USE');
  });

  it('renames and deactivates a table and serves its label as SVG and its QR as PNG', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/tables`)
      .set(bearer(ownerToken))
      .send({ branchId, label: 'E2E-L' })
      .expect(201);
    tableId = created.body.id as string;

    const svg = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/tables/${tableId}/label.svg`)
      .set(bearer(ownerToken))
      .buffer(true)
      .parse(collect)
      .expect(200)
      .expect('content-type', /image\/svg\+xml/);
    const svgText = (svg.body as Buffer).toString('utf8');
    expect(svgText).toContain('<svg');
    expect(svgText).toContain('E2E-L');
    expect(svg.headers['content-disposition']).toMatch(/qr-demo-lokanta-e2e-l\.svg/);

    const png = await ctx
      .http()
      .get(`/restaurants/${restaurantId}/tables/${tableId}/qr.png`)
      .set(bearer(ownerToken))
      .buffer(true)
      .parse(collect)
      .expect(200)
      .expect('content-type', /image\/png/);
    expect((png.body as Buffer).subarray(1, 4).toString('ascii')).toBe('PNG');

    const renamed = await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/tables/${tableId}`)
      .set(bearer(ownerToken))
      .send({ label: 'E2E-M', isActive: false })
      .expect(200);
    expect(renamed.body.label).toBe('E2E-M');
    const token = (renamed.body.qrUrl as string).split('/m/')[1];
    await ctx.http().get(`/public/qr/${token}`).expect(404);
  });

  it('updates owner settings and keeps platform fields read-only', async () => {
    const updated = await ctx
      .http()
      .patch(`/restaurants/${restaurantId}`)
      .set(bearer(ownerToken))
      .send({
        name: 'Demo Lokanta E2E',
        themePrimary: '#aa3366',
        deliveryFeePolicy: { mode: 'FREE_ABOVE', thresholdMinor: 50000, feeMinor: 3000 },
        dispatchSettings: {
          avgSpeedKmh: 25,
          detourFactor: 1.3,
          stopServiceMinutes: 4,
          arrivalRadiusMeters: 200,
          maxStopsPerTrip: 5,
          locationBroadcastSeconds: 5,
          defaultPrepMinutes: 15,
        },
      })
      .expect(200);
    expect(updated.body.name).toBe('Demo Lokanta E2E');
    expect(updated.body.deliveryFeePolicy.mode).toBe('FREE_ABOVE');
    expect(updated.body.dispatchSettings.defaultPrepMinutes).toBe(15);
    expect(updated.body.commissionBps).toBe(100);

    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}`)
      .set(bearer(ownerToken))
      .send({ commissionBps: 0 })
      .expect(400);
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}`)
      .set(bearer(ownerToken))
      .send({ themePrimary: 'red' })
      .expect(400);
    await ctx.http().patch(`/restaurants/${restaurantId}`).set(bearer(guestToken)).send({ name: 'Hack' }).expect(403);

    const reverted = await ctx
      .http()
      .patch(`/restaurants/${restaurantId}`)
      .set(bearer(ownerToken))
      .send({ name: original.name, themePrimary: original.themePrimary, deliveryFeePolicy: null })
      .expect(200);
    expect(reverted.body.deliveryFeePolicy).toBeNull();
  });
});
