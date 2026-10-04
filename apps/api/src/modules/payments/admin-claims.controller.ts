import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApproveClaimSchema, DeclineClaimSchema, UuidSchema } from '@resget/shared';
import type { AdminClaimDTO, ApproveClaimInput, DeclineClaimInput } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ClaimsService } from './claims.service';

/** The platform console's queue of escalated missing-item claims (docs/ODEME.md, "Eksik ürün bildirimi"). */
@Controller('admin/claims')
@SuperAdminOnly()
export class AdminClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  list(): Promise<AdminClaimDTO[]> {
    return this.claims.escalated();
  }

  @Post(':claimId/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() user: AuthUser,
    @ZodParam('claimId', UuidSchema) claimId: string,
    @ZodBody(ApproveClaimSchema) body: ApproveClaimInput,
  ): Promise<AdminClaimDTO[]> {
    await this.claims.decideAsPlatform(claimId, { action: 'approve', input: body }, user.id);
    return this.claims.escalated();
  }

  @Post(':claimId/decline')
  @HttpCode(200)
  async decline(
    @CurrentUser() user: AuthUser,
    @ZodParam('claimId', UuidSchema) claimId: string,
    @ZodBody(DeclineClaimSchema) body: DeclineClaimInput,
  ): Promise<AdminClaimDTO[]> {
    await this.claims.decideAsPlatform(claimId, { action: 'decline', input: body }, user.id);
    return this.claims.escalated();
  }
}
