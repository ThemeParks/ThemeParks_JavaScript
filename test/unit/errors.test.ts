import { describe, it, expect } from 'vitest';
import {
  ThemeParksError,
  ApiError,
  NetworkError,
  TimeoutError,
  RateLimitError,
} from '../../src/errors';

describe('error hierarchy', () => {
  it('ThemeParksError is an Error subclass', () => {
    const e = new ThemeParksError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ThemeParksError');
    expect(e.message).toBe('boom');
  });

  it('ApiError carries status, body, url', () => {
    const e = new ApiError('404 Not Found', {
      status: 404,
      body: { err: 'x' },
      url: '/entity/z',
    });
    expect(e).toBeInstanceOf(ThemeParksError);
    expect(e.status).toBe(404);
    expect(e.body).toEqual({ err: 'x' });
    expect(e.url).toBe('/entity/z');
    expect(e.name).toBe('ApiError');
  });

  it('RateLimitError extends ApiError and carries retryAfterMs', () => {
    const e = new RateLimitError('rate limited', {
      status: 429,
      body: null,
      url: '/x',
      retryAfterMs: 1500,
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(1500);
    expect(e.name).toBe('RateLimitError');
  });

  it('NetworkError wraps a cause', () => {
    const cause = new Error('econnreset');
    const e = new NetworkError('network failure', { cause });
    expect(e.cause).toBe(cause);
    expect(e.name).toBe('NetworkError');
  });

  it('TimeoutError has a name', () => {
    const e = new TimeoutError('timed out after 10000ms');
    expect(e.name).toBe('TimeoutError');
  });
});

describe('polish additions', () => {
  it('RateLimitError.retryAfterMs defaults to null when omitted', () => {
    const e = new RateLimitError('rate limited', {
      status: 429,
      body: null,
      url: '/x',
    });
    expect(e.retryAfterMs).toBeNull();
  });

  it('ApiError.toString includes status and url', () => {
    const e = new ApiError('404 Not Found', {
      status: 404,
      body: null,
      url: '/entity/z',
    });
    const s = e.toString();
    expect(s).toContain('ApiError');
    expect(s).toContain('404');
    expect(s).toContain('/entity/z');
  });

  it('ApiError message includes truncated body excerpt when provided', () => {
    const longBody = 'x'.repeat(1000);
    const e = new ApiError('Server error', {
      status: 500,
      body: longBody,
      url: '/boom',
      bodyExcerpt: longBody,
    });
    // Full body is preserved
    expect(e.body).toBe(longBody);
    // Message contains an excerpt, but is truncated (not the full 1000 chars)
    expect(e.message).toContain('Server error');
    expect(e.message.length).toBeLessThan(longBody.length);
    expect(e.message).toMatch(/x+/);
  });

  it('ApiError message accepts short body excerpt verbatim', () => {
    const e = new ApiError('Bad Request', {
      status: 400,
      body: { error: 'bad' },
      url: '/x',
      bodyExcerpt: '{"error":"bad"}',
    });
    expect(e.message).toContain('Bad Request');
    expect(e.message).toContain('{"error":"bad"}');
  });
});
