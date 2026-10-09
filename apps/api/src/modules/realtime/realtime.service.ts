import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import type Redis from 'ioredis';
import { REALTIME_HEARTBEAT_SECONDS, REALTIME_RETRY_MILLIS } from '@resget/shared';
import type { RealtimeEvent } from '@resget/shared';
import { RedisService } from '../redis/redis.service';

export interface RealtimeEnvelope {
  id: number;
  topic: string;
  at: string;
  event: RealtimeEvent;
}

export interface TopicEvent {
  topic: string;
  event: RealtimeEvent;
}

/** Everything the restaurant's dispatch and orders screens watch. */
export const dispatchTopic = (restaurantId: string): string => `restaurant:${restaurantId}:dispatch`;
/** The courier's own trips. */
export const courierTopic = (membershipId: string): string => `courier:${membershipId}`;
/** One customer's order. */
export const orderTopic = (orderId: string): string => `order:${orderId}`;

const REDIS_CHANNEL = 'resget:realtime';
const REPLAY_LIMIT = 200;
const REPLAY_WINDOW_MS = 10 * 60 * 1000;

interface RedisMessage {
  instanceId: string;
  envelope: RealtimeEnvelope;
}

/**
 * Server-sent events behind one small service (docs/SIPARIS_VE_SEVK.md).
 * Events are delivered in process and, when Redis is configured, fanned out
 * to every API instance through one pub/sub channel. Each topic keeps a
 * short replay buffer so a client that reconnects with Last-Event-ID gets
 * what it missed; every event carries the full entity, so even a client
 * that missed more than the buffer is correct after the next event or a
 * snapshot fetch.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<string, RealtimeEnvelope[]>();
  private readonly instanceId = randomUUID();
  private lastId = 0;
  private subscriber: Redis | null = null;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly redis: RedisService) {
    this.emitter.setMaxListeners(0);
  }

  async onModuleInit(): Promise<void> {
    // One topic per order: without this the buffers of finished orders would stay in memory until a restart.
    this.sweeper = setInterval(() => this.sweep(), REPLAY_WINDOW_MS);
    this.sweeper.unref();
    const client = this.redis.getClient();
    if (!client) return;
    try {
      this.subscriber = client.duplicate();
      this.subscriber.on('error', (err: Error) => this.logger.warn(`Realtime subscriber error: ${err.message}`));
      await this.subscriber.subscribe(REDIS_CHANNEL);
      this.subscriber.on('message', (_channel: string, raw: string) => this.onRemote(raw));
    } catch (err) {
      this.logger.warn(`Realtime fan-out disabled, Redis unavailable: ${(err as Error).message}`);
      this.subscriber = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await this.subscriber?.quit().catch(() => undefined);
  }

  publish(topic: string, event: RealtimeEvent): void {
    this.publishMany([{ topic, event }]);
  }

  publishMany(entries: readonly TopicEvent[]): void {
    const client = this.redis.getClient();
    for (const { topic, event } of entries) {
      const envelope = this.deliver(topic, event);
      if (!client) continue;
      const message: RedisMessage = { instanceId: this.instanceId, envelope };
      void client.publish(REDIS_CHANNEL, JSON.stringify(message)).catch((err: Error) => {
        this.logger.warn(`Realtime publish to Redis failed: ${err.message}`);
      });
    }
  }

  /** Number of live listeners of a topic on this instance (for tests and health). */
  listenerCount(topic: string): number {
    return this.emitter.listenerCount(topic);
  }

  /**
   * SSE stream of a topic: optional snapshot events first, then the replay
   * of what a reconnecting client missed, then live events, with a
   * heartbeat so proxies keep the connection open.
   */
  stream(
    topic: string,
    lastEventId?: string | null,
    initial: readonly RealtimeEvent[] = [],
    filter: (event: RealtimeEvent) => boolean = () => true,
    /** Shapes each event for this listener (e.g. masks customer phones for a role without contact access). */
    view: (event: RealtimeEvent) => RealtimeEvent = (event) => event,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const send = (envelope: RealtimeEnvelope) =>
        filter(envelope.event) &&
        subscriber.next({
          id: String(envelope.id),
          type: envelope.event.type,
          data: view(envelope.event),
          retry: REALTIME_RETRY_MILLIS,
        });
      for (const event of initial) {
        subscriber.next({ id: String(this.lastId), type: event.type, data: event, retry: REALTIME_RETRY_MILLIS });
      }
      const since = Number(lastEventId);
      if (Number.isFinite(since) && since > 0) {
        for (const envelope of this.buffers.get(topic) ?? []) if (envelope.id > since) send(envelope);
      }
      const listener = (envelope: RealtimeEnvelope) => send(envelope);
      this.emitter.on(topic, listener);
      const heartbeat = setInterval(
        () => subscriber.next({ type: 'heartbeat', data: { at: new Date().toISOString() } }),
        REALTIME_HEARTBEAT_SECONDS * 1000,
      );
      return () => {
        clearInterval(heartbeat);
        this.emitter.off(topic, listener);
      };
    });
  }

  private deliver(topic: string, event: RealtimeEvent): RealtimeEnvelope {
    const envelope: RealtimeEnvelope = { id: this.nextId(), topic, at: new Date().toISOString(), event };
    this.remember(envelope);
    this.emitter.emit(topic, envelope);
    return envelope;
  }

  private onRemote(raw: string): void {
    let message: RedisMessage;
    try {
      message = JSON.parse(raw) as RedisMessage;
    } catch {
      return;
    }
    if (!message || message.instanceId === this.instanceId || !message.envelope) return;
    const envelope = message.envelope;
    if (envelope.id > this.lastId) this.lastId = envelope.id;
    this.remember(envelope);
    this.emitter.emit(envelope.topic, envelope);
  }

  /** Drops the replay buffers whose newest event is older than the replay window; returns how many went. */
  sweep(now: number = Date.now()): number {
    const cutoff = now - REPLAY_WINDOW_MS;
    let dropped = 0;
    for (const [topic, buffer] of this.buffers) {
      const newest = buffer[buffer.length - 1];
      if (!newest || newest.id <= cutoff) {
        this.buffers.delete(topic);
        dropped += 1;
      }
    }
    return dropped;
  }

  /** Number of topics holding a replay buffer (for tests and health). */
  bufferedTopicCount(): number {
    return this.buffers.size;
  }

  private remember(envelope: RealtimeEnvelope): void {
    const cutoff = Date.now() - REPLAY_WINDOW_MS;
    const buffer = (this.buffers.get(envelope.topic) ?? []).filter((e) => e.id > cutoff);
    buffer.push(envelope);
    if (buffer.length > REPLAY_LIMIT) buffer.splice(0, buffer.length - REPLAY_LIMIT);
    this.buffers.set(envelope.topic, buffer);
  }

  /** Millisecond timestamps, strictly increasing even within one millisecond. */
  private nextId(): number {
    const now = Date.now();
    this.lastId = now > this.lastId ? now : this.lastId + 1;
    return this.lastId;
  }
}
