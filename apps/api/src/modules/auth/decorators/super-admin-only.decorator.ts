import { UseGuards, applyDecorators } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SuperAdminGuard } from '../guards/super-admin.guard';

/** JWT + platform owner check. Every route under /admin/* carries this. */
export const SuperAdminOnly = () => applyDecorators(UseGuards(JwtAuthGuard, SuperAdminGuard));
