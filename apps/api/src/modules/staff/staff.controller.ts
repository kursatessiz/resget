import { Controller, Delete, Get, Header, HttpCode, Patch, Post, StreamableFile, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateInviteSchema,
  CreateRoleSchema,
  InviteTokenSchema,
  UpdateMembershipSchema,
  UpdateRoleSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  InviteAcceptedDTO,
  InviteDTO,
  PublicInviteDTO,
  RoleTemplateDTO,
  StaffMemberDTO,
  StaffOverviewDTO,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { RequirePermission, RestaurantScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InviteAcceptanceService } from '../auth/invite-acceptance.service';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { StaffService } from './staff.service';

@Controller('restaurants/:restaurantId/staff')
@RestaurantScoped()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermission('staff.manage')
  overview(@Tenant() tenant: TenantContext): Promise<StaffOverviewDTO> {
    return this.staff.overview(tenant.restaurantId);
  }

  @Patch('members/:membershipId')
  @RequirePermission('staff.manage')
  updateMember(
    @Tenant() tenant: TenantContext,
    @ZodParam('membershipId', UuidSchema) membershipId: string,
    @ZodBody(UpdateMembershipSchema) body: z.infer<typeof UpdateMembershipSchema>,
  ): Promise<StaffMemberDTO> {
    return this.staff.updateMember(tenant, membershipId, body);
  }

  @Post('invites')
  @RequirePermission('staff.manage')
  invite(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateInviteSchema) body: z.infer<typeof CreateInviteSchema>,
  ): Promise<InviteDTO> {
    return this.staff.createInvite(tenant, user.id, body);
  }

  @Delete('invites/:inviteId')
  @HttpCode(204)
  @RequirePermission('staff.manage')
  revoke(@Tenant() tenant: TenantContext, @ZodParam('inviteId', UuidSchema) inviteId: string): Promise<void> {
    return this.staff.revokeInvite(tenant.restaurantId, inviteId);
  }

  /** The invite link as a QR to show on a screen; the person scans it with their own phone. */
  @Get('invites/:inviteId/qr.png')
  @Header('cache-control', 'no-store')
  @RequirePermission('staff.manage')
  async inviteQr(
    @Tenant() tenant: TenantContext,
    @ZodParam('inviteId', UuidSchema) inviteId: string,
  ): Promise<StreamableFile> {
    const png = await this.staff.inviteQrPng(tenant.restaurantId, inviteId);
    return new StreamableFile(png, { type: 'image/png' });
  }

  @Get('roles')
  @RequirePermission('staff.manage')
  roles(@Tenant() tenant: TenantContext): Promise<RoleTemplateDTO[]> {
    return this.staff.listRoles(tenant.restaurantId);
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  createRole(
    @Tenant() tenant: TenantContext,
    @ZodBody(CreateRoleSchema) body: z.infer<typeof CreateRoleSchema>,
  ): Promise<RoleTemplateDTO> {
    return this.staff.createRole(tenant.restaurantId, body);
  }

  @Patch('roles/:roleId')
  @RequirePermission('roles.manage')
  updateRole(
    @Tenant() tenant: TenantContext,
    @ZodParam('roleId', UuidSchema) roleId: string,
    @ZodBody(UpdateRoleSchema) body: z.infer<typeof UpdateRoleSchema>,
  ): Promise<RoleTemplateDTO> {
    return this.staff.updateRole(tenant.restaurantId, roleId, body);
  }

  @Delete('roles/:roleId')
  @HttpCode(204)
  @RequirePermission('roles.manage')
  deleteRole(@Tenant() tenant: TenantContext, @ZodParam('roleId', UuidSchema) roleId: string): Promise<void> {
    return this.staff.deleteRole(tenant.restaurantId, roleId);
  }
}

/** The invite page: readable without a session, accepted with one. */
@Controller()
export class InvitesController {
  constructor(
    private readonly staff: StaffService,
    private readonly acceptance: InviteAcceptanceService,
  ) {}

  @Get('public/invites/:token')
  publicInvite(@ZodParam('token', InviteTokenSchema) token: string): Promise<PublicInviteDTO> {
    return this.staff.publicInvite(token);
  }

  /** A signed-in user (for example staff of another restaurant) accepts with their current session. */
  @Post('me/invites/:token/accept')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  accept(
    @CurrentUser() user: AuthUser,
    @ZodParam('token', InviteTokenSchema) token: string,
  ): Promise<InviteAcceptedDTO> {
    return this.acceptance.accept(user.id, token);
  }
}
