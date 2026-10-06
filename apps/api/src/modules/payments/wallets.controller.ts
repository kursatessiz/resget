import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CompleteWalletLinkSchema, LinkWalletSchema, WalletProviderSchema } from '@resget/shared';
import type {
  CompleteWalletLinkInput,
  LinkWalletInput,
  WalletLinkStartDTO,
  WalletProviderCode,
  WalletsDTO,
} from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { WalletsService } from './wallets.service';

/** The customer's platform wallets (docs/CUZDAN.md); cards are removed through me/payment-methods. */
@Controller('me/wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<WalletsDTO> {
    return this.wallets.list(user.id);
  }

  @Post(':code/link')
  @HttpCode(200)
  begin(
    @CurrentUser() user: AuthUser,
    @ZodParam('code', WalletProviderSchema) code: WalletProviderCode,
    @ZodBody(LinkWalletSchema) body: LinkWalletInput,
  ): Promise<WalletLinkStartDTO> {
    return this.wallets.beginLink(user.id, code, body.returnUrl);
  }

  @Post(':code/link/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @ZodParam('code', WalletProviderSchema) code: WalletProviderCode,
    @ZodBody(CompleteWalletLinkSchema) body: CompleteWalletLinkInput,
  ): Promise<WalletsDTO> {
    return this.wallets.completeLink(user.id, code, body.payload);
  }
}
