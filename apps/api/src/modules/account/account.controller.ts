import { Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { SaveAddressSchema, UpdateAddressSchema, UpdateProfileSchema, UuidSchema } from '@resget/shared';
import type { CustomerAccountDTO, CustomerAddressDTO, CustomerOrderDTO, StorefrontViewerDTO } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { AccountService } from './account.service';

/** The signed-in person's own account: no restaurant scope, only their user id. */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('account')
  getAccount(@CurrentUser() user: AuthUser): Promise<CustomerAccountDTO> {
    return this.account.account(user.id);
  }

  @Get('viewer')
  viewer(@CurrentUser() user: AuthUser): Promise<StorefrontViewerDTO> {
    return this.account.viewer(user.id);
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
