import { describe, it, expect, vi } from 'vitest';
import { InMemoryLruCache, ttlForPath, type Cache } from '../../src/cache';

describe('ttlForPath', () => {
  it('returns 1h for /destinations', () => {
    expect(ttlForPath('/destinations')).toBe(3_600_000);
  });
  it('returns 1h for /entity/{id}', () => {
    expect(ttlForPath('/entity/abc-123')).toBe(3_600_000);
  });
  it('returns 1h for /entity/{id}/children', () => {
    expect(ttlForPath('/entity/abc-123/children')).toBe(3_600_000);
  });
  it('returns 5m for /entity/{id}/schedule', () => {
    expect(ttlForPath('/entity/abc-123/schedule')).toBe(300_000);
  });
  it('returns 5m for /entity/{id}/schedule/{year}/{month}', () => {
    expect(ttlForPath('/entity/abc-123/schedule/2026/4')).toBe(300_000);
  });
  it('returns 0 (bypass) for /entity/{id}/live', () => {
    expect(ttlForPath('/entity/abc-123/live')).toBe(0);
  });
});

describe('InMemoryLruCache', () => {
  it('get returns undefined on miss', () => {
    const c = new InMemoryLruCache({ maxEntries: 10 });
    expect(c.get('k')).toBeUndefined();
  });

  it('set and get within TTL', () => {
    const c = new InMemoryLruCache({ maxEntries: 10 });
    c.set('k', { hello: 'world' }, 1000);
    expect(c.get('k')).toEqual({ hello: 'world' });
  });

  it('returns undefined after TTL expires', () => {
    vi.useFakeTimers();
    const c = new InMemoryLruCache({ maxEntries: 10 });
    c.set('k', 1, 1000);
    vi.advanceTimersByTime(1001);
    expect(c.get('k')).toBeUndefined();
    vi.useRealTimers();
  });

  it('set with ttlMs = 0 stores nothing', () => {
    const c = new InMemoryLruCache({ maxEntries: 10 });
    c.set('k', 1, 0);
    expect(c.get('k')).toBeUndefined();
  });

  it('evicts least-recently-used when over capacity', () => {
    const c = new InMemoryLruCache({ maxEntries: 2 });
    c.set('a', 1, 10_000);
    c.set('b', 2, 10_000);
    c.get('a'); // a becomes most recent
    c.set('c', 3, 10_000); // should evict b
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });

  it('delete removes a key', () => {
    const c = new InMemoryLruCache({ maxEntries: 10 });
    c.set('k', 1, 1000);
    c.delete('k');
    expect(c.get('k')).toBeUndefined();
  });
});

describe('Cache interface', () => {
  it('accepts a user-supplied adapter', () => {
    const store = new Map<string, unknown>();
    const adapter: Cache = {
      get: (k) => store.get(k),
      set: (k, v) => void store.set(k, v),
      delete: (k) => void store.delete(k),
    };
    adapter.set('x', 1, 1000);
    expect(adapter.get('x')).toBe(1);
  });
});
