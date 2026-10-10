import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AccessTokenClaims } from '@resget/shared';
import { unauthorized } from '../../common/api-error';
import { SessionsService } from './sessions.service';
import type { AuthUser } from './tenant-context';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly sessions: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Runs on every authenticated request so a deleted or demoted user, or a signed-out session, is cut off
   * immediately: one read of the session with its user (docs/GUVENLIK.md "Oturumlar").
   */
  async validate(claims: AccessTokenClaims & { exp?: number }): Promise<AuthUser> {
    if (claims.type !== 'access') throw unauthorized('Not an access token');
    // A deleted account is cut off at once, whatever tokens it still holds (docs/KISISEL_VERI.md).
    const user = await this.sessions.userFor(claims.sub, claims.sid);
    if (!user) throw unauthorized('Unknown user');
    return { ...user, sessionId: claims.sid, accessExpiresAt: claims.exp };
  }
}
