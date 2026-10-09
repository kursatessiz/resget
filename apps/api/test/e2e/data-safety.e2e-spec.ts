import { Prisma } from '@resget/database';
import { SEED, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const PHONE = '+905320000091';

function isForeignKeyRefusal(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

describe('Data safety (e2e)', () => {
  let ctx: TestContext;
  let documentVersionId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.prisma.consent.deleteMany({ where: { user: { phone: PHONE } } });
    await ctx.prisma.user.deleteMany({ where: { phone: PHONE } });
    const doc = await ctx.prisma.documentVersion.upsert({
      where: { type_version_locale: { type: 'TERMS_OF_SERVICE', version: 'e2e-data-safety', locale: 'tr' } },
      update: {},
      create: { type: 'TERMS_OF_SERVICE', version: 'e2e-data-safety', locale: 'tr', body: 'e2e' },
    });
    documentVersionId = doc.id;
  });

  afterAll(async () => {
    await ctx.prisma.consent.deleteMany({ where: { user: { phone: PHONE } } });
    await ctx.prisma.user.deleteMany({ where: { phone: PHONE } });
    await ctx.prisma.documentVersion.deleteMany({ where: { id: documentVersionId } });
    await ctx.close();
  });

  it('refuses to delete a restaurant that carries orders, and keeps every row', async () => {
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    const before = await ctx.prisma.order.count({ where: { restaurantId: restaurant.id } });
    expect(before).toBeGreaterThan(0);

    const refused = await ctx.prisma.restaurant.delete({ where: { id: restaurant.id } }).catch((e: unknown) => e);
    expect(isForeignKeyRefusal(refused)).toBe(true);

    expect(await ctx.prisma.restaurant.count({ where: { id: restaurant.id } })).toBe(1);
    expect(await ctx.prisma.order.count({ where: { restaurantId: restaurant.id } })).toBe(before);
  });

  it('refuses to delete a user whose consent is on record', async () => {
    const user = await ctx.prisma.user.create({ data: { phone: PHONE, fullName: 'Veri Guvenligi' } });
    await ctx.prisma.consent.create({ data: { userId: user.id, documentVersionId } });

    const refused = await ctx.prisma.user.delete({ where: { id: user.id } }).catch((e: unknown) => e);
    expect(isForeignKeyRefusal(refused)).toBe(true);
    expect(await ctx.prisma.consent.count({ where: { userId: user.id } })).toBe(1);
  });
});
