import { Injectable } from '@nestjs/common';
import {
  PLATFORM_PERMISSION_KEYS,
  PLATFORM_ROLES,
  PLATFORM_ROLE_KEYS,
  platformRoleOf,
  platformRoleSystemKey,
  platformTenantPermissions,
} from '@resget/shared';
import type {
  InvitePlatformUserInput,
  PlatformAdminDTO,
  PlatformContextDTO,
  PlatformRoleKey,
  PlatformUserDTO,
  SetupPlatformTenantInput,
  UpdatePlatformUserInput,
} from '@resget/shared';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { maskPhone } from '../messaging/sms.provider';
import { conflict, forbidden, notFound } from '../../common/api-error';

/** Slug of the platform tenant; reserved for sign-up so no restaurant can take it. */
export const PLATFORM_TENANT_SLUG = 'platform';

/**
 * Platform marketing access (docs/PAZARLAMA.md). The only writer of the
 * platform tenant and its locked roles: each platform role is mirrored as a
 * role template (systemKey platform:<role>) whose permissions are the
 * restaurant permissions the role grants, so every tenant screen works for
 * a platform user unchanged. Platform users are members of the platform
 * tenant, added and changed only from the console.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  async tenant() {
    return this.prisma.restaurant.findFirst({
      where: { isPlatform: true },
      select: { id: true, slug: true, currency: true, countryCode: true },
    });
  }

  // -- Console -------------------------------------------------------------------------

  async admin(): Promise<PlatformAdminDTO> {
    const tenant = await this.tenant();
    return {
      tenant,
      enabled: tenant ? await this.features.isEnabled('marketing_platform', tenant.id) : false,
      users: tenant ? await this.users(tenant.id) : [],
    };
  }

  /** Creates the platform tenant once, on PRO with no trial end, and its locked roles; later calls only resync roles. */
  async setup(input: SetupPlatformTenantInput, actorUserId: string): Promise<PlatformAdminDTO> {
    let tenant = await this.tenant();
    if (!tenant) {
      const pro = await this.prisma.plan.findUnique({ where: { code: 'PRO' }, select: { id: true } });
      if (!pro) throw conflict('PLANS_MISSING', 'Create the plans first (bootstrap)');
      const created = await this.prisma.restaurant.create({
        data: {
          slug: PLATFORM_TENANT_SLUG,
          name: input.name,
          countryCode: input.countryCode,
          currency: input.currency,
          timezone: input.timezone,
          defaultLocale: input.defaultLocale,
          isPlatform: true,
          isListed: false,
          commissionBps: 0,
          subscription: { create: { planId: pro.id, status: 'ACTIVE' } },
        },
        select: { id: true },
      });
      await this.prisma.auditLog.create({
        data: {
          actorUserId,
          restaurantId: created.id,
          action: 'platform.setup',
          entity: 'Restaurant',
          entityId: created.id,
        },
      });
      tenant = await this.tenant();
    }
    await this.syncRoles(tenant!.id);
    return this.admin();
  }

  async invite(input: InvitePlatformUserInput, actorUserId: string): Promise<PlatformAdminDTO> {
    const tenant = await this.requireTenant();
    await this.syncRoles(tenant.id);
    const role = await this.roleTemplate(tenant.id, input.role);
    const user = await this.prisma.user.upsert({
      where: { phone: input.phone },
      update: {},
      create: { phone: input.phone, fullName: input.fullName },
      select: { id: true, isSuperAdmin: true },
    });
    if (user.isSuperAdmin) throw conflict('VALIDATION', 'The super admin already has every platform permission');
    const membership = await this.prisma.membership.upsert({
      where: { userId_restaurantId: { userId: user.id, restaurantId: tenant.id } },
      update: { roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() },
      create: {
        userId: user.id,
        restaurantId: tenant.id,
        roleTemplateId: role.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
      select: { id: true },
    });
    await this.audit(tenant.id, actorUserId, 'platform.user.invite', membership.id, { role: input.role });
    return this.admin();
  }

  async update(membershipId: string, input: UpdatePlatformUserInput, actorUserId: string): Promise<PlatformAdminDTO> {
    const tenant = await this.requireTenant();
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, restaurantId: tenant.id },
      select: { id: true },
    });
    if (!membership) throw notFound('NOT_FOUND', 'Platform user not found');
    const data: { roleTemplateId?: string; status?: 'ACTIVE' | 'PASSIVE' } = {};
    if (input.role) data.roleTemplateId = (await this.roleTemplate(tenant.id, input.role)).id;
    if (input.active !== undefined) data.status = input.active ? 'ACTIVE' : 'PASSIVE';
    await this.prisma.membership.update({ where: { id: membership.id }, data });
    await this.audit(tenant.id, actorUserId, 'platform.user.update', membership.id, {
      ...(input.role ? { role: input.role } : {}),
      ...(input.active !== undefined ? { active: String(input.active) } : {}),
    });
    return this.admin();
  }

  // -- Marketing shell -----------------------------------------------------------------

  /** Who may open /pazarlama and with which platform permissions; refused while the module is off. */
  async context(user: { id: string; isSuperAdmin: boolean }): Promise<PlatformContextDTO> {
    const tenant = await this.tenant();
    if (!tenant) throw notFound('PLATFORM_NOT_SET_UP', 'The platform tenant is not set up');
    await this.features.assertEnabled('marketing_platform', tenant.id);
    const features = await this.features.enabledFor(tenant.id);
    if (user.isSuperAdmin) {
      return {
        restaurantId: tenant.id,
        restaurantSlug: tenant.slug,
        isSuperAdmin: true,
        role: null,
        permissions: [...PLATFORM_PERMISSION_KEYS],
        features,
      };
    }
    const membership = await this.prisma.membership.findUnique({
      where: { userId_restaurantId: { userId: user.id, restaurantId: tenant.id } },
      select: { status: true, roleTemplate: { select: { systemKey: true } } },
    });
    const role = membership?.status === 'ACTIVE' ? platformRoleOf(membership.roleTemplate.systemKey) : null;
    if (!role) throw forbidden('PLATFORM_ACCESS_DENIED', 'No platform marketing access');
    return {
      restaurantId: tenant.id,
      restaurantSlug: tenant.slug,
      isSuperAdmin: false,
      role,
      permissions: [...PLATFORM_ROLES[role]],
      features,
    };
  }

  // -- Helpers -------------------------------------------------------------------------

  private async requireTenant() {
    const tenant = await this.tenant();
    if (!tenant) throw notFound('PLATFORM_NOT_SET_UP', 'The platform tenant is not set up');
    return tenant;
  }

  /** Mirrors every platform role as a locked role template with the restaurant permissions it grants. */
  private async syncRoles(restaurantId: string): Promise<void> {
    for (const role of PLATFORM_ROLE_KEYS) {
      const systemKey = platformRoleSystemKey(role);
      const permissions = platformTenantPermissions(PLATFORM_ROLES[role]);
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.roleTemplate.findFirst({ where: { restaurantId, systemKey }, select: { id: true } });
        const template =
          existing ??
          (await tx.roleTemplate.create({
            data: { restaurantId, systemKey, name: systemKey, isOwner: false },
            select: { id: true },
          }));
        await tx.roleTemplatePermission.deleteMany({ where: { roleTemplateId: template.id } });
        await tx.roleTemplatePermission.createMany({
          data: permissions.map((permissionKey) => ({ roleTemplateId: template.id, permissionKey })),
        });
      });
    }
  }

  private async roleTemplate(restaurantId: string, role: PlatformRoleKey) {
    const template = await this.prisma.roleTemplate.findFirst({
      where: { restaurantId, systemKey: platformRoleSystemKey(role) },
      select: { id: true },
    });
    if (!template) throw notFound('NOT_FOUND', 'Platform role missing');
    return template;
  }

  private async users(restaurantId: string): Promise<PlatformUserDTO[]> {
    const rows = await this.prisma.membership.findMany({
      where: { restaurantId, user: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, phone: true } },
        roleTemplate: { select: { systemKey: true } },
      },
    });
    return rows.flatMap((row) => {
      const role = platformRoleOf(row.roleTemplate.systemKey);
      if (!role) return [];
      return [
        {
          membershipId: row.id,
          userId: row.user.id,
          fullName: row.user.fullName,
          phoneMasked: maskPhone(row.user.phone),
          role,
          active: row.status === 'ACTIVE',
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
  }

  private async audit(
    restaurantId: string,
    actorUserId: string,
    action: string,
    entityId: string,
    meta: Record<string, string>,
  ) {
    await this.prisma.auditLog.create({
      data: { actorUserId, restaurantId, action, entity: 'Membership', entityId, meta },
    });
  }
}
