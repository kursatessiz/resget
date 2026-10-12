import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

/**
 * The invite path honours the same authority rules as a direct membership change (docs/PERSONEL.md, "Roller"): a
 * manager cannot reopen a superior the owner closed by inviting them, an invite dies with its issuer's authority, the
 * owner membership is never overwritten by a redemption, and a link is redeemed exactly once.
 */
describe('Staff invite authority (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  const managerPhone = normalizePhone('05320000851')!;
  const superiorPhone = normalizePhone('05320000852')!;
  const candidatePhone = normalizePhone('05320000853')!;
  const formerPhone = normalizePhone('05320000854')!;
  const phones = [managerPhone, superiorPhone, candidatePhone, formerPhone];
  const roleIds: string[] = [];
  let managerRoleId = '';
  let superiorRoleId = '';
  let narrowRoleId = '';
  let managerMembershipId = '';
  let base = '';

  const cleanup = async (): Promise<void> => {
    await ctx.prisma.inviteToken.deleteMany({ where: { restaurantId, phone: { in: phones } } });
    const users = await ctx.prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await ctx.prisma.inviteToken.deleteMany({ where: { createdByUserId: { in: ids } } });
    await ctx.prisma.membership.deleteMany({ where: { userId: { in: ids } } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: ids } } });
  };

  const createRole = async (name: string, permissions: string[]): Promise<string> => {
    const role = await ctx.prisma.roleTemplate.create({
      data: {
        restaurantId,
        name,
        isOwner: false,
        permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
      },
    });
    roleIds.push(role.id);
    return role.id;
  };

  const member = async (phone: string, fullName: string, roleTemplateId: string, status: 'ACTIVE' | 'PASSIVE') => {
    const user = await ctx.prisma.user.create({ data: { phone, fullName } });
    return ctx.prisma.membership.create({
      data: { userId: user.id, restaurantId, roleTemplateId, status, joinedAt: new Date() },
    });
  };

  const invite = (token: string, phone: string, roleTemplateId: string) =>
    ctx
      .http()
      .post(`${base}/invites`)
      .set(bearer(token))
      .send({ fullName: 'E2E Davetli', phone, roleTemplateId, channel: 'SHOWN' });

  const tokenOf = (url: string): string => url.split('/j/')[1];

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } });
    restaurantId = restaurant.id;
    base = `/restaurants/${restaurantId}/staff`;
    ownerToken = await ctx.login(SEED.ownerPhone);
    await cleanup();
    await ctx.prisma.roleTemplate.deleteMany({ where: { restaurantId, name: { startsWith: 'E2E Yetki ' } } });
    managerRoleId = await createRole('E2E Yetki Sorumlu', ['staff.manage', 'orders.view', 'menu.view']);
    superiorRoleId = await createRole('E2E Yetki Ust', ['staff.manage', 'orders.view', 'menu.view', 'payments.manage']);
    narrowRoleId = await createRole('E2E Yetki Dar', ['orders.view']);
    managerMembershipId = (await member(managerPhone, 'E2E Yetki Sorumlu', managerRoleId, 'ACTIVE')).id;
  });

  afterAll(async () => {
    await cleanup();
    await ctx.prisma.roleTemplate.deleteMany({ where: { id: { in: roleIds } } });
    await ctx.close();
  });

  it('refuses a manager inviting back a closed superior whose role exceeds the manager', async () => {
    const superior = await member(superiorPhone, 'E2E Yetki Ust', superiorRoleId, 'PASSIVE');
    const managerToken = await ctx.login(managerPhone);
    // The direct path refuses to reopen the closed superior.
    await ctx
      .http()
      .patch(`${base}/members/${superior.id}`)
      .set(bearer(managerToken))
      .send({ status: 'ACTIVE' })
      .expect(403)
      .expect('x-error-code', 'ROLE_ESCALATION');
    // The invite path must refuse it too, even with a narrow role the manager could grant.
    await invite(managerToken, superiorPhone, narrowRoleId).expect(403).expect('x-error-code', 'ROLE_ESCALATION');
    // The owner may re-invite the closed superior.
    const byOwner = await invite(ownerToken, superiorPhone, narrowRoleId).expect(201);
    await ctx.prisma.inviteToken.deleteMany({ where: { id: byOwner.body.id as string } });
  });

  it('refuses redemption onto a closed superior even if the invite slipped through', async () => {
    const managerUser = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: managerPhone } });
    // An invite stored before the rule existed (or created while the superior was still a lesser member).
    const stored = await ctx.prisma.inviteToken.create({
      data: {
        restaurantId,
        createdByUserId: managerUser.id,
        phone: superiorPhone,
        fullName: 'E2E Yetki Ust',
        roleTemplateId: narrowRoleId,
        token: 'e2e-yetki-stored-token-superior-0000000001',
        channel: 'SHOWN',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const superiorToken = await ctx.login(superiorPhone);
    await ctx
      .http()
      .post(`/me/invites/${stored.token}/accept`)
      .set(bearer(superiorToken))
      .expect(403)
      .expect('x-error-code', 'ROLE_ESCALATION');
    const after = await ctx.prisma.membership.findFirstOrThrow({
      where: { restaurantId, user: { phone: superiorPhone } },
    });
    expect(after.status).toBe('PASSIVE');
    expect(after.roleTemplateId).toBe(superiorRoleId);
  });

  it('expires the invites of an issuer the owner deactivates', async () => {
    const managerToken = await ctx.login(managerPhone);
    const created = await invite(managerToken, candidatePhone, narrowRoleId).expect(201);
    await ctx
      .http()
      .patch(`${base}/members/${managerMembershipId}`)
      .set(bearer(ownerToken))
      .send({ status: 'PASSIVE' })
      .expect(200);
    try {
      const candidateToken = await ctx.login(candidatePhone);
      await ctx
        .http()
        .post(`/me/invites/${tokenOf(created.body.url as string)}/accept`)
        .set(bearer(candidateToken))
        .expect(409)
        .expect('x-error-code', 'INVITE_EXPIRED');
      expect(await ctx.prisma.membership.count({ where: { restaurantId, user: { phone: candidatePhone } } })).toBe(0);
    } finally {
      await ctx.prisma.membership.deleteMany({ where: { restaurantId, user: { phone: candidatePhone } } });
      await ctx.prisma.membership.update({ where: { id: managerMembershipId }, data: { status: 'ACTIVE' } });
    }
  });

  it('refuses redemption once the issuer can no longer grant the role', async () => {
    const managerToken = await ctx.login(managerPhone);
    const created = await invite(managerToken, candidatePhone, narrowRoleId).expect(201);
    // The owner demotes the issuer to a role without staff rights; the invite must not outlive that authority.
    await ctx
      .http()
      .patch(`${base}/members/${managerMembershipId}`)
      .set(bearer(ownerToken))
      .send({ roleTemplateId: narrowRoleId })
      .expect(200);
    try {
      const candidateToken = await ctx.login(candidatePhone);
      await ctx
        .http()
        .post(`/me/invites/${tokenOf(created.body.url as string)}/accept`)
        .set(bearer(candidateToken))
        .expect(403)
        .expect('x-error-code', 'INVITE_REVOKED');
      expect(await ctx.prisma.membership.count({ where: { restaurantId, user: { phone: candidatePhone } } })).toBe(0);
    } finally {
      await ctx.prisma.membership.deleteMany({ where: { restaurantId, user: { phone: candidatePhone } } });
      await ctx.prisma.membership.update({
        where: { id: managerMembershipId },
        data: { roleTemplateId: managerRoleId },
      });
    }
  });

  it('never overwrites the owner membership with a redeemed invite', async () => {
    const owner = await ctx.prisma.membership.findFirstOrThrow({
      where: { restaurantId, roleTemplate: { isOwner: true } },
      select: { id: true, userId: true, user: { select: { phone: true } } },
    });
    const ownerUser = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: SEED.ownerPhone } });
    const stored = await ctx.prisma.inviteToken.create({
      data: {
        restaurantId,
        createdByUserId: ownerUser.id,
        phone: owner.user.phone,
        fullName: 'E2E Sahip',
        roleTemplateId: narrowRoleId,
        token: 'e2e-yetki-stored-token-owner-00000000000001',
        channel: 'SHOWN',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const token = await ctx.login(owner.user.phone);
    try {
      await ctx
        .http()
        .post(`/me/invites/${stored.token}/accept`)
        .set(bearer(token))
        .expect(409)
        .expect('x-error-code', 'STAFF_OWNER_PROTECTED');
      const after = await ctx.prisma.membership.findUniqueOrThrow({
        where: { id: owner.id },
        select: { roleTemplate: { select: { isOwner: true } } },
      });
      expect(after.roleTemplate.isOwner).toBe(true);
    } finally {
      await ctx.prisma.inviteToken.deleteMany({ where: { id: stored.id } });
      // Restore the owner role if the redemption replaced it.
      const ownerRole = await ctx.prisma.roleTemplate.findFirstOrThrow({ where: { restaurantId, isOwner: true } });
      await ctx.prisma.membership.update({
        where: { id: owner.id },
        data: { roleTemplateId: ownerRole.id, status: 'ACTIVE' },
      });
    }
  });

  it('redeems a link exactly once under parallel acceptance', async () => {
    await ctx.prisma.membership.deleteMany({ where: { restaurantId, user: { phone: formerPhone } } });
    const created = await invite(ownerToken, formerPhone, narrowRoleId).expect(201);
    const token = tokenOf(created.body.url as string);
    const formerToken = await ctx.login(formerPhone);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ctx.http().post(`/me/invites/${token}/accept`).set(bearer(formerToken))),
    );
    const outcomes = results.map((r) => (r.status === 200 ? 'OK' : `${r.status} ${String(r.headers['x-error-code'])}`));
    expect(outcomes.filter((o) => o === 'OK')).toHaveLength(1);
    expect(outcomes.filter((o) => o === '409 INVITE_USED')).toHaveLength(results.length - 1);
  });
});
