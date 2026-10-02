import { Controller, Get, Headers } from '@nestjs/common';
import { QrScanSessionSchema, TableQrTokenSchema } from '@resget/shared';
import { ZodParam } from '../../common/zod-body.pipe';
import { MenuService } from './menu.service';
import type { PublicMenuDTO } from './menu.service';

/** Public, unauthenticated: what a guest sees after scanning a table QR. */
@Controller('public')
export class PublicMenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('qr/:token')
  byTable(
    @ZodParam('token', TableQrTokenSchema) token: string,
    @Headers('x-qr-session') session?: string,
  ): Promise<PublicMenuDTO> {
    const parsed = QrScanSessionSchema.safeParse(session);
    return this.menu.publicMenuByTableToken(token, parsed.success ? parsed.data : null);
  }
}
