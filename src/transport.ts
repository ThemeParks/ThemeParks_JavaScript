import { ApiError, NetworkError, RateLimitError, TimeoutError } from './errors';

/**
 * Minimal fetch-like function signature covering only what the SDK uses.
 *
 * Defined locally so consumers without the DOM lib (e.g. Node-only projects
 * with `lib: ["ES2022"]` and older `@types/node`) don't pull `globalThis.fetch`,
 * `Response`, or `RequestInit` into their emitted `.d.ts` when they import
 * this SDK's types.
 *
 * At runtime the SDK still calls `globalThis.fetch` by default; this type is
 * purely a structural subset so any spec-compatible `fetch` implementation
 * (node's built-in, undici, whatwg-fetch, a user mock, etc.) satisfies it.
 */
export type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    body?: string;
  },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Retry configuration for the {@link Transport}.
 *
 * Semantics note: `max` is the number of **retries beyond the initial
 * attempt**, not the total attempt count. A setting of `max: 3` means the
 * transport will make up to 4 total calls (1 initial + 3 retries) before
 * giving up. A setting of `max: 0` disables retries entirely and the
 * transport will perform exactly one call.
 */
export interface RetryConfig {
  /**
   * Maximum number of retries beyond the initial attempt.
   *
   * `0` disables retries; `3` allows 1 initial + 3 retries = 4 total calls.
   */
  max: number;
  /** If true, HTTP 429 responses are retried (honouring `Retry-After`). */
  on429: boolean;
}

export interface TransportOptions {
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  /**
   * Retry policy. See {@link RetryConfig} — `max` counts retries beyond the
   * initial attempt, so `{ max: 3 }` permits up to 4 total calls.
   */
  retry: RetryConfig;
  fetch: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

function parseRetryAfter(header: string | null): number | null {
  if (header === null || header === '') return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt)) return Math.max(0, asInt * 1000);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function backoff(attempt: number): number {
  const base = 250 * 2 ** attempt;
  const jitter = Math.random() * base * 0.25;
  return Math.min(base + jitter, 5000);
}

/**
 * Format a body excerpt for embedding in an error message.
 *
 * Mirrors the Python sibling SDK's rule:
 *   - if `body` is an object with an `error` key, use that value,
 *   - otherwise stringify the body,
 *   - then truncate to 200 characters.
 *
 * The full body remains available on the error's `.body` field.
 */
function formatBodyExcerpt(body: unknown): string | undefined {
  if (body === null || body === undefined) return undefined;
  let text: string;
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    (body as { error: unknown }).error !== undefined &&
    (body as { error: unknown }).error !== null
  ) {
    const err = (body as { error: unknown }).error;
    text = typeof err === 'string' ? err : JSON.stringify(err);
  } else if (typeof body === 'string') {
    text = body;
  } else {
    try {
      text = JSON.stringify(body);
    } catch {
      text = String(body);
    }
  }
  if (text === undefined || text === '') return undefined;
  return text.length > 200 ? text.slice(0, 200) : text;
}

export class Transport {
  constructor(private readonly opts: TransportOptions) {}

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async request<T>(method: string, path: string): Promise<T> {
    const url = this.opts.baseUrl.replace(/\/$/, '') + path;
    const sleep = this.opts.sleep ?? defaultSleep;
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, this.opts.timeoutMs);
      let response: FetchLikeResponse;
      try {
        response = await this.opts.fetch(url, {
          method,
          headers: {
            accept: 'application/json',
            'user-agent': this.opts.userAgent,
          },
          signal: controller.signal,
        });
      } catch (cause) {
        clearTimeout(timer);
        if ((cause as { name?: string }).name === 'AbortError') {
          throw new TimeoutError(
            `request to ${url} timed out after ${String(this.opts.timeoutMs)}ms`,
          );
        }
        if (attempt < this.opts.retry.max) {
          await sleep(backoff(attempt));
          attempt++;
          continue;
        }
        throw new NetworkError(`network error calling ${url}`, { cause });
      }
      clearTimeout(timer);

      if (response.ok) {
        return (await response.json()) as T;
      }

      const body = await this.safeParseBody(response);
      const bodyExcerpt = formatBodyExcerpt(body);

      if (response.status === 429 && this.opts.retry.on429 && attempt < this.opts.retry.max) {
        const retryAfterMs =
          parseRetryAfter(response.headers.get('retry-after')) ?? backoff(attempt);
        await sleep(retryAfterMs);
        attempt++;
        continue;
      }
      if (response.status === 429) {
        throw new RateLimitError(`429 Too Many Requests`, {
          status: 429,
          body,
          url,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          ...(bodyExcerpt !== undefined ? { bodyExcerpt } : {}),
        });
      }
      if (response.status >= 500 && attempt < this.opts.retry.max) {
        await sleep(backoff(attempt));
        attempt++;
        continue;
      }

      throw new ApiError(`${String(response.status)} ${response.statusText}`, {
        status: response.status,
        body,
        url,
        ...(bodyExcerpt !== undefined ? { bodyExcerpt } : {}),
      });
    }
  }

  private async safeParseBody(response: FetchLikeResponse): Promise<unknown> {
    const ct = response.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      try {
        return await response.text();
      } catch {
        return null;
      }
    }
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
