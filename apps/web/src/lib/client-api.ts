'use client';

import { useEffect, useRef, useState } from 'react';
import { ERROR_CODE_HEADER } from '@resget/shared';
import type { RealtimeEvent } from '@resget/shared';

/** An API error as the client sees it: the machine code decides the message (`errors.<code>`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Calls the API through the BFF (session cookie becomes the bearer header there). */
export async function bffJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(`/api/bff/${path.replace(/^\//, '')}`, { ...init, headers, cache: 'no-store' });
  if (!res.ok) {
    const code = res.headers.get(ERROR_CODE_HEADER) ?? (res.status === 401 ? 'UNAUTHORIZED' : 'ERROR');
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribes to one of the API's event streams through the BFF. The browser
 * reconnects by itself with Last-Event-ID; every event carries the full
 * entity, so the handler can simply replace what it has.
 */
export function useRealtime(path: string | null, onEvent: (event: RealtimeEvent) => void): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!path || typeof EventSource === 'undefined') return undefined;
    const source = new EventSource(`/api/bff/${path.replace(/^\//, '')}`);
    const types: RealtimeEvent['type'][] = ['order.updated', 'trip.updated', 'courier.location', 'tracking.updated'];
    const listener = (message: MessageEvent<string>) => {
      try {
        handler.current(JSON.parse(message.data) as RealtimeEvent);
        setStatus('live');
      } catch {
        // A malformed frame is ignored; the next event carries the full state again.
      }
    };
    for (const type of types) source.addEventListener(type, listener as EventListener);
    source.addEventListener('heartbeat', () => setStatus('live'));
    source.onopen = () => setStatus('live');
    source.onerror = () => setStatus('reconnecting');
    return () => source.close();
  }, [path]);
  return status;
}
