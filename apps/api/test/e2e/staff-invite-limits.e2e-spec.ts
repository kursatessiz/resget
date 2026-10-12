import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/** Messaged staff invites are platform-paid, so they are capped per restaurant and per recipient (docs/PERSONEL.md). */
describe('Staff invite message limits (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  let roleId: string;
  const phones: string[] = [];

  const invite = (phone: string, channel: 'SHOWN' | 'SMS' | 'WHATSAPP') =>
    ctx
      .http()
      .post(`/restaurants/${restaurantId}/staff/invites`)
      .set(bearer(ownerToken))
      .send({ phone, fullName: 'E2E Limit Personel', roleTemplateId: roleId, channel });

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    restaurantId = restaurant.id;
    ownerToken = await ctx.login(SEED.ownerPhone);
    const role = await ctx.prisma.roleTemplate.findFirstOrThrow({ where: { restaurantId, templateKey: 'kitchen' } });
    roleId = role.id;
  });

  afterAll(async () => {
    await ctx.prisma.inviteToken.deleteMany({ where: { restaurantId, phone: { in: phones } } });
    await ctx.close();
  });

  it('refuses a fourth messaged invite to the same phone in a day, and leaves the shown channel unlimited', async () => {
    const phone = normalizePhone('05329000001')!;
    phones.push(phone);
    for (let i = 0; i < 3; i += 1) await invite(phone, i % 2 === 0 ? 'SMS' : 'WHATSAPP').expect(201);
    await invite(phone, 'SMS').expect(429).expect('x-error-code', 'STAFF_INVITE_RECIPIENT_LIMIT');
    // Nothing was created or sent by the refused call.
    expect(
      await ctx.prisma.inviteToken.count({ where: { restaurantId, phone, channel: { in: ['SMS', 'WHATSAPP'] } } }),
    ).toBe(3);
    // The QR channel costs the platform nothing and is never counted.
    for (let i = 0; i < 5; i += 1) await invite(phone, 'SHOWN').expect(201);
  });

  it('stops messaged invites at the restaurant daily cap and still allows the shown channel', async () => {
    const before = await ctx.prisma.messageLog.count({ where: { restaurantId, templateKey: 'staff.invite' } });
    let accepted = 0;
    let refused: { code: string } | null = null;
    // The default cap is 20 per restaurant per day; 3 were already used above.
    for (let i = 0; i < 30 && !refused; i += 1) {
      const phone = normalizePhone(`053290001${String(i).padStart(2, '0')}`)!;
      phones.push(phone);
      const res = await invite(phone, 'SMS');
      if (res.status === 201) accepted += 1;
      else refused = { code: res.headers['x-error-code'] as string };
    }
    expect(refused).toEqual({ code: 'STAFF_INVITE_RESTAURANT_LIMIT' });
    // 20 per day in all: the 3 above, the refused fourth may or may not have used a slot.
    expect(accepted).toBeGreaterThanOrEqual(16);
    expect(accepted).toBeLessThanOrEqual(17);
    const after = await ctx.prisma.messageLog.count({ where: { restaurantId, templateKey: 'staff.invite' } });
    expect(after - before).toBe(accepted);
    await invite(phones[phones.length - 1], 'SHOWN').expect(201);
  });
});
