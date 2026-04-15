import { describe, it, expect, vi } from 'vitest';
import { ThemeParks } from '../../src/client';

function mockFetch(body: unknown) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('ThemeParks client', () => {
  it('applies default baseUrl', async () => {
    const fetchFn = mockFetch({ destinations: [] });
    const tp = new ThemeParks({ fetch: fetchFn });
    await tp.raw.getDestinations();
    const url = fetchFn.mock.calls[0]![0];
    expect(url).toBe('https://api.themeparks.wiki/v1/destinations');
  });

  it('applies default user agent', async () => {
    const fetchFn = mockFetch({ destinations: [] });
    const tp = new ThemeParks({ fetch: fetchFn });
    await tp.raw.getDestinations();
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(
      /^themeparks-sdk-js\/\d/,
    );
  });

  it('caches /destinations by default for 1 hour', async () => {
    const fetchFn = mockFetch({ destinations: [] });
    const tp = new ThemeParks({ fetch: fetchFn });
    await tp.raw.getDestinations();
    await tp.raw.getDestinations();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('bypasses cache for /live', async () => {
    const fetchFn = mockFetch({ liveData: [] });
    const tp = new ThemeParks({ fetch: fetchFn });
    await tp.raw.getEntityLive('abc');
    await tp.raw.getEntityLive('abc');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('cache: false disables caching entirely', async () => {
    const fetchFn = mockFetch({ destinations: [] });
    const tp = new ThemeParks({ fetch: fetchFn, cache: false });
    await tp.raw.getDestinations();
    await tp.raw.getDestinations();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('accepts a custom cache adapter', async () => {
    const store = new Map<string, { v: unknown; exp: number }>();
    const adapter = {
      get: (k: string) => {
        const e = store.get(k);
        if (!e || e.exp < Date.now()) return undefined;
        return e.v;
      },
      set: (k: string, v: unknown, ttlMs: number) => {
        if (ttlMs > 0) store.set(k, { v, exp: Date.now() + ttlMs });
      },
      delete: (k: string) => void store.delete(k),
    };
    const fetchFn = mockFetch({ destinations: [] });
    const tp = new ThemeParks({ fetch: fetchFn, cache: adapter });
    await tp.raw.getDestinations();
    await tp.raw.getDestinations();
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(store.size).toBe(1);
  });
});
