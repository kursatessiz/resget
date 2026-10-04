import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const OTP = '482915';

/** Staff invites, acceptance through the OTP sign-in and role templates (docs/PERSONEL.md). */
describe('Staff and roles (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  let ownerMembershipId: string;
  let roleId: string | null = null;
  let inviteToken = '';
  let newUserId: string | null = null;
  const newPhone = normalizePhone('05320000006')!;

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    restaurantId = restaurant.id;
    ownerToken = await ctx.login(SEED.ownerPhone);
    const owner = await ctx.prisma.membership.findFirstOrThrow({
      where: { restaurantId, roleTemplate: { isOwner: true } },
      select: { id: true },
    });
    ownerMembershipId = owner.id;
    // A previous run may have left the invited user behind.
    await ctx.prisma.user.deleteMany({ where: { phone: newPhone } });
    await ctx.prisma.inviteToken.deleteMany({ where: { restaurantId, phone: newPhone } });
  });

  afterAll(async () => {
    await ctx.prisma.inviteToken.deleteMany({ where: { restaurantId, phone: newPhone } });
    if (newUserId) await ctx.prisma.user.deleteMany({ where: { id: newUserId } });
    if (roleId) await ctx.prisma.roleTemplate.deleteMany({ where: { id: roleId } });
    await ctx.close();
  });

  it('lists the default roles and creates a custom one', async () => {
    const roles = await ctx.http().get(`/restaurants/${restaurantId}/staff/roles`).set(bearer(ownerToken)).expect(200);
    expect(roles.body.some((r: { templateKey: string }) => r.templateKey === 'owner')).toBe(true);
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/staff/roles`)
      .set(bearer(ownerToken))
      .send({ name: 'E2E Garson', permissions: ['orders.view', 'menu.view'] })
      .expect(201);
    roleId = created.body.id as string;
    // Permissions come back in catalogue order, whatever order they were sent in.
    expect(created.body.permissions).toEqual(['menu.view', 'orders.view']);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/staff/roles`)
      .set(bearer(ownerToken))
      .send({ name: 'E2E Garson', permissions: [] })
      .expect(409)
      .expect('x-error-code', 'ROLE_NAME_TAKEN');
  });

  it('refuses to invite for the owner role and to change the owner membership', async () => {
    const owner = await ctx.prisma.roleTemplate.findFirstOrThrow({ where: { restaurantId, isOwner: true } });
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/staff/invites`)
      .set(bearer(ownerToken))
      .send({ phone: '05320000006', fullName: 'E2E Personel', roleTemplateId: owner.id })
      .expect(400)
      .expect('x-error-code', 'ROLE_PROTECTED');
    await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/staff/members/${ownerMembershipId}`)
      .set(bearer(ownerToken))
      .send({ status: 'PASSIVE' })
      .expect(409)
      .expect('x-error-code', 'STAFF_OWNER_PROTECTED');
  });

  it('creates an SMS invite that the public page can read', async () => {
    const invite = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/staff/invites`)
      .set(bearer(ownerToken))
      .send({ phone: '0532 000 00 06', fullName: 'E2E Personel', roleTemplateId: roleId, channel: 'SMS' })
      .expect(201);
    expect(invite.body.phone).toBe(newPhone);
    expect(invite.body.smsAccepted).toBe(true);
    inviteToken = (invite.body.url as string).split('/j/')[1];
    const pub = await ctx.http().get(`/public/invites/${inviteToken}`).expect(200);
    expect(pub.body.restaurantSlug).toBe(SEED.restaurantSlug);
    expect(pub.body.roleName).toBe('E2E Garson');
    expect(pub.body.phoneMasked).not.toContain('0006');
    const overview = await ctx.http().get(`/restaurants/${restaurantId}/staff`).set(bearer(ownerToken)).expect(200);
    expect(overview.body.invites.some((i: { phone: string }) => i.phone === newPhone)).toBe(true);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/staff/invites/${invite.body.id}/qr.png`)
      .set(bearer(ownerToken))
      .expect(200)
      .expect('content-type', /image\/png/);
  });

  it('sends a WhatsApp invite as platform traffic and reports the channel it went through', async () => {
    const before = await ctx.prisma.messageLog.count({
      where: { restaurantId, templateKey: 'staff.invite', channel: 'WHATSAPP' },
    });
    const invite = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/staff/invites`)
      .set(bearer(ownerToken))
      .send({ phone: '0532 000 00 16', fullName: 'E2E WhatsApp Personel', roleTemplateId: roleId, channel: 'WHATSAPP' })
      .expect(201);
    expect(invite.body.channel).toBe('WHATSAPP');
    expect(invite.body.smsAccepted).toBe(true);
    expect(invite.body.sentVia).toBe('WHATSAPP');
    const logs = await ctx.prisma.messageLog.findMany({
      where: { restaurantId, templateKey: 'staff.invite', channel: 'WHATSAPP' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logs).toHaveLength(before + 1);
    expect(logs[0].creditsCharged).toBe(0);
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/staff/invites/${invite.body.id}`)
      .set(bearer(ownerToken))
      .expect(204);
  });

  it('rejects the invite for a different phone and accepts it for the invited one through the sign-in', async () => {
    await ctx.prisma.otpCode.deleteMany({ where: { phone: SEED.guestPhone } });
    await ctx.http().post('/auth/otp/request').send({ phone: SEED.guestPhone }).expect(200);
    await ctx
      .http()
      .post('/auth/otp/verify')
      .send({ phone: SEED.guestPhone, code: OTP, inviteToken })
      .expect(403)
      .expect('x-error-code', 'INVITE_PHONE_MISMATCH');

    await ctx.prisma.otpCode.deleteMany({ where: { phone: newPhone } });
    await ctx.http().post('/auth/otp/request').send({ phone: newPhone }).expect(200);
    const tokens = await ctx
      .http()
      .post('/auth/otp/verify')
      .send({ phone: newPhone, code: OTP, inviteToken })
      .expect(200);
    const me = await ctx.http().get('/auth/me').set(bearer(tokens.body.accessToken)).expect(200);
    newUserId = me.body.user.id as string;
    expect(me.body.user.fullName).toBe('E2E Personel');
    const membership = me.body.memberships.find((m: { restaurantId: string }) => m.restaurantId === restaurantId);
    expect(membership.roleName).toBe('E2E Garson');
    // The session lists permissions in catalogue order, whatever order the role stores them in.
    expect(membership.permissions).toEqual(['menu.view', 'orders.view']);
    // The new member can open what the role allows and nothing else.
    await ctx.http().get(`/restaurants/${restaurantId}/menu`).set(bearer(tokens.body.accessToken)).expect(200);
    await ctx.http().get(`/restaurants/${restaurantId}/staff`).set(bearer(tokens.body.accessToken)).expect(403);
    // The link is single use.
    await ctx.http().get(`/public/invites/${inviteToken}`).expect(409).expect('x-error-code', 'INVITE_USED');
  });

  it('changes the role, disables access and only then deletes the custom role', async () => {
    const overview = await ctx.http().get(`/restaurants/${restaurantId}/staff`).set(bearer(ownerToken)).expect(200);
    const member = overview.body.members.find((m: { phone: string }) => m.phone === newPhone);
    expect(member.status).toBe('ACTIVE');
    await ctx
      .http()
      .delete(`/restaurants/${restaurantId}/staff/roles/${roleId}`)
      .set(bearer(ownerToken))
      .expect(409)
      .expect('x-error-code', 'ROLE_IN_USE');
    const kitchen = await ctx.prisma.roleTemplate.findFirstOrThrow({ where: { restaurantId, templateKey: 'kitchen' } });
    const changed = await ctx
      .http()
      .patch(`/restaurants/${restaurantId}/staff/members/${member.membershipId}`)
      .set(bearer(ownerToken))
      .send({ roleTemplateId: kitchen.id, status: 'PASSIVE' })
      .expect(200);
    expect(changed.body.roleTemplateKey).toBe('kitchen');
    expect(changed.body.status).toBe('PASSIVE');
    const memberToken = await ctx.login(newPhone);
    await ctx
      .http()
      .get(`/restaurants/${restaurantId}/menu`)
      .set(bearer(memberToken))
      .expect(403)
      .expect('x-error-code', 'MEMBERSHIP_NOT_ACTIVE');
    await ctx.http().delete(`/restaurants/${restaurantId}/staff/roles/${roleId}`).set(bearer(ownerToken)).expect(204);
    roleId = null;
  });
});
