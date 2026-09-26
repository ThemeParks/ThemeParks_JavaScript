/**
 * Reading the two budgets, and staying inside them.
 *
 * The SDK read exactly one header, `Retry-After`, and only after a 429 had
 * already happened: it could say you had run out, never that you were about
 * to. These cover the three things that changed. The figures are read,
 * absence is not confused with zero, and the wait a 429 imposes is taken ONCE
 * for the whole client rather than once per in-flight request.
 */

import { describe, it, expect, vi } from 'vitest';
import { ThemeParks } from '../../src/client';
import { RateLimitError } from '../../src/errors';
import {
  Gate,
  isExhausted,
  readRateLimits,
  secondsUntilReset,
  UNKNOWN_RATE_LIMIT,
  UNKNOWN_RATE_LIMITS,
} from '../../src/ratelimit';
import type { FetchLike } from '../../src/transport';

const REST = {
  'RateLimit-Limit': '300',
  'RateLimit-Policy': '300;w=60',
  'RateLimit-Remaining': '299',
  'RateLimit-Reset': '60',
};
const HISTORY = {
  'RateLimit-History-Limit': '600',
  'RateLimit-History-Policy': '600;w=3600',
  'RateLimit-History-Remaining': '599',
  'RateLimit-History-Reset': '3412',
};

function bag(headers: Record<string, string>) {
  return new Headers(headers);
}

function client(headers: Record<string, string>, options: Record<string, unknown> = {}) {
  const fetchFn = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ destinations: [] }), {
        headers: { 'content-type': 'application/json', ...headers },
      }),
    ),
  );
  const tp = new ThemeParks({ fetch: fetchFn as unknown as FetchLike, ...options });
  return { tp, fetchFn };
}

describe('reading the headers', () => {
  it('reads the REST meter', () => {
    const { rest } = readRateLimits(bag(REST));
    expect([rest.limit, rest.remaining, rest.reset]).toEqual([300, 299, 60]);
    expect(rest.policy).toBe('300;w=60');
  });

  it('reads the history meter', () => {
    const { history } = readRateLimits(bag(HISTORY));
    expect([history.limit, history.remaining, history.reset]).toEqual([600, 599, 3412]);
  });

  it('keeps the two meters apart', () => {
    // `ratelimit-history-limit` also begins with `ratelimit-`, so a prefix
    // scan reads the hourly figure as the per-minute one and the client paces
    // itself against the wrong window.
    const out = readRateLimits(bag({ ...REST, ...HISTORY }));
    expect(out.rest.limit).toBe(300);
    expect(out.history.limit).toBe(600);
    expect(out.rest.reset).toBe(60);
    expect(out.history.reset).toBe(3412);
  });

  it('does not invent a REST meter from history headers alone', () => {
    expect(readRateLimits(bag(HISTORY)).rest.limit).toBeNull();
  });

  it('leaves what we knew alone when a response mentions neither', () => {
    // Most responses mention one meter, or -- if publicly cacheable --
    // neither. Overwriting with blanks would let the last cacheable response
    // erase everything the client had learned.
    const known = readRateLimits(bag({ ...REST, ...HISTORY }));
    const after = readRateLimits(bag({ 'content-type': 'application/json' }), known);
    expect(after.rest.remaining).toBe(299);
    expect(after.history.remaining).toBe(599);
  });

  it('treats a malformed value as unknown rather than zero', () => {
    // A failed parse must not become 0, or the client holds forever waiting
    // on a window it invented.
    const { rest } = readRateLimits(bag({ ...REST, 'RateLimit-Remaining': 'lots' }));
    expect(rest.remaining).toBeNull();
    expect(isExhausted(rest)).toBe(false);
  });
});

