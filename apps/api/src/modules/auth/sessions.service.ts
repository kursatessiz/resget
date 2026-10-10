import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './tenant-context';

/** How long a refresh token lives; a session idle longer than this cannot be refreshed any more. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/**
 * The refresh token one generation behind is still honoured this long after it rotated: two tabs (or the
 * middleware and a request in flight) refreshing with the same cookie at the same moment are not a theft.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;
/** Sessions idle a day longer than a refresh token lives are removed when a new one starts. */
const SESSION_RETENTION_MS = (REFRESH_TOKEN_TTL_SECONDS + 24 * 60 * 60) * 1000;
const USER_AGENT_MAX = 255;

const authUserSelect = { id: true, phone: true, fullName: true, isSuperAdmin: true } as const;

/** What a refresh may sign: the session's generation, or nothing when the session is over. */
export type RotateOutcome = { ok: true; generation: number } | { ok: false };

/**
 * Server-side sessions (docs/GUVENLIK.md "Oturumlar"). Every sign-in, handoff
 * and refresh of a pre-session token starts one; both tokens carry its id.
 * A refresh rotates the session to the next generation; a refresh token
 * older than the previous generation means a copy is in someone else's hands,
 * so the whole session ends. Signing out or deleting the account ends it too,
 * and JwtStrategy refuses access tokens of an ended session on the next request.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async start(
    userId: string,
    userAgent?: string | null,
    now: Date = new Date(),
  ): Promise<{ id: string; generation: number }> {
    await this.prisma.authSession.deleteMany({
      where: { lastUsedAt: { lt: new Date(now.getTime() - SESSION_RETENTION_MS) } },
    });
    return this.prisma.authSession.create({
      data: {
        userId,
        userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
        createdAt: now,
        lastUsedAt: now,
      },
      select: { id: true, generation: true },
    });
  }

  /**
   * Spends the refresh token of `generation`. The current generation rotates once (a parallel caller that
   * lost the race lands in the grace branch); the one before is honoured within the grace window; anything
   * older ends the session.
   */
  async rotate(sessionId: string, userId: string, generation: number, now: Date = new Date()): Promise<RotateOutcome> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.prisma.authSession.findUnique({
        where: { id: sessionId },
        select: { userId: true, generation: true, rotatedAt: true, revokedAt: true },
      });
      if (!session || session.userId !== userId || session.revokedAt) return { ok: false };
      if (generation === session.generation) {
        const claimed = await this.prisma.authSession.updateMany({
          where: { id: sessionId, generation, revokedAt: null },
          data: { generation: { increment: 1 }, rotatedAt: now, lastUsedAt: now },
        });
        if (claimed.count === 1) return { ok: true, generation: generation + 1 };
        continue;
      }
      const withinGrace =
        session.rotatedAt !== null && now.getTime() - session.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
      if (generation === session.generation - 1 && withinGrace) return { ok: true, generation: session.generation };
      break;
    }
    await this.revoke(sessionId, now);
    return { ok: false };
  }

  /** The signed-in person of an access token, or null when the account is deleted or the session ended. */
  async userFor(userId: string, sessionId: string | undefined): Promise<AuthUser | null> {
    // Tokens issued before sessions existed carry no session; they lapse on their own within minutes.
    if (!sessionId) {
      return this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: authUserSelect });
    }
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null, user: { deletedAt: null } },
      select: { user: { select: authUserSelect } },
    });
    return session?.user ?? null;
  }

  async revoke(sessionId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
  }

  /** Ends one session of this user; someone else's session id does nothing. */
  async revokeOwn(userId: string, sessionId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeAll(userId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  }
}
