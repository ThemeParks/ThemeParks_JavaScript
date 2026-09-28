import { ApiError, NetworkError, RateLimitError, TimeoutError } from './errors';
import {
  Gate,
  isExhausted,
  readRateLimits,
  secondsUntilReset,
  UNKNOWN_RATE_LIMITS,
  type RateLimits,
} from './ratelimit';

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
  /**
   * Wait out a window the server has already said is spent.
   *
   * When a response reports `remaining: 0`, the next request is a guaranteed
   * 429 that also costs a unit of the caller's budget to be refused. Waiting
   * for the reset it advertised is strictly better than sending it. Setting
   * this false turns the client back into a purely reactive one.
   *
   * Defaults to true.
   */
  respectRemaining?: boolean;
  /**
   * Longest `Retry-After` this client will sleep through, in milliseconds.
   * Defaults to {@link DEFAULT_MAX_RETRY_AFTER_MS}.
   *
   * A REST 429 asks for seconds and is worth waiting out. A HISTORY 429 is a
   * different animal: that budget is hourly, so a spent one can ask for most
   * of an hour, and honouring it up to `max` times means a process that sits
   * silent for hours and looks hung. Past this cap we do not sleep at all, and
   * throw `RateLimitError` carrying `retryAfterMs` so the caller can
   * checkpoint and come back.
   */
  maxRetryAfterMs?: number;
}