describe('a cached response says nothing', () => {
  // Its figures belong to whoever populated the entry. The server withholds
  // the HISTORY figures from anything a shared cache may store, but the
  // per-minute ones ride those responses. Measured against production: three
  // consecutive calls returning `age: 9` and an unmoving `remaining: 285`. A
  // cached `remaining: 0` would make the client sleep out someone else's
  // window.
  it('ignores a cache hit', () => {
    const known = readRateLimits(bag(REST));
    const after = readRateLimits(bag({ ...REST, 'RateLimit-Remaining': '0', Age: '1713' }), known);
    expect(after.rest.remaining).toBe(299);
  });

  it('records a fresh response', () => {
    // A cache MISS carries no Age at all, which is the path that matters:
    // confirmed against production, a MISS returns the figures.
    expect(readRateLimits(bag(REST)).rest.remaining).toBe(299);
  });

  it('treats Age: 0 as fresh', () => {
    expect(readRateLimits(bag({ ...REST, Age: '0' })).rest.remaining).toBe(299);
  });

  it('does not erase what we knew', () => {
    const known = readRateLimits(bag({ ...REST, ...HISTORY }));
    const after = readRateLimits(bag({ Age: '60' }), known);
    expect(after.rest.remaining).toBe(299);
    expect(after.history.remaining).toBe(599);
  });
});

describe('absence is not zero', () => {
  it('an unknown remaining is not exhausted', () => {
    // Anonymous responses carry no figures, because they are publicly
    // cacheable and the numbers are per-caller. Reading that as "nothing
    // left" would stall every anonymous client permanently.
    expect(isExhausted(UNKNOWN_RATE_LIMIT)).toBe(false);
  });

  it('a zero remaining is exhausted', () => {
    expect(isExhausted({ ...UNKNOWN_RATE_LIMIT, remaining: 0 })).toBe(true);
  });

  // Both of these pass an explicit `now` rather than reading a clock. The
  // function takes one precisely so these can be exact; asserting a range
  // around real wall-clock time makes a gate test flaky under CPU load, and
  // one of these did flake when the two suites ran concurrently.
  it('counts the reset down from when it was read', () => {
    const meter = { ...UNKNOWN_RATE_LIMIT, reset: 60, observedAt: 1_000_000 };
    expect(secondsUntilReset(meter, 1_050_000)).toBe(10);
  });

  it('never reports a negative countdown', () => {
    const meter = { ...UNKNOWN_RATE_LIMIT, reset: 5, observedAt: 1_000_000 };
    expect(secondsUntilReset(meter, 1_100_000)).toBe(0);
  });

  it('observedAt is monotonic, not an epoch timestamp', () => {
    // Date.now() in the Gate made a backward clock step turn a 5s wait into
    // an hour, silently, with nothing bounding it: the cap is applied when
    // the gate is armed, never when it is served.
    const { rest } = readRateLimits(bag(REST));
    expect(rest.observedAt).not.toBeNull();
    // An epoch reading would be ~1.8e12; a monotonic one is process uptime.
    expect(rest.observedAt!).toBeLessThan(1e11);
  });

  it('has no countdown without a reset', () => {
    expect(secondsUntilReset(UNKNOWN_RATE_LIMITS.rest)).toBeNull();
  });
});

describe('the gate', () => {
  it('costs nothing while open', () => {
    expect(new Gate().waitMs()).toBe(0);
  });

  it('holds every caller once closed', () => {
    const gate = new Gate();
    gate.closeFor(5000);
    expect(gate.waitMs()).toBeGreaterThan(4000);
    expect(gate.waitMs()).toBeGreaterThan(4000);
  });

  it('jitters waiters so they do not wake together', () => {
    // Waking in unison is the other half of the thundering herd: the wait is
    // shared, then everyone retries at the same instant and re-trips it.
    //
    // Measured against a FROZEN clock. With a live one this asserted only
    // that time passes between calls -- it stayed green with the jitter term
    // deleted, which is a test that cannot fail.
    let clock = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      const gate = new Gate();
      gate.closeFor(5000);
      const waits = new Set(Array.from({ length: 20 }, () => gate.waitMs()));
      expect(waits.size).toBeGreaterThan(1);
      // And the spread is bounded, so it cannot be mistaken for the wait.
      for (const w of waits) {
        expect(w).toBeGreaterThanOrEqual(5000);
        expect(w).toBeLessThan(5300);
      }
    } finally {
      vi.mocked(performance.now).mockRestore();
      void clock;
    }
  });

  it('is never brought forward by a shorter wait', () => {
    // A 2s Retry-After arriving while a 60s one is in force would otherwise
    // release the herd early.
    const gate = new Gate();
    gate.closeFor(60_000);
    gate.closeFor(2000);
    expect(gate.waitMs()).toBeGreaterThan(55_000);
  });
});

