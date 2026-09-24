/**
 * The loop above the history endpoints: paging, park flattening, span, and the
 * hourly budget.
 *
 * The raw calls are covered in history.test.ts. These are about what a caller
 * would otherwise have to write themselves, and get wrong in the same three
 * ways every time: stopping at page one, branching on the park shape by hand,
 * and treating a 429 as no data.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ThemeParks } from '../../src/client';
import { BudgetExhaustedError } from '../../src/ergonomic/history';
import { RateLimitError } from '../../src/errors';
import type { FetchLike } from '../../src/transport';

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(__dirname, '../fixtures', name), 'utf8')) as Record<
    string,
    unknown
  >;
}

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function client(fetchFn: unknown, options: Record<string, unknown> = {}) {
  return new ThemeParks({ fetch: fetchFn as FetchLike, cache: false, ...options });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('days() paging', () => {
  it('follows the server next URL verbatim and stops at null', async () => {
    const page = await loadFixture('mk_history_daily.json');
    const urls: string[] = [];
    const fetchFn = vi.fn((url: string | URL) => {
      urls.push(String(url));
      const last = urls.length > 1;
      return Promise.resolve(
        json({
          ...page,
          next: last ? null : 'https://api.themeparks.wiki/v1/entity/mk/history/daily?cursor=abc',
        }),
      );
    });

    const rows = await collect(client(fetchFn).entity('mk').history.days());

    expect(urls).toHaveLength(2);
    // Not rebuilt from the path. The server has already applied every
    // parameter, and re-deriving the URL is how a paging loop quietly starts
    // asking for the wrong range.
    expect(urls[1]).toBe('https://api.themeparks.wiki/v1/entity/mk/history/daily?cursor=abc');
    // Both pages' rows arrived, none twice.
    const perPage = rows.length / 2;
    expect(Number.isInteger(perPage)).toBe(true);
    expect(perPage).toBeGreaterThan(0);
  });

  it('a single unpaged response costs exactly one call', async () => {
    const page = await loadFixture('mk_history_daily.json');
    page.next = null;
    const fetchFn = vi.fn(() => Promise.resolve(json(page)));
    await collect(client(fetchFn).entity('mk').history.days());
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('flattens a park envelope to the same stream as an entity one', async () => {
    const park = await loadFixture('mk_history_daily.json');
    const fetchFn = vi.fn(() => Promise.resolve(json(park)));
    const rows = await collect(client(fetchFn).entity('mk').history.days());

    const entities = park.entities as Array<{ id: string; days: unknown[] }>;
    const expected = entities.flatMap((e) => e.days.map(() => e.id));
    expect(rows.map((r) => r.entityId)).toEqual(expected);
    // Every row is tagged, which is the only thing the caller loses by asking
    // the park instead of the rides one at a time.
    expect(rows.every((r) => typeof r.entityId === 'string' && r.entityId !== '')).toBe(true);
  });

  it('does not accumulate: rows arrive before the last page does', async () => {
    const page = await loadFixture('mk_history_daily.json');
    let served = 0;
    const fetchFn = vi.fn(() => {
      served++;
      return Promise.resolve(
        json({ ...page, next: served >= 3 ? null : 'https://api.themeparks.wiki/v1/p' }),
      );
    });

    const seen: number[] = [];
    for await (const row of client(fetchFn).entity('mk').history.days()) {
      expect(row.entityId).toBeTruthy();
      seen.push(served);
      break;
    }
    // The first row was yielded while only one page had been fetched. A
    // version that collected everything first would report 3 here.
    expect(seen[0]).toBe(1);
  });
});

describe('span()', () => {
  it('reads a park summary and an entity top level to the same shape', async () => {
    const park = await loadFixture('mk_history_coverage.json');
    const entity = await loadFixture('mk_attraction_history_coverage.json');

    const parkSpan = await client(vi.fn(() => Promise.resolve(json(park))))
      .entity('mk')
      .history.span();
    const entitySpan = await client(vi.fn(() => Promise.resolve(json(entity))))
      .entity('ride')
      .history.span();

    expect(Object.keys(parkSpan).sort()).toEqual(Object.keys(entitySpan).sort());
    expect(parkSpan.archiveFrom).toBe((park.summary as { archiveFrom: string }).archiveFrom);
    expect(entitySpan.archiveFrom).toBe(entity.firstRecordedAt);
    expect(entitySpan.retrievableThrough).toBe(entity.retrievableThrough);
  });

  it('keeps retrievableThrough distinct from recordedTo', async () => {
    // A backfill bounded by recordedTo asks past the entitlement and ends in
    // 403s. These are different dates on every plan below the top one.
    const park = await loadFixture('mk_history_coverage.json');
    const span = await client(vi.fn(() => Promise.resolve(json(park))))
      .entity('mk')
      .history.span();
    const summary = park.summary as { recordedTo: string; retrievableThrough: string };
    expect(span.recordedTo).toBe(summary.recordedTo);
    expect(span.retrievableThrough).toBe(summary.retrievableThrough);
  });
});

describe('the hourly history budget', () => {
  function limited(retryAfter: string) {
    return vi.fn(() =>
      Promise.resolve(
        json(
          { error: 'HISTORY_RATE_LIMITED' },
          { status: 429, headers: { 'retry-after': retryAfter } },
        ),
      ),
    );
  }

  it('raises BudgetExhaustedError instead of sleeping through a long wait', async () => {
    const fetchFn = limited('2700');
    const tp = client(fetchFn);

    const error = await collect(tp.entity('mk').history.days()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BudgetExhaustedError);
    expect((error as BudgetExhaustedError).retryAfterMs).toBe(2_700_000);
    // The shipped retry policy is in force here on purpose: turning retries
    // off in the test is exactly how this hid in the Python sibling, where the
    // transport rode out 45 minutes three times before the error could fire.
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('still rides out an ordinary REST 429', async () => {
    const slept: number[] = [];
    const fetchFn = limited('2');
    const tp = new ThemeParks({ fetch: fetchFn as unknown as FetchLike, cache: false });
    // Only the sleep is substituted; the retry policy under test is the real one.
    (
      tp as unknown as { transport: { opts: { sleep: (ms: number) => Promise<void> } } }
    ).transport.opts.sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };

    const error = await collect(tp.entity('ride').history.days()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).not.toBeInstanceOf(BudgetExhaustedError);
    // Jittered: the 429 wait is now taken once on a gate shared by the whole
    // client, and without a little spread every waiter would wake at the same
    // instant and re-trip the limit together. One wait per retry, never
    // doubled by the retry path paying it as well.
    expect(slept).toHaveLength(3);
    for (const ms of slept) {
      expect(ms).toBeGreaterThanOrEqual(2000);
      expect(ms).toBeLessThan(2300);
    }
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('applies on a later page too, not just the first call', async () => {
    const page = await loadFixture('mk_history_daily.json');
    let call = 0;
    const fetchFn = vi.fn(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(json({ ...page, next: 'https://api.themeparks.wiki/v1/p2' }));
      }
      return Promise.resolve(
        json(
          { error: 'HISTORY_RATE_LIMITED' },
          { status: 429, headers: { 'retry-after': '2700' } },
        ),
      );
    });

    const error = await collect(client(fetchFn).entity('mk').history.days()).catch(
      (e: unknown) => e,
    );
    // A backfill runs out of budget mid-walk far more often than on its first
    // call, so the page loop has to raise the same error the first call does.
    expect(error).toBeInstanceOf(BudgetExhaustedError);
  });

  it('a raised maxWaitMs lets a longer wait through as a plain RateLimitError', async () => {
    const tp = new ThemeParks({
      fetch: limited('2700') as unknown as FetchLike,
      cache: false,
      retry: { max: 0 },
    });
    const error = await collect(tp.entity('mk').history.days({ maxWaitMs: 3_600_000 })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).not.toBeInstanceOf(BudgetExhaustedError);
  });
});

describe('the API key', () => {
  it('treats an empty key as no key', async () => {
    // An unset environment variable arrives as '' far more often than as
    // undefined, and sending an empty key is a 401 rather than an anonymous
    // request.
    const seen: Array<Record<string, string>> = [];
    const fetchFn = vi.fn((_url: string | URL, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers ?? {});
      return Promise.resolve(json({ destinations: [] }));
    });
    await client(fetchFn, { apiKey: '' }).destinations.list();
    expect(seen[0]).not.toHaveProperty('x-api-key');
  });

  it('reaches a page fetched by absolute URL, not just the first call', async () => {
    const page = await loadFixture('mk_history_daily.json');
    const seen: Array<Record<string, string>> = [];
    let call = 0;
    const fetchFn = vi.fn((_url: string | URL, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers ?? {});
      call++;
      return Promise.resolve(
        json({ ...page, next: call >= 2 ? null : 'https://api.themeparks.wiki/v1/p2' }),
      );
    });
    await collect(client(fetchFn, { apiKey: 'tpw_example' }).entity('mk').history.days());
    // getUrl takes a different path into the transport from get. A key that
    // reached only the first call would drop the caller to the anonymous
    // window partway through their own backfill.
    expect(seen).toHaveLength(2);
    expect(seen[1]!['x-api-key']).toBe('tpw_example');
  });
});
