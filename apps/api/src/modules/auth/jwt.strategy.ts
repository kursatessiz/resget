import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AccessTokenClaims } from '@resget/shared';
import { PrismaService } from '../prisma/prisma.service';
import { unauthorized } from '../../common/api-error';
import type { AuthUser } from './tenant-context';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /** Runs on every authenticated request so a deleted or demoted user is cut off immediately. */
  async validate(claims: AccessTokenClaims): Promise<AuthUser> {
    if (claims.type !== 'access') throw unauthorized('Not an access token');
    const user = await this.prisma.user.findFirst({
      // A deleted account is cut off at once, whatever tokens it still holds (docs/KISISEL_VERI.md).
      where: { id: claims.sub, deletedAt: null },
      select: { id: true, phone: true, fullName: true, isSuperAdmin: true },
    });
    if (!user) throw unauthorized('Unknown user');
    return user;
  }
}
