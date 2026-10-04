import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MeDTO, MembershipSummaryDTO, TokenPairDTO } from '@resget/shared';
import { ApiClient } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { readLastRestaurant, secureTokens, writeLastRestaurant } from '@/lib/session';
import { pickMembership } from '@/lib/tabs';

export interface SessionState {
  ready: boolean;
  me: MeDTO | null;
  membership: MembershipSummaryDTO | null;
  api: ApiClient;
  signIn(tokens: TokenPairDTO): Promise<void>;
  signOut(): Promise<void>;
  chooseRestaurant(restaurantId: string): Promise<void>;
  refreshMe(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/** Holds the signed-in person, their memberships and the restaurant the app works in (one app, roles from the membership). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<MeDTO | null>(null);
  const [membership, setMembership] = useState<MembershipSummaryDTO | null>(null);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_BASE_URL,
        tokens: secureTokens,
        onSignedOut: () => {
          setMe(null);
          setMembership(null);
        },
      }),
    [],
  );

  const load = useCallback(async () => {
    const tokens = await secureTokens.read();
    if (!tokens) {
      setMe(null);
      setMembership(null);
      return;
    }
    try {
      const profile = await api.request<MeDTO>('auth/me');
      setMe(profile);
      setMembership(pickMembership(profile.memberships, await readLastRestaurant()));
    } catch {
      setMe(null);
      setMembership(null);
    }
  }, [api]);

  useEffect(() => {
    load().finally(() => setReady(true));
  }, [load]);

  const value = useMemo<SessionState>(
    () => ({
      ready,
      me,
      membership,
      api,
      async signIn(tokens) {
        await secureTokens.write(tokens);
        await load();
      },
      async signOut() {
        await secureTokens.write(null);
        await writeLastRestaurant(null);
        setMe(null);
        setMembership(null);
      },
      async chooseRestaurant(restaurantId) {
        const next = me?.memberships.find((m) => m.restaurantId === restaurantId && m.status === 'ACTIVE') ?? null;
        setMembership(next);
        await writeLastRestaurant(next?.restaurantId ?? null);
      },
      refreshMe: load,
    }),
    [ready, me, membership, api, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
