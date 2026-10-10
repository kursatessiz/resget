import { ERROR_CODE_HEADER } from '@resget/shared';
import type { TokenPairDTO } from '@resget/shared';

/** What a refresh attempt ended in: new tokens, a refusal (sign out), or no answer (keep the session). */
type RefreshOutcome = 'renewed' | 'refused' | 'unavailable';

/** A refused request with the machine code the API sent (docs/API_ERISIMI.md) so the screen can translate it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export interface TokenStore {
  read(): Promise<TokenPairDTO | null>;
  write(tokens: TokenPairDTO | null): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  /** Called when the refresh token is also refused: the app returns to sign-in. */
  onSignedOut?: () => void;
}

/**
 * The app's one HTTP client: bearer from the secure store, one transparent
 * refresh on 401, restaurant scope by header. Pure enough to test with a
 * fake fetch; the platform-specific store is injected.
 */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private refreshing: Promise<RefreshOutcome> | null = null;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(
    path: string,
    init: { method?: string; body?: unknown; restaurantId?: string; auth?: boolean } = {},
  ): Promise<T> {
    const auth = init.auth ?? true;
    const send = async (): Promise<Response> => {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (init.body !== undefined) headers['content-type'] = 'application/json';
      if (init.restaurantId) headers['x-restaurant-id'] = init.restaurantId;
      if (auth) {
        const tokens = await this.options.tokens.read();
        if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
      }
      return this.fetchImpl(`${this.options.baseUrl}/${path.replace(/^\//, '')}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    };
    let response = await send();
    let refreshed: RefreshOutcome | null = null;
    if (response.status === 401 && auth) {
      refreshed = await this.refresh();
      if (refreshed === 'renewed') response = await send();
    }
    if (!response.ok) {
      const code = response.headers.get(ERROR_CODE_HEADER) ?? (response.status === 401 ? 'UNAUTHORIZED' : 'ERROR');
      // Only a refresh the API refused ends the session; no network or a server error keeps the tokens.
      if (response.status === 401 && auth && refreshed !== 'unavailable') {
        await this.options.tokens.write(null);
        this.options.onSignedOut?.();
      }
      throw new ApiError(response.status, code);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /**
   * Signs out: the API ends this session (docs/GUVENLIK.md "Oturumlar") with the refresh token, which
   * names it even after the access token has lapsed, then the stored tokens are dropped. No answer from
   * the API still signs the device out.
   */
  async logout(): Promise<void> {
    const tokens = await this.options.tokens.read();
    if (tokens) {
      await this.fetchImpl(`${this.options.baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }).catch(() => null);
    }
    await this.options.tokens.write(null);
  }

  /** One refresh at a time; concurrent 401s wait for the same outcome. */
  private refresh(): Promise<RefreshOutcome> {
    if (!this.refreshing) {
      this.refreshing = (async (): Promise<RefreshOutcome> => {
        const tokens = await this.options.tokens.read();
        if (!tokens) return 'refused';
        const response = await this.fetchImpl(`${this.options.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        }).catch(() => null);
        if (!response || response.status >= 500) return 'unavailable';
        if (!response.ok) return 'refused';
        await this.options.tokens.write((await response.json()) as TokenPairDTO);
        return 'renewed';
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }
}