describe('the opt-outs actually opt out', () => {
  // An advertised switch that switches nothing is worse than no switch.
  // `on429: false` threw the error the caller asked for and then closed the
  // shared gate anyway, so their NEXT call blocked for the full Retry-After.
  // The setting says "do not wait on a 429"; the gate is a wait on a 429.
  function limited(retry: Record<string, unknown>) {
    const slept: number[] = [];
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '45' },
        }),
      ),
    );
    const tp = new ThemeParks({ fetch: fetchFn as unknown as FetchLike, cache: false, retry });
    (
      tp as unknown as { transport: { opts: { sleep: (ms: number) => Promise<void> } } }
    ).transport.opts.sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    return { tp, slept };
  }

  it('on429 false never sleeps, even on a later call', async () => {
    const { tp, slept } = limited({ on429: false });
    for (let i = 0; i < 3; i++) {
      await expect(tp.destinations.list()).rejects.toBeInstanceOf(RateLimitError);
    }
    expect(slept).toEqual([]);
  });

  it('on429 true still holds the gate', async () => {
    // The opt-out must not have disabled the feature for everyone else.
    const { tp, slept } = limited({ max: 0 });
    await expect(tp.destinations.list()).rejects.toBeInstanceOf(RateLimitError);
    await expect(tp.destinations.list()).rejects.toBeInstanceOf(RateLimitError);
    expect(slept.length).toBeGreaterThan(0);
  });
});

