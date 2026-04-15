import { describe, it, expect, vi } from 'vitest';
import { Transport } from '../../src/transport';
import { ApiError, NetworkError, RateLimitError, TimeoutError } from '../../src/errors';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('Transport', () => {
  it('performs GET and parses JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const t = new Transport({
      baseUrl: 'https://api.example/v1',
      userAgent: 'test/1',
      timeoutMs: 1000,
      retry: { max: 0, on429: true },
      fetch: fetchFn,
    });
    const res = await t.get('/destinations');
    expect(res).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.example/v1/destinations');
    expect((init as RequestInit).headers).toMatchObject({
      accept: 'application/json',
      'user-agent': 'test/1',
    });
  });

  it('throws ApiError on 4xx with body', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'nope' }, { status: 404, statusText: 'Not Found' }));
    const t = new Transport({
      baseUrl: 'https://api.example/v1',
      userAgent: 'test/1',
      timeoutMs: 1000,
      retry: { max: 0, on429: true },
      fetch: fetchFn,
    });
    await expect(t.get('/entity/missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      body: { error: 'nope' },
      url: 'https://api.example/v1/entity/missing',
    });
    // Silence unused-import lint for the types referenced in assertions.
    expect(ApiError).toBeDefined();
    expect(NetworkError).toBeDefined();
    expect(RateLimitError).toBeDefined();
    expect(TimeoutError).toBeDefined();
  });

  it('throws RateLimitError on 429 with retryAfterMs when exhausted', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('', {
        status: 429,
        headers: { 'retry-after': '2' },
      }),
    );
    const t = new Transport({
      baseUrl: 'https://api.example/v1',
      userAgent: 'test/1',
      timeoutMs: 1000,
      retry: { max: 0, on429: true },
      fetch: fetchFn,
    });
    await expect(t.get('/x')).rejects.toMatchObject({
      name: 'RateLimitError',
      status: 429,
      retryAfterMs: 2000,
    });
  });

  it('retries 429 once when retry.on429 is true and succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const t = new Transport({
      baseUrl: 'https://api.example/v1',
      userAgent: 'test/1',
      timeoutMs: 1000,
      retry: { max: 3, on429: true },
      fetch: fetchFn,
      sleep: () => Promise.resolve(),
    });
    const res = await t.get('/x');
    expect(res).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx up to retry.max times', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const t = new Transport({
      baseUrl: 'https://api.example/v1',
      userAgent: 'test/1',
      timeoutMs: 1000,
      retry: { max: 3, on429: true },
      fetch: fetchFn,
      sleep: () => Promise.resolve(),
    });
    await expect(t.get('/x')).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('throws NetworkError when fetch itself throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const t = new Transport({
      baseUrl: 'https://api.example/v1',
      userAgent: 'test/1',
      timeoutMs: 1000,
      retry: { max: 0, on429: true },
      fetch: fetchFn,
      sleep: () => Promise.resolve(),
    });
    await expect(t.get('/x')).rejects.toMatchObject({ name: 'NetworkError' });
  });

  it('throws TimeoutError when the request exceeds timeoutMs', async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const t = new Transport({
      baseUrl: 'https://api.example/v1',
      userAgent: 'test/1',
      timeoutMs: 10,
      retry: { max: 0, on429: true },
      fetch: fetchFn,
      sleep: () => Promise.resolve(),
    });
    await expect(t.get('/x')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
