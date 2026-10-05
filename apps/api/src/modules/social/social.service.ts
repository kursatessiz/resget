import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { META_OAUTH_SCOPES, OAUTH_RETURN_PATH_PATTERN, OAUTH_STATE_TTL_MINUTES } from '@resget/shared';
import type {
  OAuthResult,
  OAuthStartDTO,
  SocialAccountDTO,
  SocialAccountKind,
  SocialAccountStatus,
  UpdateSocialAccountInput,
} from '@resget/shared';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
import { conflict, notFound } from '../../common/api-error';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { META_GRAPH } from './meta-graph';
import type { MetaGraph } from './meta-graph';

type AccountRow = Awaited<ReturnType<PrismaService['socialAccount']['findFirstOrThrow']>>;

/** What the callback hands back: where to send the browser. */
export interface CallbackOutcome {
  redirectUrl: string;
}

/**
 * Social account connections over OAuth (docs/ENTEGRASYON_MERKEZI.md). A
 * consent round trip carries a random state bound to the tenant and the user
 * who started it, usable once within ten minutes. Page tokens are encrypted
 * at rest and never leave in a response; the browser only ever goes back to
 * one of the app's own integration screens.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
  private readonly cipher: CredentialCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
    private readonly config: ConfigService,
    @Optional() @Inject(META_GRAPH) private readonly meta: MetaGraph | null,
  ) {
    this.cipher = new CredentialCipher(
      new EnvKeyProvider(config.get<string>('CREDENTIAL_ENCRYPTION_KEY') ?? DEV_CREDENTIAL_KEY),
    );
  }

  private redirectUri(): string {
    const api = (this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:4000').replace(/\/+$/, '');
    return `${api}/public/oauth/meta/callback`;
  }

  private appUrl(path: string, result: OAuthResult): string {
    const app = (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    return `${app}${path}?meta=${result}`;
  }

  /** The token an account acts with; for the publishing and leads modules, never for a response. */
  tokenOf(row: { encryptedToken: string }): string {
    return this.cipher.decrypt(row.encryptedToken);
  }

  // -- Consent round trip ----------------------------------------------------------------

  async startMeta(restaurantId: string, userId: string, returnPath: string, now = new Date()): Promise<OAuthStartDTO> {
    if (!this.meta) throw conflict('SOCIAL_NOT_CONFIGURED', 'No Meta app is configured');
    // Old round trips are of no use; they are cleared as new ones begin.
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });
    const state = randomBytes(32).toString('base64url');
    await this.prisma.oAuthState.create({
      data: {
        state,
        restaurantId,
        userId,
        provider: 'META',
        returnPath,
        expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MINUTES * 60_000),
      },
    });
    return { authorizeUrl: this.meta.authorizeUrl(state, this.redirectUri()) };
  }

  async metaCallback(
    query: { code?: string; state?: string; error?: string },
    now = new Date(),
  ): Promise<CallbackOutcome> {
    const fallback = { redirectUrl: this.appUrl('/panel', 'error') };
    if (!query.state || query.state.length > 200) return fallback;
    // Claimed atomically: a replayed or late state finds nothing to claim.
    const claimed = await this.prisma.oAuthState.updateMany({
      where: { state: query.state, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return fallback;
    const row = await this.prisma.oAuthState.findUniqueOrThrow({ where: { state: query.state } });
    // Stored paths were validated at the start; checked again so the redirect can only stay inside the app.
    const back = OAUTH_RETURN_PATH_PATTERN.test(row.returnPath) ? row.returnPath : '/panel';
    if (query.error || !query.code) return { redirectUrl: this.appUrl(back, query.error ? 'denied' : 'error') };
    if (!this.meta || !(await this.features.isEnabled('integration_hub', row.restaurantId))) {
      return { redirectUrl: this.appUrl(back, 'error') };
    }

    try {
      const user = await this.meta.exchangeCode(query.code, this.redirectUri());
      const accounts = await this.meta.accounts(user.token);
      await this.prisma.$transaction(async (tx) => {
        for (const account of accounts) {
          const data = {
            kind: account.kind,
            name: account.name.slice(0, 200),
            encryptedToken: this.cipher.encrypt(account.token),
            scopes: [...META_OAUTH_SCOPES],
            status: 'ACTIVE',
            // Page tokens taken from a long-lived user token do not expire.
            tokenExpiresAt: null,
            connectedByUserId: row.userId,
          };
          await tx.socialAccount.upsert({
            where: {
              restaurantId_provider_externalId: {
                restaurantId: row.restaurantId,
                provider: 'META',
                externalId: account.externalId,
              },
            },
            create: { restaurantId: row.restaurantId, provider: 'META', externalId: account.externalId, ...data },
            update: data,
          });
        }
        await tx.auditLog.create({
          data: {
            restaurantId: row.restaurantId,
            actorUserId: row.userId,
            action: 'social.connect',
            entity: 'social_account',
            meta: { provider: 'META', accounts: accounts.length },
          },
        });
      });
      return { redirectUrl: this.appUrl(back, 'connected') };
    } catch (error) {
      this.logger.warn(`Meta connect failed: ${error instanceof Error ? error.message : 'error'}`);
      return { redirectUrl: this.appUrl(back, 'error') };
    }
  }

  // -- Accounts --------------------------------------------------------------------------

  async list(restaurantId: string): Promise<SocialAccountDTO[]> {
    const rows = await this.prisma.socialAccount.findMany({
      where: { restaurantId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  async update(
    restaurantId: string,
    accountId: string,
    actorUserId: string,
    input: UpdateSocialAccountInput,
  ): Promise<SocialAccountDTO> {
    const row = await this.require(restaurantId, accountId);
    // An account taken out of use stops importing leads too; turning it back on does not resume them by itself.
    const updated = await this.prisma.socialAccount.update({
      where: { id: row.id },
      data: input.enabled ? { enabled: true } : { enabled: false, leadsEnabled: false },
    });
    await this.audit(restaurantId, actorUserId, input.enabled ? 'social.enable' : 'social.disable', row);
    return this.toDto(updated);
  }

  async remove(restaurantId: string, accountId: string, actorUserId: string): Promise<void> {
    const row = await this.require(restaurantId, accountId);
    await this.prisma.socialAccount.delete({ where: { id: row.id } });
    await this.audit(restaurantId, actorUserId, 'social.disconnect', row);
  }

  async require(restaurantId: string, accountId: string): Promise<AccountRow> {
    const row = await this.prisma.socialAccount.findFirst({ where: { id: accountId, restaurantId } });
    if (!row) throw notFound('SOCIAL_ACCOUNT_NOT_FOUND', 'Social account not found');
    return row;
  }

  private async audit(restaurantId: string, actorUserId: string, action: string, row: AccountRow): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        restaurantId,
        actorUserId,
        action,
        entity: 'social_account',
        entityId: row.id,
        meta: { provider: row.provider, kind: row.kind, externalId: row.externalId },
      },
    });
  }

  toDto(row: AccountRow): SocialAccountDTO {
    return {
      id: row.id,
      provider: 'META',
      kind: row.kind as SocialAccountKind,
      externalId: row.externalId,
      name: row.name,
      enabled: row.enabled,
      leadsEnabled: row.leadsEnabled,
      status: row.status as SocialAccountStatus,
      scopes: row.scopes,
      connectedAt: row.createdAt.toISOString(),
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    };
  }
}
