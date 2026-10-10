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

/** Multipart call through the BFF (file uploads); the browser sets the boundary, so no content type is forced. */
export async function bffUpload<T>(path: string, form: FormData, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const res = await fetch(`/api/bff/${path.replace(/^\//, '')}`, { method, body: form, cache: 'no-store' });
  if (!res.ok) {
    const code = res.headers.get(ERROR_CODE_HEADER) ?? (res.status === 401 ? 'UNAUTHORIZED' : 'ERROR');
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting';

/** First wait before a stream the browser gave up on is opened again; doubles up to the maximum. */
const REOPEN_FIRST_MS = 2_000;
const REOPEN_MAX_MS = 60_000;

/**
 * Subscribes to one of the API's event streams through the BFF. The browser
 * reconnects by itself with Last-Event-ID; every event carries the full
 * entity, so the handler can simply replace what it has. The API closes a
 * stream when the access token it was opened with expires or the
 * subscriber's rights change (docs/SIPARIS_VE_SEVK.md); the reconnect then
 * goes through the middleware, which refreshes the session first. When the
 * browser gives up (an error answer instead of a stream), the stream is
 * opened again after a growing pause.
 */
export function useRealtime(path: string | null, onEvent: (event: RealtimeEvent) => void): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!path || typeof EventSource === 'undefined') return undefined;
    const url = `/api/bff/${path.replace(/^\//, '')}`;
    const types: RealtimeEvent['type'][] = ['order.updated', 'trip.updated', 'courier.location', 'tracking.updated'];
    const listener = (message: MessageEvent<string>) => {
      try {
        handler.current(JSON.parse(message.data) as RealtimeEvent);
        setStatus('live');
      } catch {
        // A malformed frame is ignored; the next event carries the full state again.
      }
    };
    let source: EventSource | null = null;
    let reopen: ReturnType<typeof setTimeout> | null = null;
    let delay = REOPEN_FIRST_MS;
    const connect = () => {
      const current = new EventSource(url);
      source = current;
      for (const type of types) current.addEventListener(type, listener as EventListener);
      current.addEventListener('heartbeat', () => setStatus('live'));
      current.onopen = () => {
        delay = REOPEN_FIRST_MS;
        setStatus('live');
      };
      current.onerror = () => {
        setStatus('reconnecting');
        if (current.readyState !== EventSource.CLOSED) return;
        reopen = setTimeout(connect, delay);
        delay = Math.min(delay * 2, REOPEN_MAX_MS);
      };
    };
    connect();
    return () => {
      if (reopen) clearTimeout(reopen);
      source?.close();
    };
  }, [path]);
  return status;
}
