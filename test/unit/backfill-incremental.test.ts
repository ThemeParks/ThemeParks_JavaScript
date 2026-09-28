/**
 * `themeparks-backfill` over time: a date range, reruns that add new days, and
 * only final days in the file.
 *
 * Three defects from one customer-style run of 8.3.1, each reproduced against
 * the live API before it was fixed:
 *
 * 1. No way to ask for less than everything. `--since` was "Unknown option", so
 *    a key that reaches the whole archive downloaded all of it, every time.
 * 2. A finished park was finished forever. A rerun printed "already complete"
 *    and exited 0 without asking for a single new day, so a nightly cron looked
 *    healthy and never updated. The only way to get yesterday was
 *    `--overwrite`, which downloads the whole archive again.
 * 3. The run ended at `retrievableThrough`, which is usually today. Today's row
 *    is the day so far, and the archive records days 2 to 3 behind, so the
 *    newest rows in the file were partial, and because of (2) they were never
 *    corrected.
 *
 * The stub below serves a park the way the API does: one row per entity per
 * day, 31 days a page, final values through `recordedTo` and partial values
 * after it. A partial row carries half the operating minutes, so a test can tell
 * from the file alone whether a non-final day was ever written. The Python SDK
 * tests the same behaviour with the same stub, case for case.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CSV_COLUMNS,
  EX_TEMPFAIL,
  STATE_VERSION,
  backfillPark,
  columnsFingerprint,
  csvLine,
  main,
  ndjsonLine,
  statePathFor,
  trimAfter,
} from '../../src/backfill';
import { ApiError } from '../../src/errors';
import type { ThemeParks } from '../../src/client';
import {
  BudgetExhaustedError,
  type DailyEntry,
  type DaysOptions,
  type HistoryApi,
  type HistorySpan,
} from '../../src/ergonomic/history';

const FINAL_MINUTES = 600;
const PARTIAL_MINUTES = 300;
const PAGE_DAYS = 31;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const minDay = (a: string, b: string) => (a < b ? a : b);

function forbidden(earliest: string): ApiError {
  return new ApiError(`403 Forbidden: This key can see history back to ${earliest}.`, {
    status: 403,
    body: {
      error: {
        type: 'HISTORY_WINDOW_EXCEEDED',
        message: `This key can see history back to ${earliest} (400 days).`,
        earliestAllowedDate: earliest,
      },
    },
    url: 'https://api.themeparks.wiki/v1/entity/p/history/daily',
  });
}

/**
 * A park's daily history, served as the API serves it.
 *
 * `through` is retrievableThrough (usually today), `recordedTo` the newest day
 * the archive holds. Days after `recordedTo` are served with partial values,
 * which is what today's row and the days still being recorded look like.
 */
class Archive implements Pick<HistoryApi, 'span' | 'days'> {
  calls: [string, string][] = [];
  /** Throw BudgetExhaustedError on the Nth page request (1-based), or never. */
  budgetOnPage: number | null = null;
  pagesServed = 0;
  names: Record<string, string> = {};

  constructor(
    public archiveFrom = '2026-06-01',
    public recordedTo: string | null = '2026-09-26',
    public through = '2026-09-28',
    public floor: string | null = null,
    public entities: string[] = ['ent-a', 'ent-b'],
  ) {}

  /** Time passes: the archive and today both move on. */
  advance(days: number): void {
    if (this.recordedTo !== null) this.recordedTo = addDays(this.recordedTo, days);
    this.through = addDays(this.through, days);
  }

  span(): Promise<HistorySpan> {
    return Promise.resolve({
      archiveFrom: this.archiveFrom,
      recordedTo: this.recordedTo,
      retrievableThrough: this.through,
      finalThrough: this.recordedTo === null ? null : minDay(this.recordedTo, this.through),
    });
  }

