import { access } from 'node:fs/promises';
import path from 'node:path';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { UploadsService } from '../../src/modules/uploads/uploads.service';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** Restaurant logo upload (docs/TASARIM.md): sniffed type, stored on disk, served immutable, replaced and removed. */
describe('Logo upload (e2e)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let guestToken: string;
  let restaurantId: string;
  let originalLogoUrl: string | null;
  let uploads: UploadsService;

  const filePath = (logoUrl: string) => {
    const name = uploads.ownFileOf(restaurantId, logoUrl);
    if (!name) throw new Error(`not an own logo url: ${logoUrl}`);
    return path.join(uploads.root, 'logos', restaurantId, name);
  };
  const exists = (p: string) =>
    access(p).then(
      () => true,
      () => false,
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    uploads = ctx.app.get(UploadsService);
    ownerToken = await ctx.login(SEED.ownerPhone);
    guestToken = await ctx.login(SEED.guestPhone);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, logoUrl: true },
    });
    restaurantId = restaurant.id;
    originalLogoUrl = restaurant.logoUrl;
  });

  afterAll(async () => {
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { logoUrl: originalLogoUrl } });
    await ctx.close();
  });

  it('stores a PNG, serves it with an immutable cache header and replaces it on the next upload', async () => {
    const first = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/logo`)
      .set(bearer(ownerToken))
      .attach('file', PNG_1X1, { filename: 'logo.bin', contentType: 'application/octet-stream' })
      .expect(200);
    const firstUrl = first.body.logoUrl as string;
    expect(firstUrl).toMatch(new RegExp(`/uploads/logos/${restaurantId}/[0-9a-f-]{36}\\.png$`));
    expect(await exists(filePath(firstUrl))).toBe(true);

    const served = await ctx.http().get(new URL(firstUrl).pathname).expect(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.headers['cache-control']).toContain('immutable');

    const second = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/logo`)
      .set(bearer(ownerToken))
      .attach('file', PNG_1X1, 'logo.png')
      .expect(200);
    const secondUrl = second.body.logoUrl as string;
    expect(secondUrl).not.toBe(firstUrl);
    expect(await exists(filePath(firstUrl))).toBe(false);
    expect(await exists(filePath(secondUrl))).toBe(true);
    await ctx.http().get(new URL(firstUrl).pathname).expect(404);

    const settings = await ctx.http().get(`/restaurants/${restaurantId}`).set(bearer(ownerToken)).expect(200);
    expect(settings.body.logoUrl).toBe(secondUrl);
  });

  it('refuses files that are not PNG, JPEG or WebP by their bytes, and anyone without the permission', async () => {
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/logo`)
      .set(bearer(ownerToken))
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        filename: 'logo.png',
        contentType: 'image/png',
      })
      .expect(400)
      .expect('x-error-code', 'UNSUPPORTED_FILE');
    await ctx.http().post(`/restaurants/${restaurantId}/logo`).set(bearer(ownerToken)).expect(400);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/logo`)
      .set(bearer(guestToken))
      .attach('file', PNG_1X1, 'logo.png')
      .expect(403);
    await ctx.http().get(`/uploads/logos/${restaurantId}/not-a-uuid.png`).expect(404);
    await ctx.http().get(`/uploads/logos/${restaurantId}/..%2F..%2Fetc%2Fpasswd`).expect(404);
  });

  it('removes the logo and its file', async () => {
    const before = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { logoUrl: true },
    });
    const removed = await ctx.http().delete(`/restaurants/${restaurantId}/logo`).set(bearer(ownerToken)).expect(200);
    expect(removed.body.logoUrl).toBeNull();
    expect(await exists(filePath(before.logoUrl!))).toBe(false);
  });
});
