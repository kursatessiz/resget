import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { EXPO_PUSH_TOKEN_PATTERN, RegisterPushDeviceSchema } from '@resget/shared';
import type { PushDeviceDTO, RegisterPushDeviceInput } from '@resget/shared';
import { ZodBody, ZodParam } from '../../common/zod-body.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/tenant-context';
import { PushService } from './push.service';

const PushTokenParamSchema = z.string().regex(EXPO_PUSH_TOKEN_PATTERN);

/** The signed-in person's phones; no restaurant scope, a device follows the account (docs/MESAJLASMA.md). */
@Controller('me/devices')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<PushDeviceDTO[]> {
    return this.push.list(user.id);
  }

  @Post()
  register(
    @CurrentUser() user: AuthUser,
    @ZodBody(RegisterPushDeviceSchema) body: RegisterPushDeviceInput,
  ): Promise<PushDeviceDTO> {
    return this.push.register(user.id, body);
  }

  @Delete(':token')
  @HttpCode(204)
  async unregister(
    @CurrentUser() user: AuthUser,
    @ZodParam('token', PushTokenParamSchema) token: string,
  ): Promise<void> {
    await this.push.unregister(user.id, token);
  }
}
