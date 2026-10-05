import { firstValueFrom, take, toArray } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import type { OrderTrackingDTO, RealtimeEvent } from '@resget/shared';
import { RealtimeService, orderTopic } from './realtime.service';
import type { RedisService } from '../redis/redis.service';

const noRedis = { getClient: () => null, isConfigured: false } as unknown as RedisService;

function tracking(status: string): RealtimeEvent {
  const dto: OrderTrackingDTO = {
    orderId: 'o1',
    shortCode: 'ABC123',
    status: status as OrderTrackingDTO['status'],
    fulfillment: 'DELIVERY',
    restaurant: { name: 'Demo', logoUrl: null, themePrimary: '#0092CD', phone: null },
    items: [],
    placedAt: new Date().toISOString(),
    scheduledFor: null,
    promisedReadyAt: null,
    estimatedDeliveryAt: null,
    completedAt: null,
    history: [],
    courier: null,
    destination: null,
    rating: null,
    canRate: false,
    reviewUrl: null,
    nps: null,
    canAnswerNps: false,
    claim: null,
    canClaim: false,
  };
  return { type: 'tracking.updated', tracking: dto };
}

const statusOf = (event: MessageEvent): string => (event.data as { tracking: { status: string } }).tracking.status;

describe('RealtimeService', () => {
  it('delivers live events to subscribers of the topic only', async () => {
    const service = new RealtimeService(noRedis);
    const received = firstValueFrom(service.stream(orderTopic('o1')).pipe(take(1)));
    service.publish(orderTopic('other'), tracking('ACCEPTED'));
    service.publish(orderTopic('o1'), tracking('PLACED'));
    const event = await received;
    expect(event.type).toBe('tracking.updated');
    expect(statusOf(event)).toBe('PLACED');
  });

  it('sends snapshots first, then replays what a reconnecting client missed', async () => {
    const service = new RealtimeService(noRedis);
    const topic = orderTopic('o2');
    service.publish(topic, tracking('PLACED'));
    const probe = firstValueFrom(service.stream(topic).pipe(take(1)));
    service.publish(topic, tracking('ACCEPTED'));
    const lastSeen = (await probe).id!;
    service.publish(topic, tracking('PREPARING'));
    service.publish(topic, tracking('READY'));
    const replay = await firstValueFrom(
      service.stream(topic, lastSeen, [tracking('SNAPSHOT')]).pipe(take(3), toArray()),
    );
    expect(replay.map(statusOf)).toEqual(['SNAPSHOT', 'PREPARING', 'READY']);
    expect(Number(replay[2].id)).toBeGreaterThan(Number(replay[1].id));
    expect(Number(replay[1].id)).toBeGreaterThan(Number(lastSeen));
  });

  it('removes the listener when the client disconnects', () => {
    const service = new RealtimeService(noRedis);
    const topic = orderTopic('o3');
    const subscription = service.stream(topic).subscribe();
    expect(service.listenerCount(topic)).toBe(1);
    subscription.unsubscribe();
    expect(service.listenerCount(topic)).toBe(0);
  });
});
