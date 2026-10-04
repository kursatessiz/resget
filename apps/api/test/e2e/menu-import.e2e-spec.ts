import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Menu import from a spreadsheet: dry run with line errors, apply, re-import as an update, refusal of a bad file (docs/PANEL.md). */
describe('Menu import (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  const prefix = 'E2E Import';

  const post = (csv: string, dryRun: boolean) =>
    ctx.http().post(`/restaurants/${restaurantId}/menu/import`).set(bearer(ownerToken)).send({ csv, dryRun });

  const cleanup = async () => {
    await ctx.prisma.menuItem.deleteMany({ where: { restaurantId, category: { name: { startsWith: prefix } } } });
    await ctx.prisma.menuCategory.deleteMany({ where: { restaurantId, name: { startsWith: prefix } } });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    restaurantId = (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } })).id;
    ownerToken = await ctx.login(SEED.ownerPhone);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await ctx.close();
  });

  it('previews a file with its line errors and writes nothing', async () => {
    const csv = [
      'Kategori;Ürün adı;Fiyat;Satışta',
      `${prefix} Tatlı;Sütlaç;95,00;evet`,
      `${prefix} Tatlı;Künefe;on lira;evet`,
    ].join('\n');
    const res = await post(csv, true).expect(200);
    expect(res.body).toMatchObject({ dryRun: true, applied: false, rows: 2, itemsCreated: 1 });
    expect(res.body.categoriesCreated).toEqual([`${prefix} Tatlı`]);
    expect(res.body.issues).toEqual([{ line: 3, code: 'PRICE_INVALID', column: 'price' }]);
    await post(csv, false).expect(400).expect('x-error-code', 'MENU_IMPORT_INVALID');
    expect(await ctx.prisma.menuCategory.count({ where: { restaurantId, name: { startsWith: prefix } } })).toBe(0);
  });

  it('applies a valid file, then updates the same items on a second import', async () => {
    const first = [
      'category,name,description,price,vat_rate,available',
      `"${prefix} İçecek",Ayran,"Ev yapımı, soğuk",45,10,1`,
      `"${prefix} İçecek",Şalgam,,50.5,10,1`,
    ].join('\n');
    const applied = await post(first, false).expect(200);
    expect(applied.body).toMatchObject({ applied: true, itemsCreated: 2, itemsUpdated: 0 });
    const items = await ctx.prisma.menuItem.findMany({
      where: { restaurantId, category: { name: `${prefix} İçecek` } },
      orderBy: { sortOrder: 'asc' },
    });
    expect(items.map((i) => [i.name, i.priceMinor, i.vatRateBps, i.description])).toEqual([
      ['Ayran', 4500, 1000, 'Ev yapımı, soğuk'],
      ['Şalgam', 5050, 1000, null],
    ]);

    // Same names in another case, a new price and one item sold out: two updates, nothing duplicated.
    const second = [
      'kategori,ad,fiyat,satışta',
      `${prefix} içecek,AYRAN,47,evet`,
      `${prefix} içecek,şalgam,50.50,hayır`,
    ].join('\n');
    const preview = await post(second, true).expect(200);
    expect(preview.body).toMatchObject({ itemsCreated: 0, itemsUpdated: 2, itemsUnchanged: 0, categoriesCreated: [] });
    await post(second, false).expect(200);
    const after = await ctx.prisma.menuItem.findMany({
      where: { restaurantId, category: { name: { startsWith: prefix } } },
      orderBy: { sortOrder: 'asc' },
    });
    expect(after).toHaveLength(2);
    expect(after.map((i) => [i.priceMinor, i.isAvailable, i.description])).toEqual([
      [4700, true, 'Ev yapımı, soğuk'],
      [5050, false, null],
    ]);
  });
});
