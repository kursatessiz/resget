import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  META_OAUTH_CALLBACK_PATH,
  META_OAUTH_SCOPES,
  OAUTH_RETURN_PATH_PATTERN,
  OAUTH_STATE_TTL_MINUTES,
} from '@resget/shared';
import type {
  CompleteMetaConnectInput,
  OAuthCompleteDTO,
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

/**
 * Social account connections over OAuth (docs/ENTEGRASYON_MERKEZI.md). A
 * consent round trip carries a random state bound to the tenant and the user
 * who started it, usable once within ten minutes, and only that user's
 * session can finish it: Meta returns the browser to the web app, which
 * passes the query on with the session of that browser. Page tokens are
 * encrypted at rest and never leave in a response; the browser only ever goes
 * back to one of the app's own integration screens.
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

  private appBase(): string {
    return (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  /** Registered in the Meta app as the valid OAuth redirect URI: a route of the web app, never the API. */
  private redirectUri(): string {
    return `${this.appBase()}${META_OAUTH_CALLBACK_PATH}`;
  }

  /** The address the old public API callback sends a browser to: the round trip is not finished there any more. */
  legacyCallbackRedirect(): string {
    return this.appUrl('/panel', 'error');
  }

  private appUrl(path: string, result: OAuthResult): string {
    return `${this.appBase()}${path}?meta=${result}`;
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

  /**
   * Finishes a round trip for the signed-in person who started it. The state is claimed atomically and only
   * with that person's user id: a forwarded consent link completed in someone else's browser (another
   * session, or none) finds nothing to claim, writes nothing and leaves the state as it was.
   */
  async completeMeta(userId: string, input: CompleteMetaConnectInput, now = new Date()): Promise<OAuthCompleteDTO> {
    const fallback: OAuthCompleteDTO = { returnPath: '/panel', result: 'error' };
    const claimed = await this.prisma.oAuthState.updateMany({
      where: { state: input.state, userId, provider: 'META', usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return fallback;
    const row = await this.prisma.oAuthState.findUniqueOrThrow({ where: { state: input.state } });
    // Stored paths were validated at the start; checked again so the redirect can only stay inside the app.
    const back = OAUTH_RETURN_PATH_PATTERN.test(row.returnPath) ? row.returnPath : '/panel';
    if (input.error || !input.code) return { returnPath: back, result: input.error ? 'denied' : 'error' };
    if (!this.meta || !(await this.features.isEnabled('integration_hub', row.restaurantId))) {
      return { returnPath: back, result: 'error' };
    }

    try {
      const user = await this.meta.exchangeCode(input.code, this.redirectUri());
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
      return { returnPath: back, result: 'connected' };
    } catch (error) {
      this.logger.warn(`Meta connect failed: ${error instanceof Error ? error.message : 'error'}`);
      return { returnPath: back, result: 'error' };
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
