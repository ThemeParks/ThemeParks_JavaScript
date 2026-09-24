/**
 * What the server says about your budget, and how to stay inside it.
 *
 * TWO BUDGETS, SEPARATELY METERED. The API meters requests per minute, and
 * history requests again per hour. Different windows over different counters,
 * so the server advertises them in two sets of headers:
 *
 *     RateLimit-Limit / -Policy / -Remaining / -Reset            per minute
 *     RateLimit-History-Limit / -Policy / -Remaining / -Reset    per hour
 *
 * Both were being thrown away. The SDK read only `Retry-After`, and only after
 * a 429 had already happened, so it could tell you that you had run out and
 * never that you were about to.
 *
 * ABSENCE IS NOT ZERO. A response a shared cache may store carries no
 * per-caller figures at all, because they belong to whoever populated the
 * entry. That is every anonymous response. `null` here means "the server did
 * not say", which is a different thing from "nothing left", and nothing in
 * this module may confuse the two.
 */

/** One meter's state, as of the last response that mentioned it. */
export interface RateLimit {
  /** Requests allowed per window, or null if the server did not say. */
  readonly limit: number | null;
  /** Requests left in the current window, or null if the server did not say. */
  readonly remaining: number | null;
  /** Seconds until the window resets, as of `observedAt`. */
  readonly reset: number | null;
  /** The raw policy string, e.g. `"300;w=60"`. */
  readonly policy: string | null;
  /** `Date.now()` when this was read, so `reset` can be aged. */
  readonly observedAt: number | null;
}

/** Both meters. Reached as `client.rateLimit`. */
export interface RateLimits {
  readonly rest: RateLimit;
  readonly history: RateLimit;
}

export const UNKNOWN_RATE_LIMIT: RateLimit = Object.freeze({
  limit: null,
  remaining: null,
  reset: null,
  policy: null,
  observedAt: null,
});

export const UNKNOWN_RATE_LIMITS: RateLimits = Object.freeze({
  rest: UNKNOWN_RATE_LIMIT,
  history: UNKNOWN_RATE_LIMIT,
});

/**
 * True only when the server SAID there is nothing left.
 *
 * An unknown remaining is not exhaustion. Treating it as such would make an
 * anonymous caller, whose responses never carry figures, wait forever.
 */
export function isExhausted(meter: RateLimit): boolean {
  return meter.remaining === 0;
}

/**
 * How much of the window is left, counted down from when we read it.
 *
 * `reset` is relative and frozen at `observedAt`; using it later without
 * ageing it is how a client waits far longer than it needs to.
 */
export function secondsUntilReset(meter: RateLimit, now = Date.now()): number | null {
  if (meter.reset === null || meter.observedAt === null) return null;
  const elapsed = (now - meter.observedAt) / 1000;
  return Math.max(0, meter.reset - elapsed);
}

function intOrNull(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

interface HeaderBag {
  get(name: string): string | null;
}

function readOne(headers: HeaderBag, prefix: string, now: number): RateLimit {
  // Exact names, never a prefix scan: `ratelimit-history-limit` also begins
  // with `ratelimit-`, and a scan would read the hourly figure as the
  // per-minute one.
  const limit = intOrNull(headers.get(`${prefix}-limit`));
  const remaining = intOrNull(headers.get(`${prefix}-remaining`));
  const reset = intOrNull(headers.get(`${prefix}-reset`));
  const policy = headers.get(`${prefix}-policy`);
  if (limit === null && remaining === null && reset === null && policy === null) {
    return UNKNOWN_RATE_LIMIT;
  }
  return { limit, remaining, reset, policy, observedAt: now };
}

/**
 * Merge whatever this response said into what we already knew.
 *
 * A response mentioning neither meter leaves both alone. Most responses
 * mention only one -- the history headers appear on history routes, and a
 * cacheable response carries neither -- so overwriting with blanks would mean
 * the last cacheable response erased everything the client had learned.
 */
export function readRateLimits(
  headers: HeaderBag,
  previous: RateLimits = UNKNOWN_RATE_LIMITS,
): RateLimits {
  const now = Date.now();
  const rest = readOne(headers, 'ratelimit', now);
  const history = readOne(headers, 'ratelimit-history', now);
  return {
    rest: rest.observedAt !== null ? rest : previous.rest,
    history: history.observedAt !== null ? history : previous.history,
  };
}

/**
 * One shared "not before" instant for a whole client.
 *
 * WHY SHARED. A 429 applies to the CALLER, not to the request that happened to
 * meet it. With a per-request backoff, ten concurrent requests each sleep
 * their own Retry-After and then all retry at the same instant, re-tripping
 * the limit together: a thundering herd the client inflicts on itself, and on
 * us. One gate means the wait is taken once.
 *
 * Each waiter adds its own small jitter on the way out, because waking
 * together is the other half of the same problem.
 */
export class Gate {
  #until = 0;

  constructor(private readonly jitterMs = 250) {}

  /** Hold every request on this client for at least `ms`. */
  closeFor(ms: number): void {
    // Never bring the gate forward: a shorter Retry-After arriving while a
    // longer one is in force would release the herd early.
    this.#until = Math.max(this.#until, Date.now() + Math.max(0, ms));
  }

  /** How long this caller should hold off, jitter included. 0 if open. */
  waitMs(): number {
    const remaining = this.#until - Date.now();
    if (remaining <= 0) return 0;
    return remaining + Math.random() * this.jitterMs;
  }
}
