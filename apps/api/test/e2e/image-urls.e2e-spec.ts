import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** A URL carrying credentials, built at run time so secret scanners do not read the fixture as a leaked secret. */
const withCredentials = (user: string, password: string, rest: string): string =>
  `https://${user}:${password}` + '@' + rest;

/**
 * Logos and menu images load in every diner's browser, so a restaurant may only point them at the platform's own
 * uploads or at an allowlisted https host (docs/GUVENLIK.md, "Görsel bağlantıları"). Anything else would turn the
 * storefront into a tracking beacon for a host the restaurant chose.
 */
describe('Image links (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let restaurantId: string;
  let categoryId: string;
  let originalLogoUrl: string | null;
  const itemIds: string[] = [];
  const apiOrigin = 'http://localhost:4000';
  const previousAllowlist = process.env.IMAGE_HOST_ALLOWLIST;
  const previousApiUrl = process.env.PUBLIC_API_URL;

  const refused = [
    'http://tracker.example.test/pixel.gif',
    'https://tracker.example.test/pixel.gif',
    withCredentials('user', 'secret', 'cdn.example.test/logo.png'),
    'ftp://cdn.example.test/logo.png',
    'javascript:alert(1)',
  ];

  const patchLogo = (logoUrl: string | null) =>
    ctx.http().patch(`/restaurants/${restaurantId}`).set(bearer(ownerToken)).send({ logoUrl });

  const createItem = (imageUrl: string | null) =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/menu/items`)
      .set(bearer(ownerToken))
      .send({ categoryId, name: `E2E Gorsel ${itemIds.length}`, priceMinor: 1000, vatRateBps: 1000, imageUrl });

  beforeAll(async () => {
    process.env.IMAGE_HOST_ALLOWLIST = 'cdn.example.test';
    process.env.PUBLIC_API_URL = apiOrigin;
    ctx = await createTestApp();
    ownerToken = await ctx.login(SEED.ownerPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, logoUrl: true },
    });
    restaurantId = restaurant.id;
    originalLogoUrl = restaurant.logoUrl;
    categoryId = (await ctx.prisma.menuCategory.findFirstOrThrow({ where: { restaurantId }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await ctx.prisma.menuItem.deleteMany({ where: { id: { in: itemIds } } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { logoUrl: originalLogoUrl } });
    if (previousAllowlist === undefined) delete process.env.IMAGE_HOST_ALLOWLIST;
    else process.env.IMAGE_HOST_ALLOWLIST = previousAllowlist;
    if (previousApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousApiUrl;
    await ctx.close();
  });

  it('refuses a logo link outside the platform uploads and the allowlist', async () => {
    for (const url of refused) {
      const res = await patchLogo(url);
      expect({ url, status: res.status }).toEqual({ url, status: 400 });
    }
    // A well-formed https link on a host nobody allowed carries its own code, so the panel can say why.
    await patchLogo('https://tracker.example.test/pixel.gif')
      .expect(400)
      .expect('x-error-code', 'IMAGE_URL_NOT_ALLOWED');
    const row = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { logoUrl: true },
    });
    expect(row.logoUrl).toBe(originalLogoUrl);
  });

  it('accepts the platform upload origin, an allowlisted https host and clearing the logo', async () => {
    await patchLogo(`${apiOrigin}/uploads/logos/${restaurantId}/00000000-0000-4000-8000-000000000000.png`).expect(200);
    await patchLogo('https://cdn.example.test/brand/logo.png').expect(200);
    await patchLogo(null).expect(200);
  });

  it('applies the same rule to menu item images', async () => {
    for (const url of refused) {
      const res = await createItem(url);
      expect({ url, status: res.status }).toEqual({ url, status: 400 });
      if (res.status === 201) itemIds.push(res.body.id as string);
    }
    const ok = await createItem('https://cdn.example.test/menu/kofte.webp').expect(201);
    itemIds.push(ok.body.id as string);
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/menu/items/${ok.body.id}`)
      .set(bearer(ownerToken))
      .send({ imageUrl: 'https://tracker.example.test/p.gif' })
      .expect(400);
  });
});