  async *days(options: DaysOptions = {}): AsyncGenerator<DailyEntry> {
    const from = String(options.from);
    const to = String(options.to);
    this.calls.push([from, to]);
    if (this.floor !== null && from < this.floor) throw forbidden(this.floor);
    const last = minDay(to, this.through);
    let pageStart = from;
    while (pageStart <= last) {
      this.pagesServed += 1;
      if (this.budgetOnPage === this.pagesServed) {
        throw new BudgetExhaustedError('429', {
          status: 429,
          body: {},
          url: 'u',
          retryAfterMs: 2_700_000,
        });
      }
      const pageEnd = minDay(addDays(pageStart, PAGE_DAYS - 1), last);
      for (const entity of this.entities) {
        for (let day = pageStart; day <= pageEnd; day = addDays(day, 1)) {
          yield await Promise.resolve(this.entry(entity, day));
        }
      }
      const following = addDays(pageEnd, 1);
      const next =
        following <= last
          ? `https://api.themeparks.wiki/v1/entity/p/history/daily?from=${following}&to=${last}`
          : null;
      options.onPage?.({ from: pageStart, to: pageEnd, next });
      pageStart = following;
    }
  }

  entry(entity: string, day: string): DailyEntry {
    const final = this.recordedTo !== null && day <= this.recordedTo;
    return {
      entityId: entity,
      name: this.names[entity] ?? `Ride ${entity}`,
      entityType: 'ATTRACTION',
      row: {
        date: day,
        firstOperatingAt: `${day}T13:00:00Z`,
        lastClosedAt: final ? `${day}T23:00:00Z` : null,
        operatingMinutes: final ? FINAL_MINUTES : PARTIAL_MINUTES,
        downMinutes: 0,
        changes: 3,
      } as unknown as DailyEntry['row'],
    };
  }
}

const PARK = { id: 'p', name: 'Park', destination: '' };

let dir: string;
let err: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bf-incr-'));
  err = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const stderr = (): string => err.join('');

function run(
  archive: Archive,
  format: 'ndjson' | 'csv' = 'ndjson',
  window: { since?: string; until?: string } = {},
  outDir = dir,
): Promise<number> {
  const tp = { entity: () => ({ history: archive }) } as unknown as ThemeParks;
  return backfillPark(tp, PARK, { outDir, format, overwrite: false, ...window });
}

const dataPath = (format = 'ndjson', outDir = dir) => join(outDir, `p.${format}`);

interface OutRow {
  entityId: string;
  date: string;
  operatingMinutes: number;
}

/** The rows in the file. The CSV here has no quoted cells, so a split is exact. */
function rows(format: 'ndjson' | 'csv' = 'ndjson'): OutRow[] {
  const text = readFileSync(dataPath(format), 'utf8');
  if (format === 'ndjson') {
    return text
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as OutRow);
  }
  const [header, ...lines] = text.replace(/^﻿/u, '').split('\n');
  const names = header!.split(',');
  return lines
    .filter((l) => l !== '')
    .map((l) => {
      const cells = l.split(',');
      const at = (n: string) => cells[names.indexOf(n)] ?? '';
      return {
        entityId: at('entityId'),
        date: at('date'),
        operatingMinutes: Number(at('operatingMinutes')),
      };
    });
}

function state(format = 'ndjson'): Record<string, unknown> {
  return JSON.parse(readFileSync(statePathFor(dir, 'p', format), 'utf8')) as Record<
    string,
    unknown
  >;
}

