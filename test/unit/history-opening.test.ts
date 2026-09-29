/**
 * `changeRows()` hands back the `opening` state, so a day can be rebuilt from it.
 *
 * Every row of `/history` is the complete live data from its `time` until the
 * next row. What the rows cannot say is the state BEFORE the first of them: that
 * is the envelope's `opening` object, and `changeRows()` yielded the rows and
 * threw the envelope away. A caller rebuilding a day then had no status for the
 * seconds between the start of the range and the first change, which on a night
 * a ride runs past midnight is real operating time.
 *
 * The oracle is a real capture shared with the Python SDK (see
 * test/fixtures/README.md): Space Mountain on 2026-09-26, whose opening is
 * OPERATING because the previous night's hours ran past midnight, and the daily
 * summary the API computed for the same day.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ThemeParks } from '../../src/client';
import type { HistoryChanges, HistoryOpening } from '../../src/ergonomic/history';
import type { FetchLike } from '../../src/transport';

interface Row {
  time: string;
  status?: string | null;
}

const FIXTURES = resolve(__dirname, '../fixtures');
const RAW = JSON.parse(
  readFileSync(resolve(FIXTURES, 'space_mountain_history_2026-09-26.json'), 'utf8'),
) as { id: string; opening: HistoryOpening; history: Row[]; coverage: unknown };
const DAILY = JSON.parse(
  readFileSync(resolve(FIXTURES, 'space_mountain_daily_2026-09-26.json'), 'utf8'),
) as { days: { firstOperatingAt: string; lastClosedAt: string }[] };
const SPACE_MOUNTAIN = RAW.id;

function client(payload: unknown, seen: string[] = []) {
  const fetchFn = vi.fn((url: unknown) => {
    seen.push(String(url));
    return Promise.resolve(
      new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }),
    );
  });
  return new ThemeParks({ fetch: fetchFn as unknown as FetchLike, cache: false });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/**
 * (from, to, status) segments covering the day, the way a customer rebuilds one.
 * Without an opening, the stretch before the first change has no known status.
 */
function timeline(
  opening: HistoryOpening | null,
  rows: Row[],
  dayStart: number,
  dayEnd: number,
): [number, number, string | null][] {
  const segments: [number, number, string | null][] = [];
  let cursor = dayStart;
  let status: string | null = opening ? (opening.status ?? null) : null;
  for (const row of rows) {
    const at = Date.parse(row.time);
    if (at > cursor) segments.push([cursor, at, status]);
    cursor = Math.max(cursor, at);
    status = row.status ?? null;
  }
  segments.push([cursor, dayEnd, status]);
  return segments;
}

const seconds = (segments: [number, number, string | null][], wanted: string | null) =>
  segments.filter(([, , s]) => s === wanted).reduce((sum, [a, b]) => sum + (b - a) / 1000, 0);

describe('the capture is what this file says it is', () => {
  it('opens OPERATING, carried over midnight, and its first row is a close', () => {
    // Guard the oracle. If a re-capture picks a day whose opening is CLOSED,
    // every test below passes with and without the fix.
    expect(RAW.opening.status).toBe('OPERATING');
    expect(RAW.history[0]?.status).toBe('CLOSED');
    expect(RAW.history[0]!.time > RAW.opening.time).toBe(true);
  });
});

