import { Injectable } from '@nestjs/common';
import type { ExecutionContext, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { REALTIME_REAUTH_SECONDS } from '@resget/shared';
import { ApiKeysService } from './api-keys.service';
import { SessionsService } from './sessions.service';
import { RestaurantTenantGuard } from './guards/restaurant-tenant.guard';
import { PermissionGuard } from './guards/permission.guard';
import type { AuthenticatedRequest } from './tenant-context';

/** setTimeout cannot wait longer than this; an expiry further away is simply never reached by a stream. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Keeps an open event stream within the rights it was opened with
 * (docs/SIPARIS_VE_SEVK.md, "Canlı akış yetkisi"). The guards run once when the
 * stream opens; this ends the stream when the access token expires and, on
 * an interval, runs the same checks again: the session or API key, the
 * restaurant and membership (RestaurantTenantGuard), then the handler's
 * permission, plan and module (PermissionGuard). A failed check ends the
 * stream; the client reconnects and meets the guards again. A passed check
 * refreshes the tenant context in place, so a view built on it (contact
 * masking) follows the current permissions.
 */
@Injectable()
export class StreamAccessService {
  readonly recheckMs: number;

  constructor(
    config: ConfigService,
    private readonly sessions: SessionsService,
    private readonly apiKeys: ApiKeysService,
    private readonly tenantGuard: RestaurantTenantGuard,
    private readonly permissionGuard: PermissionGuard,
  ) {
    this.recheckMs = (config.get<number>('REALTIME_REAUTH_SECONDS') ?? REALTIME_REAUTH_SECONDS) * 1000;
  }

  guard(context: ExecutionContext, source: Observable<MessageEvent>): Observable<MessageEvent> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return new Observable<MessageEvent>((subscriber) => {
      // A plain observer, not the subscriber itself: RxJS would otherwise share one subscription for both.
      const inner = source.subscribe({
        next: (event) => subscriber.next(event),
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      // Completing ends the HTTP response; the teardown below then stops the timers and the source.
      const end = () => subscriber.complete();
      const expiresAt = request.user?.accessExpiresAt;
      const expiry =
        !request.apiKey && expiresAt !== undefined
          ? setTimeout(end, Math.min(Math.max(0, expiresAt * 1000 - Date.now()), MAX_TIMER_MS))
          : null;
      let checking = false;
      const recheck = setInterval(() => {
        if (checking || subscriber.closed) return;
        checking = true;
        void this.stillAllowed(context, request)
          .then((allowed) => {
            if (!allowed) end();
          })
          .finally(() => {
            checking = false;
          });
      }, this.recheckMs);
      return () => {
        clearInterval(recheck);
        if (expiry) clearTimeout(expiry);
        inner.unsubscribe();
      };
    });
  }

  /** The checks of the guards again, against the current rows; false on any refusal or error. */
  private async stillAllowed(context: ExecutionContext, request: AuthenticatedRequest): Promise<boolean> {
    const tenant = request.tenant;
    const user = request.user;
    if (!tenant || !user) return false;
    try {
      if (request.apiKey) {
        const key = await this.apiKeys.current(request.apiKey.id);
        if (!key) return false;
        request.apiKey = key;
        request.user = key.user;
      } else {
        const current = await this.sessions.userFor(user.id, user.sessionId);
        if (!current) return false;
        request.user = { ...current, sessionId: user.sessionId, accessExpiresAt: user.accessExpiresAt };
      }
      if (!(await this.tenantGuard.canActivate(context))) return false;
      if (!(await this.permissionGuard.canActivate(context))) return false;
      // The handler holds the first context object; it sees the current rights from here on.
      Object.assign(tenant, request.tenant);
      request.tenant = tenant;
      return true;
    } catch {
      return false;
    }
  }
}