describe('through the client', () => {
  it('records both meters from a real call', async () => {
    const { tp } = client({ ...REST, ...HISTORY });
    await tp.destinations.list();
    expect(tp.rateLimit.rest.remaining).toBe(299);
    expect(tp.rateLimit.history.remaining).toBe(599);
  });

  it('knows nothing before the first call', () => {
    const { tp } = client(REST);
    expect(tp.rateLimit.rest.limit).toBeNull();
    expect(isExhausted(tp.rateLimit.rest)).toBe(false);
  });

  it('survives the cache wrapper, which is the default path', async () => {
    // Caching is ON by default and wraps the transport. In the Python sibling
    // every test used cache:false and the first real call against production
    // threw, because the wrapper had no rateLimit to forward.
    const { tp, fetchFn } = client(REST); // cache default: on
    await tp.destinations.list();
    await tp.destinations.list();
    expect(fetchFn).toHaveBeenCalledOnce(); // second was a cache hit
    // A hit sends no request and so learns nothing, which is right: it spent
    // no budget either, so the previous figures still stand.
    expect(tp.rateLimit.rest.remaining).toBe(299);
  });

  it('waits out a window the server said is spent', async () => {
    const slept: number[] = [];
    const { tp, fetchFn } = client(
      { ...REST, 'RateLimit-Remaining': '0', 'RateLimit-Reset': '7' },
      { cache: false },
    );
    (
      tp as unknown as { transport: { opts: { sleep: (ms: number) => Promise<void> } } }
    ).transport.opts.sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    await tp.destinations.list(); // learns remaining 0
    await tp.destinations.list(); // must hold first
    // Both bounds. Upper-only let `sleep(left)` through in place of
    // `sleep(left * 1000)` -- 7 milliseconds instead of 7 seconds, a
    // thousandfold too short, passing green.
    expect(slept.length).toBeGreaterThan(0);
    expect(slept[0]).toBeGreaterThan(6000);
    expect(slept[0]).toBeLessThanOrEqual(7000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('never holds on an unknown remaining', async () => {
    const slept: number[] = [];
    const { tp } = client({ 'content-type': 'application/json' }, { cache: false });
    (
      tp as unknown as { transport: { opts: { sleep: (ms: number) => Promise<void> } } }
    ).transport.opts.sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    await tp.destinations.list();
    await tp.destinations.list();
    expect(slept).toEqual([]);
  });

  it('can be told not to respect remaining', async () => {
    const slept: number[] = [];
    const { tp } = client(
      { ...REST, 'RateLimit-Remaining': '0', 'RateLimit-Reset': '7' },
      { cache: false, retry: { respectRemaining: false } },
    );
    (
      tp as unknown as { transport: { opts: { sleep: (ms: number) => Promise<void> } } }
    ).transport.opts.sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    await tp.destinations.list();
    await tp.destinations.list();
    expect(slept).toEqual([]);
  });
});

describe('the cap bounds the whole call', () => {
  // Two self-initiated holds exist -- the shared gate and the spent-window
  // wait -- and they stack. A 429 carrying BOTH a Retry-After and
  // RateLimit-Remaining: 0 slept 5s at the gate then 55s for the window,
  // three times over: 180 seconds inside one call whose cap was 120. Each leg
  // was under the cap, so the per-leg check never fired.
  //
  // Nothing caught it because no test sent a 429 carrying rate-limit headers,
  // and a fake sleep that does not advance the clock cannot show a cumulative
  // total at all. This advances one, which is what the real world does.
  const REAL_429 = {
    'retry-after': '5',
    'RateLimit-Limit': '300',
    'RateLimit-Remaining': '0',
    'RateLimit-Reset': '60',
  };

  async function run(capMs: number) {
    const slept: number[] = [];
    let clock = 1_000_000;
    const original = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      const fetchFn = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 429,
            headers: { 'content-type': 'application/json', ...REAL_429 },
          }),
        ),
      );
      const tp = new ThemeParks({
        fetch: fetchFn as unknown as FetchLike,
        cache: false,
        retry: { maxRetryAfterMs: capMs },
      });
      (
        tp as unknown as { transport: { opts: { sleep: (ms: number) => Promise<void> } } }
      ).transport.opts.sleep = (ms: number) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      };
      await expect(tp.destinations.list()).rejects.toBeInstanceOf(RateLimitError);
      return slept;
    } finally {
      vi.mocked(performance.now).mockRestore();
      void original;
    }
  }

  it('never exceeds the cap in total', async () => {
    const slept = await run(120_000);
    const total = slept.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(120_000 + 10);
  });

  it('binds harder with a smaller cap', async () => {
    const slept = await run(30_000);
    const total = slept.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(30_000 + 10);
  });

  it('still waits when there is budget', async () => {
    // The cap must bound the feature, not disable it.
    const slept = await run(120_000);
    const total = slept.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(5000);
  });

  it('emits no meaningless micro-sleeps', async () => {
    const slept = await run(120_000);
    for (const ms of slept) expect(ms).toBeGreaterThan(1);
  });
});

describe('the waits are actually awaited', () => {
  // The suite could prove a sleep was REQUESTED and never that it was waited
  // on: dropping the `await` in front of it passed every test, because a fake
  // sleep that resolves synchronously advances the world either way. A
  // dropped await would make the whole feature a no-op that still looks busy.
  //
  // So this sleep resolves on a later macrotask and counts itself as pending.
  // A request that starts while a sleep is pending means the hold was not
  // awaited.
  it('no request is sent while a hold is still pending', async () => {
    let pending = 0;
    const violations: string[] = [];

    const fetchFn = vi.fn(() => {
      if (pending > 0) violations.push('fetch started with a sleep in flight');
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '5',
            'RateLimit-Limit': '300',
            'RateLimit-Remaining': '0',
            'RateLimit-Reset': '60',
          },
        }),
      );
    });

    const tp = new ThemeParks({ fetch: fetchFn as unknown as FetchLike, cache: false });
    (
      tp as unknown as { transport: { opts: { sleep: (ms: number) => Promise<void> } } }
    ).transport.opts.sleep = () => {
      pending++;
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          pending--;
          resolve();
        }, 0);
      });
    };

    await expect(tp.destinations.list()).rejects.toBeInstanceOf(RateLimitError);
    expect(violations).toEqual([]);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
  });
});
