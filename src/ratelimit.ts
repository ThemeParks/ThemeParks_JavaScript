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
 * ABSENCE IS NOT ZERO. `null` here means "the server did not say", which is a
 * different thing from "nothing left". Reading an unknown as zero would stall
 * a client permanently.
 *
 * A CACHED RESPONSE'S FIGURES ARE NOT YOURS. The server withholds the HISTORY
 * figures from anything a shared cache may store, but the per-minute REST ones
 * ride those responses, so an anonymous call can come back from a CDN carrying
 * another caller's numbers frozen at whatever they were when the entry was
 * populated. Measured against production: three consecutive calls returning
 * `age: 9` and an unmoving `remaining: 285`. A cached `remaining: 0` would make
 * the client sleep out a window belonging to someone else, so a response with a
 * non-zero `Age` is treated as saying nothing at all.
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
  /**
   * A monotonic reading (milliseconds) from when this was read, so `reset`
   * can be aged. NOT an epoch timestamp: it is not meaningful as a date, and
   * `new Date(observedAt)` is nonsense. The Python sibling's `observed_at` is
   * the same idea in seconds.
   */
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
export function secondsUntilReset(meter: RateLimit, now = now_()): number | null {
  if (meter.reset === null || meter.observedAt === null) return null;
  const elapsed = (now - meter.observedAt) / 1000;
  return Math.max(0, meter.reset - elapsed);
}

/**
 * A clock that only moves forward.
 *
 * `Date.now()` is wall-clock: it steps backwards on an NTP correction, a
 * manual clock change or a container resync. The Gate stores a deadline and
 * subtracts the clock from it, so a backward step turns a five-second wait
 * into however far the clock moved -- measured at 60 minutes for a one-hour
 * step, silently, before a request the caller thinks is in flight. The cap is
 * applied when the gate is ARMED, never when it is served, so nothing bounds
 * it.
 *
 * `performance.now()` is monotonic, which is what the Python sibling gets from
 * `time.monotonic()`. It excludes time the host spent suspended, so a resumed
 * laptop waits out a remainder it already slept through: conservative and
 * bounded, which is the right side to err on.
 */
function now_(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * These fields are integers per the draft spec, so anything else is a header
 * we do not understand and the honest answer is "unknown".
 *
 * `Number()` was too generous and differed from the Python sibling on the
 * same input: it read "0.4" as 0, which makes `isExhausted` true and sleeps
 * out a window the caller has not spent, and it accepted "0x10" as 16 and
 * "1e3" as 1000. The server only ever sends a non-negative integer, so none
 * of that fires today; a pair of libraries whose selling point is parity
 * should not disagree on it regardless.
 */
function intOrNull(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
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
 * A response mentioning neither meter leaves both alone, and so does a
 * response served from a cache. Most responses
 * mention only one -- the history headers appear on history routes, and a
 * cacheable response carries neither -- so overwriting with blanks would mean
 * the last cacheable response erased everything the client had learned.
 */
export function readRateLimits(
  headers: HeaderBag,
  previous: RateLimits = UNKNOWN_RATE_LIMITS,
): RateLimits {
  // A cache HIT carries the figures of whoever populated the entry, frozen at
  // that moment. They are not ours and the countdown is already wrong, so the
  // honest reading is that this response said nothing.
  const age = intOrNull(headers.get('age'));
  if (age !== null && age > 0) return previous;

  const now = now_();
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
    this.#until = Math.max(this.#until, now_() + Math.max(0, ms));
  }

  /** How long this caller should hold off, jitter included. 0 if open. */
  waitMs(): number {
    const remaining = this.#until - now_();
    if (remaining <= 0) return 0;
    return remaining + Math.random() * this.jitterMs;
  }
}