export interface TransportOptions {
  baseUrl: string;
  userAgent: string;
  /** Sent as the `X-API-Key` header on every request when set. */
  apiKey?: string;
  timeoutMs: number;
  /**
   * Retry policy. See {@link RetryConfig} — `max` counts retries beyond the
   * initial attempt, so `{ max: 3 }` permits up to 4 total calls.
   */
  retry: RetryConfig;
  fetch: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

/** Two minutes: longer than any REST 429 asks for, far short of an hourly budget. */
export const DEFAULT_MAX_RETRY_AFTER_MS = 120_000;

/** Below this, a computed wait is floating-point residue rather than a wait. */
const MIN_SLEEP_MS = 1;

/** Spread applied to a synchronised release, so waiters do not wake as one. */
const SPREAD_MS = 250;

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Milliseconds to wait, or null when the header gives us nothing usable.
 *
 * NULL AND ZERO ARE DIFFERENT ANSWERS, and conflating them turned the client
 * into a hammer. Only `null` reaches the exponential backoff, so a header that
 * parsed to 0 -- `Retry-After: 0`, which RFC 9110 permits, or a negative, or
 * an already-past date -- meant no wait at all. Measured in the Python
 * sibling, which had the same shape: four requests in 3ms against a server
 * that had just said 429, and 204 a second across ten threads.
 *
 * `Number()` was also far too generous for a `delta-seconds = 1*DIGIT` field:
 * it read '   ' as 0 and spun, and '0x10' as 16 and slept 48 seconds.
 */
function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed === '') return null;

  let ms: number;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    const asDate = Date.parse(trimmed);
    if (!Number.isFinite(asDate)) return null;
    ms = asDate - Date.now();
  }
  return ms > 0 ? ms : null;
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
  /** What the server last said about the two budgets. */
  rateLimit: RateLimits = UNKNOWN_RATE_LIMITS;
  /**
   * TypeScript `private`, deliberately NOT an ECMAScript `#` field.
   *
   * client.ts wraps this transport in a Proxy to add caching, and a Proxy
   * forwards methods with `this` bound to the PROXY. A `#` member's brand
   * check then fails with "Receiver must be an instance of class Transport",
   * which crashed every paged history call on the default configuration --
   * `history.days()` threw on page two for anyone who had not passed
   * `cache: false`. Every test passed `cache: false`, so 130 of them missed
   * it. A TS `private` compiles to a plain property and forwards fine.
   */
  private readonly gate = new Gate();

  constructor(private readonly opts: TransportOptions) {}

  /**
   * Wait before sending, if we already know this request would fail.
   *
   * Two reasons, and they are different. The GATE is a 429 the server has
   * already issued to this caller: the wait belongs to them, not to whichever
   * request met it, so it is shared and taken once. The REMAINING check is a
   * window the server told us is spent, where sending is a certain 429 that
   * also spends budget being refused.
   *
   * A remaining we were never told is not a spent one. Anonymous responses
   * carry no figures at all, so an unknown must never hold.
   */
  private async hold(sleep: (ms: number) => Promise<void>, budget: number): Promise<number> {
    // Returns how long it slept, so the caller can keep a running total. The
    // TOTAL is what maxRetryAfterMs bounds, not each leg: the gate wait and
    // the spent-window wait are both self-initiated holds and they stack.
    // Measured before this budget existed: a 429 carrying Retry-After 5 and
    // RateLimit-Reset 60 slept 5 then 55, three times over -- 180 seconds
    // inside one call whose cap was 120. Each leg was under the cap, so the
    // per-leg check never fired and the promise was reachable around.
    let spent = 0;
    // Re-read the gate after each wait. It slept once and returned, so a
    // waiter that woke while someone else's 429 had pushed the gate further
    // out sent anyway: measured waking at 584ms with the gate shut for
    // another two seconds. Bounded by the same budget, so it cannot spin.
    for (;;) {
      const before = this.gate.deadline;
      const gated = Math.min(this.gate.waitMs(), budget - spent);
      if (gated <= MIN_SLEEP_MS) break;
      await sleep(gated);
      spent += gated;
      // Only wait again if someone genuinely pushed the gate further out
      // while we slept. Re-reading unconditionally loops against any clock
      // that does not advance, which is every test harness and, briefly, a
      // suspended host.
      if (this.gate.deadline <= before) break;
    }
    if (this.opts.retry.respectRemaining === false) return spent;
    const cap = this.opts.retry.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
    for (const meter of [this.rateLimit.rest, this.rateLimit.history]) {
      if (!isExhausted(meter)) continue;
      const left = secondsUntilReset(meter);
      // Past the cap we do not sit on it: the caller gets the 429 and its
      // Retry-After and can decide. Same rule the retry path follows.
      if (left === null || left <= 0 || left * 1000 > cap) continue;
      // Jittered like the gate. Without it every waiter derived `left` from
      // the same observedAt and woke at the same absolute instant: measured
      // spread 0ms across ten waiters, the tightest burst in the client, on
      // the very branch that exists to avoid a 429.
      const wait = Math.min(left * 1000 + Math.random() * SPREAD_MS, budget - spent);
      if (wait <= MIN_SLEEP_MS) break;
      await sleep(wait);
      spent += wait;
    }
    return spent;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', this.opts.baseUrl.replace(/\/$/, '') + path);
  }

  /**
   * GET an absolute URL the API itself handed us.
   *
   * Paged history responses carry `next` as an absolute URL with every
   * parameter already applied. Re-deriving that from the path would mean
   * re-deriving the parameters too, which is how a paging loop quietly starts
   * asking for the wrong range.
   */
  async getUrl<T = unknown>(url: string): Promise<T> {
    return this.request<T>('GET', url);
  }

  private async request<T>(method: string, url: string): Promise<T> {
    const sleep = this.opts.sleep ?? defaultSleep;
    let attempt = 0;

    // One budget for the whole call, because that is what the cap promises.
    let budget = this.opts.retry.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
    while (true) {
      budget -= await this.hold(sleep, budget);
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
            ...(this.opts.apiKey !== undefined && this.opts.apiKey !== ''
              ? { 'x-api-key': this.opts.apiKey }
              : {}),
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
      this.rateLimit = readRateLimits(response.headers, this.rateLimit);

      if (response.ok) {
        return (await response.json()) as T;
      }

      const body = await this.safeParseBody(response);
      const bodyExcerpt = formatBodyExcerpt(body);

      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      const cap = this.opts.retry.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
      const waitTooLong = retryAfterMs !== null && retryAfterMs > cap;
      if (
        response.status === 429 &&
        this.opts.retry.on429 &&
        retryAfterMs !== null &&
        !waitTooLong
      ) {
        // The wait belongs to the CALLER, not to whichever request met it, so
        // it goes on the shared gate and hold() serves it once. Sleeping here
        // as well would pay it twice, and ten concurrent requests would each
        // pay their own and then retry in unison.
        //
        // on429: false means "do not wait on a 429", so it must gate the gate
        // too. Without this the caller got the error they asked for and then
        // their NEXT call silently blocked: an opt-out that does not opt out.
        //
        // Past the cap the gate is left OPEN on purpose: we throw instead, and
        // blocking the caller's next call for most of an hour is the opposite
        // of letting them checkpoint and resume.
        this.gate.closeFor(retryAfterMs);
      }
      if (
        response.status === 429 &&
        this.opts.retry.on429 &&
        attempt < this.opts.retry.max &&
        !waitTooLong
      ) {
        if (retryAfterMs === null) await sleep(backoff(attempt));
        attempt++;
        continue;
      }
      if (response.status === 429) {
        throw new RateLimitError(`429 Too Many Requests`, {
          status: 429,
          body,
          url,
          retryAfterMs,
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