describe('changeRows() exposes opening', () => {
  it('yields exactly the rows it always did', async () => {
    const rows = await collect(
      client(RAW).entity(SPACE_MOUNTAIN).history.changeRows({ date: '2026-09-26' }),
    );
    expect(rows).toHaveLength(RAW.history.length);
    expect(rows.every((r) => r.entityId === SPACE_MOUNTAIN)).toBe(true);
    expect(Object.keys(rows[0]!)).toEqual(['entityId', 'row']);
    expect(rows[0]?.row.status).toBe('CLOSED');
  });

  it('keys opening by entity id, readable once iterated', async () => {
    const changes = client(RAW).entity(SPACE_MOUNTAIN).history.changeRows({ date: '2026-09-26' });
    await collect(changes);
    const opening = changes.opening[SPACE_MOUNTAIN];
    expect(opening?.status).toBe('OPERATING');
    expect(opening?.time).toBe('2026-09-26T04:00:00Z');
    expect(opening?.queue?.STANDBY?.waitTime).toBe(15);
  });

  it('load() fetches up front, and iterating after costs no second request', async () => {
    const seen: string[] = [];
    const changes = client(RAW, seen)
      .entity(SPACE_MOUNTAIN)
      .history.changeRows({ date: '2026-09-26' });
    expect(seen).toEqual([]);
    const loaded = await changes.load();
    expect(loaded).toBe(changes);
    expect(changes.opening[SPACE_MOUNTAIN]?.status).toBe('OPERATING');
    expect(await collect(changes)).toHaveLength(RAW.history.length);
    expect(seen).toHaveLength(1);
  });

  it('two load() calls in flight share one request', async () => {
    const seen: string[] = [];
    const changes = client(RAW, seen)
      .entity(SPACE_MOUNTAIN)
      .history.changeRows({ date: '2026-09-26' });
    await Promise.all([changes.load(), changes.load()]);
    expect(seen).toHaveLength(1);
  });

  it('says how to get opening when read before the response has arrived', () => {
    const changes = client(RAW).entity(SPACE_MOUNTAIN).history.changeRows({ date: '2026-09-26' });
    expect(() => changes.opening).toThrow(/load\(\)/u);
  });

  it('is still an async generator', async () => {
    const changes: AsyncGenerator<unknown> = client(RAW)
      .entity(SPACE_MOUNTAIN)
      .history.changeRows({ date: '2026-09-26' });
    expect(changes[Symbol.asyncIterator]()).toBe(changes);
    const first = await changes.next();
    expect(first.done).toBe(false);
    expect(await changes.return(undefined)).toEqual({ done: true, value: undefined });
  });

  it('gives a park one opening per entity, including one that did not change', async () => {
    const park = {
      id: 'park-1',
      name: 'Magic Kingdom Park',
      entityType: 'PARK',
      timezone: 'America/New_York',
      range: { from: '2026-09-26', to: '2026-09-26' },
      entities: [
        {
          id: SPACE_MOUNTAIN,
          name: 'Space Mountain',
          entityType: 'ATTRACTION',
          coverage: RAW.coverage,
          opening: RAW.opening,
          history: RAW.history.slice(0, 2),
        },
        {
          id: 'quiet-ride',
          name: 'Nothing Changed Today',
          entityType: 'ATTRACTION',
          coverage: { firstRecordedAt: '2021-07-03' },
          opening: { time: '2026-09-26T04:00:00Z', status: 'REFURBISHMENT' },
          history: [],
        },
      ],
      next: null,
    };
    const changes = client(park).entity('park-1').history.changeRows({ date: '2026-09-26' });
    const rows = await collect(changes);
    expect(Object.keys(changes.opening)).toEqual([SPACE_MOUNTAIN, 'quiet-ride']);
    // An entity with no rows at all is only knowable through its opening.
    expect(changes.opening['quiet-ride']?.status).toBe('REFURBISHMENT');
    expect(rows.map((r) => r.entityId)).toEqual([SPACE_MOUNTAIN, SPACE_MOUNTAIN]);
  });

  it('a failed request rejects load() and the iteration alike', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { type: 'INVALID_RANGE' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const tp = new ThemeParks({ fetch: fetchFn as unknown as FetchLike, cache: false });
    const changes: HistoryChanges = tp.entity(SPACE_MOUNTAIN).history.changeRows({ date: 'x' });
    await expect(changes.load()).rejects.toThrow();
    await expect(collect(changes)).rejects.toThrow();
    // Not "has not arrived yet, call load()": load() was called, and failed.
    expect(() => changes.opening).toThrow(/failed/u);
  });

  it('can be spread and listed before the response without throwing', () => {
    const changes = client(RAW).entity(SPACE_MOUNTAIN).history.changeRows({ date: '2026-09-26' });
    expect(() => ({ ...changes })).not.toThrow();
    expect(Object.keys(changes)).not.toContain('opening');
    expect(() => JSON.stringify(changes)).not.toThrow();
  });
});

describe('a day rebuilds from opening plus the rows', () => {
  // What opening is FOR, checked against the API's own daily row.
  const DAY_START = Date.parse('2026-09-26T04:00:00Z'); // 00:00 EDT
  const DAY_END = DAY_START + 86_400_000;

  async function rebuild(withOpening: boolean) {
    const changes = client(RAW).entity(SPACE_MOUNTAIN).history.changeRows({ date: '2026-09-26' });
    const rows = (await collect(changes)).map((e) => e.row as Row);
    const opening = withOpening ? (changes.opening[SPACE_MOUNTAIN] ?? null) : null;
    return timeline(opening, rows, DAY_START, DAY_END);
  }

  it('gives every second of the day a known status', async () => {
    const segments = await rebuild(true);
    expect(segments.reduce((sum, [a, b]) => sum + (b - a) / 1000, 0)).toBe(86_400);
    expect(seconds(segments, null)).toBe(0);
  });

  it('without the opening, the first 63 seconds are unknown', async () => {
    // The defect, measured: a ride OPERATING past midnight that a rebuild from
    // rows alone cannot place.
    expect(seconds(await rebuild(false), null)).toBe(63);
  });

  it('agrees with the daily row the API computed', async () => {
    const segments = await rebuild(true);
    const daily = DAILY.days[0]!;
    const opened = segments.filter(([a, , s]) => s === 'OPERATING' && a > DAY_START);
    const closed = segments.filter(([, b, s]) => s === 'OPERATING' && b < DAY_END);
    const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
    expect(iso(opened[0]![0])).toBe(daily.firstOperatingAt);
    expect(iso(closed.at(-1)![1])).toBe(daily.lastClosedAt);
    // 63 s carried over midnight, then 11:30:53Z to 03:01:04Z.
    expect(seconds(segments, 'OPERATING')).toBe(63 + 55_811);
  });
});
