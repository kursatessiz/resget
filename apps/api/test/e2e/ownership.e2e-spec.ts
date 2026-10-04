import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';

const COURIER_PHONE = normalizePhone('05320000004')!;

/** Handing the business over to another member and back (docs/PERSONEL.md, "Sahipliğin devri"). */
describe('Ownership transfer (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  let courierToken: string;
  let ownerMembershipId: string;
  let courierMembershipId: string;
  let ownerRoleId: string;
  let courierRoleId: string;
  let managerRoleId: string;
  let originalCardId: string | null;
  let cardId: string;

  const transfer = (token: string, body: Record<string, unknown>, expected: number) =>
    ctx.http().post(`/restaurants/${restaurantId}/staff/ownership`).set(bearer(token)).send(body).expect(expected);

  beforeAll(async () => {
    ctx = await createTestApp();
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, billingPaymentMethodId: true },
    });
    restaurantId = restaurant.id;
    originalCardId = restaurant.billingPaymentMethodId;
    const owner = await ctx.prisma.membership.findFirstOrThrow({
      where: { restaurantId, user: { phone: SEED.ownerPhone } },
      select: { id: true, userId: true, roleTemplateId: true },
    });
    const courier = await ctx.prisma.membership.findFirstOrThrow({
      where: { restaurantId, user: { phone: COURIER_PHONE } },
      select: { id: true, roleTemplateId: true },
    });
    ownerMembershipId = owner.id;
    ownerRoleId = owner.roleTemplateId;
    courierMembershipId = courier.id;
    courierRoleId = courier.roleTemplateId;
    managerRoleId = (
      await ctx.prisma.roleTemplate.findFirstOrThrow({ where: { restaurantId, templateKey: 'manager' } })
    ).id;
    // The owner's own card pays the commission invoices before the handover.
    cardId = (
      await ctx.prisma.savedPaymentMethod.create({
        data: {
          userId: owner.userId,
          provider: 'MOCK',
          encryptedToken: 'e2e-ownership-token',
          keyVersion: 'v1',
          tokenHash: `e2e-ownership-${owner.userId}`,
          brand: 'VISA',
          last4: '4242',
          expiryMonth: 12,
          expiryYear: 2030,
        },
      })
    ).id;
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { billingPaymentMethodId: cardId } });
    [ownerToken, courierToken] = await Promise.all([ctx.login(SEED.ownerPhone), ctx.login(COURIER_PHONE)]);
  });

  afterAll(async () => {
    // Whatever happened above, the seed's owner is the owner again and the card setting is restored.
    await ctx.prisma.membership.update({ where: { id: ownerMembershipId }, data: { roleTemplateId: ownerRoleId } });
    await ctx.prisma.membership.update({ where: { id: courierMembershipId }, data: { roleTemplateId: courierRoleId } });
    await ctx.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { billingPaymentMethodId: originalCardId },
    });
    await ctx.prisma.savedPaymentMethod.deleteMany({ where: { id: cardId } });
    await ctx.prisma.auditLog.deleteMany({ where: { restaurantId, action: 'ownership.transferred' } });
    await ctx.close();
  });

  it('refuses invalid targets and roles', async () => {
    const self = await transfer(
      ownerToken,
      { toMembershipId: ownerMembershipId, previousOwnerRoleId: managerRoleId },
      409,
    );
    expect(self.body.code).toBe('OWNERSHIP_TARGET_INVALID');
    const ownerRole = await transfer(
      ownerToken,
      { toMembershipId: courierMembershipId, previousOwnerRoleId: ownerRoleId },
      409,
    );
    expect(ownerRole.body.code).toBe('ROLE_PROTECTED');
    // A courier holds no staff permission at all.
    await transfer(courierToken, { toMembershipId: courierMembershipId, previousOwnerRoleId: managerRoleId }, 403);
  });

  it('hands the business over, detaches the old owner card and lets only the new owner hand it back', async () => {
    const res = await transfer(
      ownerToken,
      { toMembershipId: courierMembershipId, previousOwnerRoleId: managerRoleId },
      200,
    );
    const members = res.body.members as { membershipId: string; isOwner: boolean; roleTemplateId: string }[];
    expect(members.find((m) => m.membershipId === courierMembershipId)?.isOwner).toBe(true);
    expect(members.find((m) => m.membershipId === ownerMembershipId)).toMatchObject({
      isOwner: false,
      roleTemplateId: managerRoleId,
    });
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(restaurant.billingPaymentMethodId).toBeNull();
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { restaurantId, action: 'ownership.transferred', entityId: courierMembershipId },
    });
    expect(audit.meta).toMatchObject({ billingCardDetached: true, previousOwnerRoleId: managerRoleId });

    // The former owner is a manager now: still on the staff screen, but no longer able to hand anything over.
    const again = await transfer(
      ownerToken,
      { toMembershipId: courierMembershipId, previousOwnerRoleId: managerRoleId },
      403,
    );
    expect(again.body.code).toBe('OWNERSHIP_TRANSFER_FORBIDDEN');

    // The new owner hands it back and returns to the courier role.
    const back = await transfer(
      courierToken,
      { toMembershipId: ownerMembershipId, previousOwnerRoleId: courierRoleId },
      200,
    );
    const after = back.body.members as { membershipId: string; isOwner: boolean; roleTemplateId: string }[];
    expect(after.find((m) => m.membershipId === ownerMembershipId)?.isOwner).toBe(true);
    expect(after.find((m) => m.membershipId === courierMembershipId)?.roleTemplateId).toBe(courierRoleId);
  });
});
