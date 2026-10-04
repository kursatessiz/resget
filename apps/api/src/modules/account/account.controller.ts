import { Controller, Delete, Get, HttpCode, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import {
  DeleteAccountSchema,
  SaveAddressSchema,
  UpdateAddressSchema,
  UpdateProfileSchema,
  UuidSchema,
} from '@resget/shared';
import type {
  CustomerAccountDTO,
  CustomerAddressDTO,
  CustomerOrderDTO,
  PersonalDataExportDTO,
  StorefrontViewerDTO,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { AccountService } from './account.service';
import { PrivacyService } from './privacy.service';

/** The signed-in person's own account: no restaurant scope, only their user id. */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly privacy: PrivacyService,
  ) {}

  /** Everything the platform holds about the signed-in person (docs/KISISEL_VERI.md). */
  @Get('data-export')
  dataExport(@CurrentUser() user: AuthUser): Promise<PersonalDataExportDTO> {
    return this.privacy.exportData(user.id);
  }

  /** Deletes the signed-in person's account; final (docs/KISISEL_VERI.md). */
  @Post('account/delete')
  @HttpCode(204)
  async deleteAccount(
    @CurrentUser() user: AuthUser,
    @ZodBody(DeleteAccountSchema) _body: z.infer<typeof DeleteAccountSchema>,
  ): Promise<void> {
    await this.privacy.deleteAccount(user.id);
  }

  @Get('account')
  getAccount(@CurrentUser() user: AuthUser): Promise<CustomerAccountDTO> {
    return this.account.account(user.id);
  }

  /** `restaurantId` adds the loyalty balance at that restaurant (docs/SADAKAT.md). */
  @Get('viewer')
  viewer(@CurrentUser() user: AuthUser, @Query('restaurantId') restaurantId?: string): Promise<StorefrontViewerDTO> {
    const scoped = restaurantId && UuidSchema.safeParse(restaurantId).success ? restaurantId : null;
    return this.account.viewer(user.id, scoped);
  }

  @Patch('profile')
  profile(
    @CurrentUser() user: AuthUser,
    @ZodBody(UpdateProfileSchema) body: z.infer<typeof UpdateProfileSchema>,
  ): Promise<CustomerAccountDTO> {
    return this.account.updateProfile(user.id, body);
  }

  @Get('addresses')
  addresses(@CurrentUser() user: AuthUser): Promise<CustomerAddressDTO[]> {
    return this.account.addresses(user.id);
  }

  @Post('addresses')
  addAddress(
    @CurrentUser() user: AuthUser,
    @ZodBody(SaveAddressSchema) body: z.infer<typeof SaveAddressSchema>,
  ): Promise<CustomerAddressDTO[]> {
    return this.account.addAddress(user.id, body);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser() user: AuthUser,
    @ZodParam('id', UuidSchema) id: string,
    @ZodBody(UpdateAddressSchema) body: z.infer<typeof UpdateAddressSchema>,
  ): Promise<CustomerAddressDTO[]> {
    return this.account.updateAddress(user.id, id, body);
  }

  @Delete('addresses/:id')
  removeAddress(@CurrentUser() user: AuthUser, @ZodParam('id', UuidSchema) id: string): Promise<CustomerAddressDTO[]> {
    return this.account.removeAddress(user.id, id);
  }

  @Get('orders')
  orders(@CurrentUser() user: AuthUser): Promise<CustomerOrderDTO[]> {
    return this.account.orders(user.id);
  }
}
