import { ERROR_CODE_HEADER } from '@resget/shared';
import type { TokenPairDTO } from '@resget/shared';

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
  private refreshing: Promise<boolean> | null = null;

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
    if (response.status === 401 && auth && (await this.refresh())) response = await send();
    if (!response.ok) {
      const code = response.headers.get(ERROR_CODE_HEADER) ?? (response.status === 401 ? 'UNAUTHORIZED' : 'ERROR');
      if (response.status === 401 && auth) {
        await this.options.tokens.write(null);
        this.options.onSignedOut?.();
      }
      throw new ApiError(response.status, code);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** One refresh at a time; concurrent 401s wait for the same outcome. */
  private refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const tokens = await this.options.tokens.read();
        if (!tokens) return false;
        const response = await this.fetchImpl(`${this.options.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        }).catch(() => null);
        if (!response || !response.ok) return false;
        await this.options.tokens.write((await response.json()) as TokenPairDTO);
        return true;
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }
}
