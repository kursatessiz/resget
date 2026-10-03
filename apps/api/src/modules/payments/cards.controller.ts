import { Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UuidSchema } from '@resget/shared';
import type { SavedPaymentMethodDTO } from '@resget/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { PaymentsService } from './payments.service';

const BeginLinkSchema = z.object({ returnUrl: z.string().url() }).strict();
const CompleteLinkSchema = z.object({ payload: z.record(z.string(), z.string()) }).strict();

/** A customer's own cards: linked and charged through the vault, listed and removed here. */
@Controller('me/payment-methods')
@UseGuards(JwtAuthGuard)
export class CardsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<SavedPaymentMethodDTO[]> {
    return this.payments.listSavedCards(user.id);
  }

  @Post('link')
  @HttpCode(200)
  begin(@CurrentUser() user: AuthUser, @ZodBody(BeginLinkSchema) body: z.infer<typeof BeginLinkSchema>) {
    return this.payments.beginCardLink(user.id, body.returnUrl);
  }

  @Post('link/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @ZodBody(CompleteLinkSchema) body: z.infer<typeof CompleteLinkSchema>,
  ): Promise<SavedPaymentMethodDTO[]> {
    return this.payments.completeCardLink(user.id, body.payload);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.payments.removeSavedCard(user.id, UuidSchema.parse(id));
  }
}
