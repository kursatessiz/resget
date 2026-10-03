import { LOCATION_BATCH_MAX, LOCATION_QUEUE_MAX, LocationQueue } from './location-batch';

const at = (ms: number, extra: Partial<{ accuracyM: number }> = {}) => ({
  lat: 41,
  lng: 29,
  recordedAt: new Date(ms).toISOString(),
  ...extra,
});

describe('LocationQueue', () => {
  it('thins bursts, drops poor fixes and keeps order', () => {
    const queue = new LocationQueue();
    expect(queue.push(at(0))).toBe(true);
    expect(queue.push(at(1000))).toBe(false);
    expect(queue.push(at(3000))).toBe(true);
    expect(queue.push(at(7000, { accuracyM: 500 }))).toBe(false);
    expect(queue.push({ lat: 1, lng: 1, recordedAt: 'nonsense' })).toBe(false);
    expect(queue.size).toBe(2);
    expect(queue.nextBatch().map((p) => p.recordedAt)).toEqual([at(0).recordedAt, at(3000).recordedAt]);
  });

  it('hands out API-sized batches and forgets them only on ack', () => {
    const queue = new LocationQueue();
    for (let i = 0; i < 70; i += 1) queue.push(at(i * 4000));
    expect(queue.nextBatch()).toHaveLength(LOCATION_BATCH_MAX);
    expect(queue.size).toBe(70);
    queue.ack(LOCATION_BATCH_MAX);
    expect(queue.size).toBe(10);
  });

  it('caps what waits while offline', () => {
    const queue = new LocationQueue();
    for (let i = 0; i < LOCATION_QUEUE_MAX + 50; i += 1) queue.push(at(i * 4000));
    expect(queue.size).toBe(LOCATION_QUEUE_MAX);
    // The oldest points are the ones dropped.
    expect(queue.nextBatch()[0].recordedAt).toBe(at(50 * 4000).recordedAt);
  });
});
