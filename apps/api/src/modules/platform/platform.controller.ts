import { Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import {
  InvitePlatformUserSchema,
  SetupPlatformTenantSchema,
  UpdatePlatformUserSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  InvitePlatformUserInput,
  PlatformAdminDTO,
  PlatformContextDTO,
  SetupPlatformTenantInput,
  UpdatePlatformUserInput,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/tenant-context';
import { PlatformService } from './platform.service';

/** The console sets up the platform tenant and manages platform marketing users (docs/PAZARLAMA.md). */
@Controller('admin/platform')
@SuperAdminOnly()
export class AdminPlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  get(): Promise<PlatformAdminDTO> {
    return this.platform.admin();
  }

  @Post('setup')
  @HttpCode(200)
  setup(
    @CurrentUser() user: AuthUser,
    @ZodBody(SetupPlatformTenantSchema) body: SetupPlatformTenantInput,
  ): Promise<PlatformAdminDTO> {
    return this.platform.setup(body, user.id);
  }

  @Post('users')
  @HttpCode(200)
  invite(
    @CurrentUser() user: AuthUser,
    @ZodBody(InvitePlatformUserSchema) body: InvitePlatformUserInput,
  ): Promise<PlatformAdminDTO> {
    return this.platform.invite(body, user.id);
  }

  @Patch('users/:membershipId')
  update(
    @CurrentUser() user: AuthUser,
    @ZodParam('membershipId', UuidSchema) membershipId: string,
    @ZodBody(UpdatePlatformUserSchema) body: UpdatePlatformUserInput,
  ): Promise<PlatformAdminDTO> {
    return this.platform.update(membershipId, body, user.id);
  }
}

/** The marketing shell asks who the person is on the platform (docs/PAZARLAMA.md). */
@Controller('platform')
@UseGuards(JwtAuthGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('context')
  context(@CurrentUser() user: AuthUser): Promise<PlatformContextDTO> {
    return this.platform.context(user);
  }
}
