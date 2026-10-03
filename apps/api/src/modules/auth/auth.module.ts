import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { InviteAcceptanceService } from './invite-acceptance.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { ApiKeyOrJwtAuthGuard } from './guards/api-key-or-jwt-auth.guard';
import { ApiKeysService } from './api-keys.service';
import { RestaurantTenantGuard } from './guards/restaurant-tenant.guard';
import { PermissionGuard } from './guards/permission.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    InviteAcceptanceService,
    JwtStrategy,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    ApiKeyOrJwtAuthGuard,
    ApiKeysService,
    RestaurantTenantGuard,
    PermissionGuard,
    SuperAdminGuard,
  ],
  exports: [
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    ApiKeyOrJwtAuthGuard,
    ApiKeysService,
    RestaurantTenantGuard,
    PermissionGuard,
    SuperAdminGuard,
    InviteAcceptanceService,
  ],
})
export class AuthModule {}