function expectEveryRowFinalAndUnique(written: OutRow[]): void {
  const seen = new Map<string, number>();
  for (const r of written) {
    const key = `${r.entityId}|${r.date}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  expect(dupes, '(entityId, date) written more than once').toEqual([]);
  const partial = written.filter((r) => r.operatingMinutes !== FINAL_MINUTES).map((r) => r.date);
  expect([...new Set(partial)], 'non-final days reached the file').toEqual([]);
}

const maxDate = (written: OutRow[]) =>
  written
    .map((r) => r.date)
    .sort()
    .at(-1);
const minDate = (written: OutRow[]) => written.map((r) => r.date).sort()[0];

describe('the stub is the API', () => {
  it('serves partial days past recordedTo', async () => {
    // Guard the oracle: if the stub never served a partial row, "no partial row
    // in the file" would pass whether or not the command stops early.
    const archive = new Archive();
    const minutes: Record<string, number> = {};
    for await (const e of archive.days({ from: '2026-09-25', to: '2026-09-28' })) {
      minutes[(e.row as { date: string }).date] = (
        e.row as { operatingMinutes: number }
      ).operatingMinutes;
    }
    expect(minutes['2026-09-26']).toBe(FINAL_MINUTES);
    expect(minutes['2026-09-27']).toBe(PARTIAL_MINUTES);
    expect(minutes['2026-09-28']).toBe(PARTIAL_MINUTES);
  });
});

describe('only final days are written', () => {
  it('stops at the newest final day, and says why', async () => {
    const archive = new Archive();
    expect(await run(archive)).toBe(0);
    expect(archive.calls).toEqual([['2026-06-01', '2026-09-26']]);
    expect(maxDate(rows())).toBe('2026-09-26');
    expectEveryRowFinalAndUnique(rows());
    expect(stderr()).toContain('stopping at 2026-09-26');
    expect(state().end).toBe('2026-09-26');
    expect(state().stateVersion).toBe(STATE_VERSION);
  });

  it('the next run adds those days once they are final', async () => {
    // The other half: the days held back are not lost, they arrive on the next
    // run with their final values, once.
    const archive = new Archive();
    await run(archive);
    archive.advance(2);
    expect(await run(archive)).toBe(0);
    expect(archive.calls.at(-1)).toEqual(['2026-09-27', '2026-09-28']);
    expect(maxDate(rows())).toBe('2026-09-28');
    expectEveryRowFinalAndUnique(rows());
  });

  it('writes nothing when nothing is final yet', async () => {
    const archive = new Archive();
    archive.recordedTo = null;
    expect(await run(archive)).toBe(0);
    expect(archive.calls).toEqual([]);
    expect(existsSync(dataPath())).toBe(false);
    expect(stderr()).toContain('nothing final');
  });

  it('says nothing about stopping when everything the park has is final', async () => {
    // A park that stopped reporting: saying "stopping early" would be noise.
    const archive = new Archive('2026-06-01', '2026-08-31', '2026-08-31');
    await run(archive);
    expect(stderr()).not.toContain('stopping at');
  });
});

describe('a rerun adds new days', () => {
  it('fetches only the new final days, and leaves the rows already there alone', async () => {
    const archive = new Archive();
    await run(archive);
    const before = readFileSync(dataPath(), 'utf8');
    archive.advance(1);
    expect(await run(archive)).toBe(0);
    expect(archive.calls.at(-1)).toEqual(['2026-09-27', '2026-09-27']);
    const after = readFileSync(dataPath(), 'utf8');
    expect(after.startsWith(before), 'the rows already there changed').toBe(true);
    expect(rows()).toHaveLength(before.split('\n').length - 1 + 2); // two entities, one day
    expectEveryRowFinalAndUnique(rows());
    expect(stderr()).toContain('(new days)');
  });

  it('keeps the original start and moves the end', async () => {
    const archive = new Archive();
    await run(archive);
    archive.advance(3);
    await run(archive);
    expect(state()).toMatchObject({ start: '2026-06-01', end: '2026-09-29', complete: true });
  });

  it('asks for nothing when there is nothing new', async () => {
    const archive = new Archive();
    await run(archive);
    const before = readFileSync(dataPath());
    expect(await run(archive)).toBe(0);
    expect(archive.calls, 'asked the API again with nothing to ask for').toHaveLength(1);
    expect(readFileSync(dataPath())).toEqual(before);
    expect(stderr()).toContain('up to date');
  });

  it('a nightly cron for a week leaves no gap and no overlap', async () => {
    const archive = new Archive();
    for (let i = 0; i < 7; i += 1) {
      expect(await run(archive)).toBe(0);
      archive.advance(1);
    }
    expect(maxDate(rows())).toBe('2026-10-02');
    expectEveryRowFinalAndUnique(rows());
    const days = new Set(rows().map((r) => r.date));
    const expected = (Date.parse('2026-10-02') - Date.parse('2026-06-01')) / 86_400_000 + 1;
    expect(days.size, 'a gap or an overlap between runs').toBe(expected);
  });

  it('a CSV rerun gains no second header or BOM', async () => {
    const archive = new Archive();
    await run(archive, 'csv');
    archive.advance(2);
    await run(archive, 'csv');
    const raw = readFileSync(dataPath('csv'), 'utf8');
    expect(raw.split('﻿')).toHaveLength(2);
    expect(raw.split('parkId,')).toHaveLength(2);
    expectEveryRowFinalAndUnique(rows('csv'));
  });

  it('an interrupted rerun continues from its own start', async () => {
    // The budget runs out on the rerun's FIRST request, before any page. With no
    // page boundary and no row, the only thing saying where this run began is
    // the state file; without it the next run started over from the top of the
    // archive and appended a second copy of everything.
    const archive = new Archive();
    await run(archive);
    const before = rows().length;
    archive.advance(40);
    archive.budgetOnPage = archive.pagesServed + 1;
    expect(await run(archive)).toBe(EX_TEMPFAIL);
    expect(rows(), 'the file changed on a failed run').toHaveLength(before);
    expect(state().resumeFrom).toBe('2026-09-27');

    archive.budgetOnPage = null;
    expect(await run(archive)).toBe(0);
    expect(archive.calls.at(-1)?.[0]).toBe('2026-09-27');
    expectEveryRowFinalAndUnique(rows());
  });

  it('an interrupted rerun part-way through resumes at the page boundary', async () => {
    const archive = new Archive();
    await run(archive);
    archive.advance(40); // two pages of new days
    archive.budgetOnPage = archive.pagesServed + 2;
    expect(await run(archive)).toBe(EX_TEMPFAIL);
    expect(state().resumeFrom).toBe('2026-10-28');
    archive.budgetOnPage = null;
    expect(await run(archive)).toBe(0);
    expect(archive.calls.at(-1)?.[0]).toBe('2026-10-28');
    expectEveryRowFinalAndUnique(rows());
  });

  it('refuses a rerun whose next day is older than the key reaches, and keeps the file', async () => {
    // A cron that did not run for longer than the window, or a key that lost
    // its plan. Carrying on from the key's first day would leave a gap the state
    // file cannot describe, so the file would claim days it does not hold.
    const archive = new Archive();
    await run(archive);
    const before = readFileSync(dataPath());
    archive.advance(40);
    archive.floor = '2026-10-10';
    expect(await run(archive)).toBe(1);
    expect(readFileSync(dataPath())).toEqual(before);
    expect(stderr()).toContain('gap');
    expect(stderr()).toContain('--overwrite');
    expect(state()).toMatchObject({ end: '2026-09-26', complete: true });
  });
});

describe('--since and --until', () => {
  it('--since is where the first request starts', async () => {
    const archive = new Archive();
    expect(await run(archive, 'ndjson', { since: '2026-09-01' })).toBe(0);
    expect(archive.calls).toEqual([['2026-09-01', '2026-09-26']]);
    expect(minDate(rows())).toBe('2026-09-01');
    expect(state().start).toBe('2026-09-01');
  });

  it('--until is where it ends, and is not reported as holding days back', async () => {
    const archive = new Archive();
    await run(archive, 'ndjson', { since: '2026-07-01', until: '2026-07-31' });
    expect(archive.calls).toEqual([['2026-07-01', '2026-07-31']]);
    expect(stderr()).not.toContain('stopping at');
  });

  it('--until past the newest final day still stops at the final day', async () => {
    const archive = new Archive();
    await run(archive, 'ndjson', { until: '2026-12-31' });
    expect(archive.calls).toEqual([['2026-06-01', '2026-09-26']]);
    expectEveryRowFinalAndUnique(rows());
  });

  it('--since before the archive starts at the archive', async () => {
    const archive = new Archive();
    await run(archive, 'ndjson', { since: '2019-01-01' });
    expect(archive.calls[0]?.[0]).toBe('2026-06-01');
  });

  it("--since before the plan's floor starts at the floor", async () => {
    const archive = new Archive();
    archive.floor = '2026-08-01';
    expect(await run(archive, 'ndjson', { since: '2026-07-01' })).toBe(0);
    expect(archive.calls.map((c) => c[0])).toEqual(['2026-07-01', '2026-08-01']);
    expect(stderr()).toContain('reaches back to 2026-08-01');
  });

  it('--since after the newest final day writes nothing', async () => {
    const archive = new Archive();
    expect(await run(archive, 'ndjson', { since: '2026-09-27' })).toBe(0);
    expect(archive.calls).toEqual([]);
    expect(existsSync(dataPath())).toBe(false);
    expect(stderr()).toContain('2026-09-26');
  });

  it('the same --since on every run continues the file', async () => {
    // A cron line with a fixed --since, run nightly.
    const archive = new Archive();
    await run(archive, 'ndjson', { since: '2026-09-01' });
    archive.advance(1);
    expect(await run(archive, 'ndjson', { since: '2026-09-01' })).toBe(0);
    expect(archive.calls.at(-1)).toEqual(['2026-09-27', '2026-09-27']);
    expectEveryRowFinalAndUnique(rows());
  });

  it('the same --since before the archive is not a change', async () => {
    const archive = new Archive();
    await run(archive, 'ndjson', { since: '2019-01-01' });
    archive.advance(1);
    expect(await run(archive, 'ndjson', { since: '2019-01-01' })).toBe(0);
  });

  it('a rolling --since continues the file', async () => {
    // `--since $(date -d '-30 days' +%F)` in a cron: later every night, and
    // always inside the file, so the file just carries on.
    const archive = new Archive();
    await run(archive, 'ndjson', { since: '2026-08-27' });
    archive.advance(1);
    expect(await run(archive, 'ndjson', { since: '2026-08-28' })).toBe(0);
    expect(archive.calls.at(-1)).toEqual(['2026-09-27', '2026-09-27']);
  });

  it('an earlier --since than the file is refused, with what to do', async () => {
    // Appending older days after newer ones cannot make the file start earlier
    // without rewriting it, and pretending otherwise records a range the file
    // does not hold.
    const archive = new Archive();
    await run(archive, 'ndjson', { since: '2026-09-01' });
    const before = readFileSync(dataPath());
    expect(await run(archive, 'ndjson', { since: '2026-08-01' })).toBe(1);
    expect(readFileSync(dataPath())).toEqual(before);
    expect(stderr()).toContain('2026-09-01');
    expect(stderr()).toContain('--overwrite');
  });

  it('a --since that would leave a gap is refused', async () => {
    const archive = new Archive();
    await run(archive, 'ndjson', { until: '2026-07-31' });
    expect(await run(archive, 'ndjson', { since: '2026-09-01' })).toBe(1);
    expect(stderr()).toContain('gap');
  });

  it('an --until before the file is refused', async () => {
    const archive = new Archive();
    await run(archive, 'ndjson', { since: '2026-09-01' });
    expect(await run(archive, 'ndjson', { until: '2026-08-15' })).toBe(1);
    expect(stderr()).toContain('--overwrite');
  });

  it('--until, then no --until, extends the file', async () => {
    const archive = new Archive();
    await run(archive, 'ndjson', { until: '2026-07-31' });
    expect(await run(archive)).toBe(0);
    expect(archive.calls.at(-1)).toEqual(['2026-08-01', '2026-09-26']);
    expectEveryRowFinalAndUnique(rows());
  });

  it('an --until the file already covers is up to date', async () => {
    const archive = new Archive();
    await run(archive);
    expect(await run(archive, 'ndjson', { until: '2026-08-01' })).toBe(0);
    expect(archive.calls).toHaveLength(1);
    expect(stderr()).toContain('up to date');
  });

  it("a fixed --since before a limited plan's floor keeps working every night", async () => {
    // A free key reads 30 days, so `--since 2025-01-01` on a cron starts the
    // file at the key's first day, not at 2025-01-01. The same line the next
    // night asks for nothing the first run did not also ask for, so it must
    // carry on, not be refused for predating the file's first row.
    const archive = new Archive('2021-07-03');
    archive.floor = '2026-08-28';
    expect(await run(archive, 'ndjson', { since: '2025-01-01' })).toBe(0);
    expect(state()).toMatchObject({ start: '2026-08-28', since: '2025-01-01' });
    archive.advance(1);
    archive.floor = '2026-08-29';
    expect(await run(archive, 'ndjson', { since: '2025-01-01' })).toBe(0);
    expect(archive.calls.at(-1)).toEqual(['2026-09-27', '2026-09-27']);
    expectEveryRowFinalAndUnique(rows());
  });

  it('a --since earlier than the one the file was started with is still refused', async () => {
    const archive = new Archive('2021-07-03');
    archive.floor = '2026-08-28';
    await run(archive, 'ndjson', { since: '2025-01-01' });
    expect(await run(archive, 'ndjson', { since: '2024-01-01' })).toBe(1);
    expect(stderr()).toContain('--overwrite');
  });
});

// ---------------------------------------------------------------------------
// The command line, end to end through main() and a stubbed fetch.
// ---------------------------------------------------------------------------

describe('the command line', () => {
  const MK = '75ea578a-adc8-4116-a54d-dccb60765ef9';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  /** Answers the catalogue, coverage and an empty last page; records every URL. */
  function server() {
    const seen: string[] = [];
    const fetchFn = vi.fn((input: unknown) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/destinations')) {
        return Promise.resolve(
          json({
            destinations: [
              { id: 'd', name: 'Dest', slug: 'd', parks: [{ id: MK, name: 'Magic Kingdom' }] },
            ],
          }),
        );
      }
      if (url.includes('/history/coverage')) {
        return Promise.resolve(
          json({
            id: MK,
            name: 'Magic Kingdom',
            entityType: 'PARK',
            summary: {
              entitiesWithData: 1,
              archiveFrom: '2021-07-03',
              recordedTo: '2026-09-26',
              retrievableThrough: '2026-09-28',
              measuredOn: '2026-09-28',
            },
            fields: {},
            entities: [],
          }),
        );
      }
      const q = new URL(url).searchParams;
      return Promise.resolve(
        json({
          id: MK,
          name: 'Magic Kingdom',
          entityType: 'PARK',
          timezone: 'America/New_York',
          range: { from: q.get('from'), to: q.get('to') },
          entities: [],
          next: null,
        }),
      );
    });
    return { fetchFn, seen };
  }

  const daily = (seen: string[]) => {
    const url = seen.find((u) => u.includes('/history/daily'));
    return url === undefined ? null : new URL(url).searchParams;
  };

  it('--since and --until reach the request', async () => {
    const { fetchFn, seen } = server();
    const argv = [MK, '--since', '2025-01-01', '--until', '2025-12-31', '--out', dir];
    expect(await main([...argv, '--api-key', 'k'], { fetch: fetchFn })).toBe(0);
    expect(daily(seen)?.get('from')).toBe('2025-01-01');
    expect(daily(seen)?.get('to')).toBe('2025-12-31');
  });

  it('neither is required, and the run ends at the newest final day', async () => {
    const { fetchFn, seen } = server();
    expect(await main([MK, '--out', dir, '--api-key', 'k'], { fetch: fetchFn })).toBe(0);
    expect(daily(seen)?.get('from')).toBe('2021-07-03');
    expect(daily(seen)?.get('to')).toBe('2026-09-26');
  });

  it.each(['2025-13-01', '2025-02-30', '2025-1-1', '20250101', 'yesterday', ''])(
    'refuses %j as a day, before any request',
    async (bad) => {
      const { fetchFn, seen } = server();
      expect(
        await main([MK, '--since', bad, '--api-key', 'k', '--out', dir], { fetch: fetchFn }),
      ).toBe(2);
      expect(
        await main([MK, '--until', bad, '--api-key', 'k', '--out', dir], { fetch: fetchFn }),
      ).toBe(2);
      expect(stderr()).toContain('YYYY-MM-DD');
      expect(seen).toEqual([]);
    },
  );

  it('refuses --since after --until, before any request', async () => {
    const { fetchFn, seen } = server();
    const argv = [
      MK,
      '--since',
      '2025-06-01',
      '--until',
      '2025-05-31',
      '--api-key',
      'k',
      '--out',
      dir,
    ];
    expect(await main(argv, { fetch: fetchFn })).toBe(2);
    expect(stderr()).toContain('--since 2025-06-01 is after --until 2025-05-31');
    expect(seen).toEqual([]);
  });

  it('--help documents both, and the final-day rule', async () => {
    const out: string[] = [];
    vi.mocked(process.stdout.write).mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    expect(await main(['--help'])).toBe(0);
    const text = out.join('');
    expect(text).toContain('--since');
    expect(text).toContain('--until');
    expect(text).toContain('final');
    expect(text).toContain('again');
  });
});

// ---------------------------------------------------------------------------
// Files written by 8.3.x: their newest days may be partial.
// ---------------------------------------------------------------------------

/** A state file with the fields and values 8.3.1 writes for a finished park. */
function v1State(format: 'ndjson' | 'csv', over: Record<string, unknown> = {}): void {
  writeFileSync(
    statePathFor(dir, 'p', format),
    `${JSON.stringify({
      sdk: 'js',
      sdkVersion: '8.3.1',
      stateVersion: 1,
      columns: columnsFingerprint(format),
      format,
      start: '2026-06-01',
      end: '2026-09-28',
      lastDay: '2026-09-28',
      resumeFrom: null,
      complete: true,
      ...over,
    })}\n`,
  );
}

/** The file 8.3.1 left behind: every day through `through`, partial tail included. */
async function writeAs83(format: 'ndjson' | 'csv', archive: Archive, outDir = dir): Promise<void> {
  let text = format === 'csv' ? `﻿${CSV_COLUMNS.join(',')}\n` : '';
  for await (const entry of archive.days({ from: archive.archiveFrom, to: archive.through })) {
    text += format === 'csv' ? `${csvLine(PARK, entry)}\n` : ndjsonLine(PARK, entry);
  }
  writeFileSync(dataPath(format, outDir), text);
  archive.calls = [];
}

describe('a file 8.3 wrote is corrected once, not frozen', () => {
  it.each(['ndjson', 'csv'] as const)(
    'replaces the partial tail with final rows (%s)',
    async (format) => {
      const archive = new Archive();
      await writeAs83(format, archive);
      v1State(format);
      const partialBefore = rows(format).filter((r) => r.operatingMinutes !== FINAL_MINUTES);
      expect(partialBefore.length, 'the 8.3 file this starts from has no partial rows').toBe(4);

      expect(await run(archive, format)).toBe(0);
      // Seven days back from the old end, so every day that could have been
      // partial is fetched again, and nothing earlier is.
      expect(archive.calls).toEqual([['2026-09-22', '2026-09-26']]);
      expect(maxDate(rows(format))).toBe('2026-09-26');
      expect(minDate(rows(format))).toBe('2026-06-01');
      expectEveryRowFinalAndUnique(rows(format));
      expect(state(format).stateVersion).toBe(STATE_VERSION);

      archive.advance(2);
      await run(archive, format);
      expectEveryRowFinalAndUnique(rows(format));
    },
  );

  it('keeps the rows it keeps byte for byte, awkward names included', async () => {
    // Compared against a file written only up to the cut in the first place.
    const nasty = { 'ent-a': 'Space, "Mountain"\rFastPass\n2', 'ent-b': "=cmd|' /C calc'!A0" };
    const archive = new Archive('2026-09-01');
    archive.names = nasty;
    await writeAs83('csv', archive);
    trimAfter(dataPath('csv'), 'csv', '2026-09-21');

    const expectedDir = join(dir, 'expected');
    mkdirSync(expectedDir);
    const short = new Archive('2026-09-01', '2026-09-21', '2026-09-21');
    short.names = nasty;
    await writeAs83('csv', short, expectedDir);
    expect(readFileSync(dataPath('csv'))).toEqual(readFileSync(dataPath('csv', expectedDir)));
  });

  it('keeps an NDJSON line it cannot parse', () => {
    // Not this command's to judge: a line it cannot read is left where it is.
    writeFileSync(dataPath(), '{"date":"2026-09-01"}\n{"date":"2026-09-27"}\n{"trunc\n');
    trimAfter(dataPath(), 'ndjson', '2026-09-21');
    expect(readFileSync(dataPath(), 'utf8')).toBe('{"date":"2026-09-01"}\n{"trunc\n');
  });

  it('copies a CSV with no date column whole', () => {
    writeFileSync(dataPath('csv'), '﻿a,b\n1,2099-01-01\n');
    trimAfter(dataPath('csv'), 'csv', '2026-09-21');
    expect(readFileSync(dataPath('csv'), 'utf8')).toBe('﻿a,b\n1,2099-01-01\n');
  });

  it('trims an interrupted 8.3 run that reached its last pages too', async () => {
    const archive = new Archive();
    await writeAs83('ndjson', archive);
    v1State('ndjson', { complete: false, lastDay: '2026-09-28', resumeFrom: null });
    expect(await run(archive)).toBe(0);
    expect(archive.calls).toEqual([['2026-09-22', '2026-09-26']]);
    expectEveryRowFinalAndUnique(rows());
  });

  it('does not rewrite an old file whose newest day is long final', async () => {
    // A park that stopped reporting: its 8.3 state ends months after its last
    // row, and every row is final. Rewriting a large file to remove nothing is
    // waste, so the file is not even opened for it.
    const archive = new Archive('2026-06-01', '2026-07-31', '2026-07-31');
    await writeAs83('ndjson', archive);
    v1State('ndjson', { end: '2026-09-28', lastDay: '2026-07-31' });
    const inode = statSync(dataPath()).ino;
    expect(await run(archive)).toBe(0);
    expect(statSync(dataPath()).ino).toBe(inode);
  });

  it('resumes an interrupted 8.3 run where it stopped, when it was far from the end', async () => {
    const archive = new Archive();
    writeFileSync(dataPath(), '{"date":"2026-06-01"}\n');
    v1State('ndjson', { complete: false, lastDay: '2026-06-30', resumeFrom: '2026-07-01' });
    expect(await run(archive)).toBe(0);
    expect(archive.calls).toEqual([['2026-07-01', '2026-09-26']]);
  });

  it('starts again an anonymous 8.3 file that lies wholly inside the cut', async () => {
    // Anonymous access reads 7 days, so every row such a file holds is within
    // seven days of its end. Trimming would leave it empty, continuing from a day
    // the key can no longer read; it is fetched again instead, all final.
    const anonymous = new Archive('2026-09-22');
    await writeAs83('ndjson', anonymous);
    v1State('ndjson', { start: '2026-09-22' });
    // Two days later, the key's 7-day window has moved on past the file's start.
    const archive = new Archive('2026-06-01', '2026-09-28', '2026-09-30', '2026-09-24');
    expect(await run(archive)).toBe(0);
    expect(archive.calls.at(-1)).toEqual(['2026-09-24', '2026-09-28']);
    expect(minDate(rows())).toBe('2026-09-24');
    expectEveryRowFinalAndUnique(rows());
    expect(state()).toMatchObject({ stateVersion: STATE_VERSION, end: '2026-09-28' });
  });

  it('still refuses an old state file from the other SDK', async () => {
    const archive = new Archive();
    writeFileSync(dataPath(), '{"date":"2026-06-01"}\n');
    v1State('ndjson', { sdk: 'py' });
    expect(await run(archive)).toBe(1);
    expect(stderr()).toContain('py SDK');
  });
});

describe('a finished file written to another contract is refused', () => {
  it('does not append to a finished CSV with another column layout', async () => {
    // Found while making reruns incremental: only an UNFINISHED mismatched state
    // was refused. A finished one fell through to a fresh start, and the fresh
    // start opened the existing file in append mode: a second full copy of the
    // archive under a second header, exit 0.
    writeFileSync(dataPath('csv'), 'old,header\n1,2\n');
    writeFileSync(
      statePathFor(dir, 'p', 'csv'),
      JSON.stringify({
        sdk: 'js',
        sdkVersion: '9.9.9',
        stateVersion: STATE_VERSION,
        columns: '0000deadbeef0000',
        format: 'csv',
        start: '2026-06-01',
        end: '2026-09-20',
        lastDay: '2026-09-20',
        resumeFrom: null,
        complete: true,
      }),
    );
    const archive = new Archive();
    expect(await run(archive, 'csv')).toBe(1);
    expect(archive.calls).toEqual([]);
    expect(readFileSync(dataPath('csv'), 'utf8')).toBe('old,header\n1,2\n');
    expect(stderr()).toContain('column layout changed');
  });
});

describe('a state file with no data file beside it', () => {
  it('downloads the park again rather than continuing into a new file', async () => {
    // The state describes a file that is no longer there. Continuing would write
    // a file that starts part-way through and record it as complete.
    const archive = new Archive();
    await run(archive);
    rmSync(dataPath());
    archive.advance(1);
    expect(await run(archive)).toBe(0);
    expect(archive.calls.at(-1)?.[0]).toBe('2026-06-01');
    expect(minDate(rows())).toBe('2026-06-01');
    expectEveryRowFinalAndUnique(rows());
  });
});
