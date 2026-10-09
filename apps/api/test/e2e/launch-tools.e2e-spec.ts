import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { deleteTestRestaurants } from './support/cleanup';

/** Launch tools (docs/PLATFORM_YONETIMI.md) and marketplace ranking (docs/VITRIN.md). */
describe('Launch tools and marketplace ranking (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let demoId: string;
  let closedId: string;
  let openId: string;
  const marketplace = '/public/marketplace?countryCode=TR&city=Istanbul&district=Kadikoy';
  const interestDistrict = `Talep ${Date.now().toString(36)}`;
  const neighbourDistrict = `Komsu ${Date.now().toString(36)}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await ctx.login(SEED.superAdminPhone);
    const demo = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, countryCode: true, currency: true, timezone: true, serviceAreaId: true },
    });
    demoId = demo.id;
    await deleteTestRestaurants(ctx.prisma, { slug: { in: ['e2e-kapali-lokanta', 'e2e-acik-lokanta'] } });
    // Two listed neighbours with fixed hours: one never open, one always open, so the order does not depend on the clock.
    const allDay = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['00:00', '24:00']]]),
    );
    const never = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, []]));
    const make = (slug: string, name: string, hours: Record<string, string[][]>) =>
      ctx.prisma.restaurant.create({
        data: {
          slug,
          name,
          countryCode: demo.countryCode,
          currency: demo.currency,
          timezone: demo.timezone,
          serviceAreaId: demo.serviceAreaId,
          isListed: true,
          branches: {
            create: {
              name: 'Merkez',
              addressLine: 'Sok. 1',
              city: 'Istanbul',
              district: 'Kadikoy',
              openingHours: hours,
            },
          },
        },
        select: { id: true },
      });
    closedId = (await make('e2e-kapali-lokanta', 'AAA Kapali Lokanta', never)).id;
    openId = (await make('e2e-acik-lokanta', 'ZZZ Acik Lokanta', allDay)).id;
  });

  afterAll(async () => {
    await deleteTestRestaurants(ctx.prisma, { id: { in: [closedId, openId] } });
    await ctx.prisma.marketplaceInterest.deleteMany({
      where: { district: { in: [interestDistrict, neighbourDistrict] } },
    });
    await ctx.prisma.serviceArea.updateMany({
      where: { restaurants: { some: { id: demoId } } },
      data: { launchTarget: 30, neighbourDistricts: [] },
    });
    await ctx.close();
  });

  it('ranks open restaurants before closed ones and tells each card whether it is open', async () => {
    const market = await ctx.http().get(marketplace).expect(200);
    const slugs = market.body.restaurants.map((r: { slug: string }) => r.slug);
    // Alphabetically the closed one would come first; being open wins.
    expect(slugs.indexOf('e2e-acik-lokanta')).toBeLessThan(slugs.indexOf('e2e-kapali-lokanta'));
    const byslug = (slug: string) => market.body.restaurants.find((r: { slug: string }) => r.slug === slug);
    expect(byslug('e2e-kapali-lokanta').isOpenNow).toBe(false);
    expect(byslug('e2e-acik-lokanta').isOpenNow).toBe(true);
    expect([true, false, null]).toContain(byslug(SEED.restaurantSlug).isOpenNow);
  });

  it('counts interest in a district that is not open, and tells the visitor when it already is', async () => {
    const first = await ctx
      .http()
      .post('/public/marketplace/interest')
      .send({ countryCode: 'TR', city: 'Istanbul', district: interestDistrict })
      .expect(200);
    expect(first.body).toEqual({ recorded: true, launched: false });
    await ctx
      .http()
      .post('/public/marketplace/interest')
      .send({ countryCode: 'TR', city: 'Istanbul', district: interestDistrict })
      .expect(200);
    const row = await ctx.prisma.marketplaceInterest.findFirstOrThrow({ where: { district: interestDistrict } });
    expect(row.count).toBe(2);
    const open = await ctx
      .http()
      .post('/public/marketplace/interest')
      .send({ countryCode: 'TR', city: 'istanbul', district: 'kadikoy' })
      .expect(200);
    expect(open.body).toEqual({ recorded: false, launched: true });
    await ctx
      .http()
      .post('/public/marketplace/interest')
      .send({ countryCode: 'T', city: 'x', district: 'y' })
      .expect(400);
  });

  it('shows readiness, target and interest per area, and lists candidate districts', async () => {
    const areas = await ctx.http().get('/admin/service-areas').set(bearer(adminToken)).expect(200);
    const kadikoy = areas.body.find((a: { district: string }) => a.district === 'Kadikoy');
    expect(kadikoy.launchTarget).toBe(30);
    expect(kadikoy.readyRestaurants).toBeGreaterThanOrEqual(1);
    expect(kadikoy.readyToLaunch).toBe(false);
    expect(typeof kadikoy.ordersPerRestaurantPerDay).toBe('number');

    const lowered = await ctx
      .http()
      .patch(`/admin/service-areas/${kadikoy.id}`)
      .set(bearer(adminToken))
      .send({ launchTarget: 1 })
      .expect(200);
    expect(lowered.body.launchTarget).toBe(1);
    expect(lowered.body.readyToLaunch).toBe(true);
    expect(lowered.body.isLaunched).toBe(true);
    await ctx.http().patch(`/admin/service-areas/${kadikoy.id}`).set(bearer(adminToken)).send({}).expect(400);

    const candidates = await ctx.http().get('/admin/service-areas/candidates').set(bearer(adminToken)).expect(200);
    const wanted = candidates.body.find((c: { district: string }) => c.district === interestDistrict);
    expect(wanted).toMatchObject({ countryCode: 'TR', city: 'Istanbul', restaurants: 0, interest: 2 });
    expect(candidates.body.some((c: { district: string }) => c.district === 'Kadikoy')).toBe(false);
  });

  it('puts districts that border a launched area first among the candidates', async () => {
    const areas = await ctx.http().get('/admin/service-areas').set(bearer(adminToken)).expect(200);
    const kadikoy = areas.body.find((a: { district: string }) => a.district === 'Kadikoy');
    expect(kadikoy.isLaunched).toBe(true);
    // Less interest than the other candidate, but next to the launched district.
    await ctx.prisma.marketplaceInterest.create({
      data: { countryCode: 'TR', city: 'Istanbul', district: neighbourDistrict, count: 1 },
    });
    const saved = await ctx
      .http()
      .patch(`/admin/service-areas/${kadikoy.id}`)
      .set(bearer(adminToken))
      .send({ neighbourDistricts: [neighbourDistrict, 'kadikoy', neighbourDistrict.toLocaleUpperCase('tr')] })
      .expect(200);
    // The area itself and a repeat in other casing are dropped (district names compare in Turkish casing: i / İ, ı / I).
    expect(saved.body.neighbourDistricts).toEqual([neighbourDistrict]);

    const candidates = await ctx.http().get('/admin/service-areas/candidates').set(bearer(adminToken)).expect(200);
    const list = candidates.body as { district: string; nextToLaunched: boolean }[];
    const neighbour = list.findIndex((c) => c.district === neighbourDistrict);
    const other = list.findIndex((c) => c.district === interestDistrict);
    expect(list[neighbour].nextToLaunched).toBe(true);
    expect(list[other].nextToLaunched).toBe(false);
    expect(neighbour).toBeLessThan(other);
  });
});
