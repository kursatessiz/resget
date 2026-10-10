import { BoundedTtlCache } from './host-cache';

describe('BoundedTtlCache', () => {
  it('stores null results and expires entries after the time to live', () => {
    const cache = new BoundedTtlCache<string | null>(10, 1000);
    cache.set('a', null, 0);
    expect(cache.get('a', 999)).toEqual({ value: null });
    expect(cache.get('a', 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts expired entries before live ones, then the least recently used', () => {
    const cache = new BoundedTtlCache<number>(3, 1000);
    cache.set('old', 1, 0);
    cache.set('b', 2, 900);
    cache.set('c', 3, 950);
    cache.set('d', 4, 1100);
    expect(cache.size).toBe(3);
    expect(cache.get('old', 1100)).toBeUndefined();

    cache.get('b', 1100);
    cache.set('e', 5, 1100);
    expect(cache.size).toBe(3);
    expect(cache.get('c', 1100)).toBeUndefined();
    expect(cache.get('b', 1100)).toEqual({ value: 2 });
  });

  it('never holds more than the limit', () => {
    const cache = new BoundedTtlCache<number>(5, 60_000);
    for (let i = 0; i < 1000; i += 1) cache.set(`k${i}`, i, 0);
    expect(cache.size).toBe(5);
  });
});
