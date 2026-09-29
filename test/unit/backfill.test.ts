/**
 * The packaged back fill command: `themeparks-backfill`.
 *
 * This is the one piece of the SDK a customer runs rather than imports, usually
 * within minutes of paying, so a failure here reads as "I paid and got nothing".
 * The Python port of the same command shipped five defects that a passing suite
 * did not catch, every one of them because the test agreed with the code instead
 * of with the API. So the oracles here are real captures:
 *
 *   history_window_exceeded.json   a real 403 body, nested under `error`
 *   destinations.json              101 real destinations, 127 parks
 *   mk_park_daily_page1/2.json     two real pages of one request, verbatim
 *                                  `range` and `next`
 *
 * Nothing in this file invents an API response shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CSV_COLUMNS,
  columnsFingerprint,
  defuse,
  flushAndClose,
  statePathFor,
  run,
  csvLine,
  decide,
  isEmptyWindow,
  looksLikeId,
  main,
  ndjsonLine,
  normalize,
  printList,
  resolve as resolveParks,
  windowFloor,
  EX_TEMPFAIL,
  STATE_VERSION,
} from '../../src/backfill';
import { ApiError } from '../../src/errors';
import { PACKAGE_VERSION } from '../../src/client';
import type { DailyEntry } from '../../src/ergonomic/history';

const FIXTURES = resolvePath(__dirname, '../fixtures');

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;
}

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;
}

const DESTINATIONS = fixture('destinations.json');
const WINDOW_403 = fixture('history_window_exceeded.json');
const RATE_LIMITED = fixture('history_rate_limited.json');

const WDW = 'e957da41-3552-4cf6-b636-5babc5cbc4e5';
const MK = '75ea578a-adc8-4116-a54d-dccb60765ef9';

interface Row {
  parkId: string;
  parkName: string;
  destId: string;
  destName: string;
}

/** The catalogue the CLI builds, from the real destinations capture. */
function catalogueRows(): Row[] {
  const rows: Row[] = [];
  for (const dest of DESTINATIONS.destinations as {
    id: string;
    name: string;
    parks?: { id: string; name: string }[];
  }[]) {
    for (const park of dest.parks ?? []) {
      rows.push({ parkId: park.id, parkName: park.name, destId: dest.id, destName: dest.name });
    }
  }
  return rows;
}

const ROWS = catalogueRows();

// ---------------------------------------------------------------------------

/**
 * Write a state file this build accepts, overriding only what a test cares about.
 *
 * Built from the code's own vocabulary rather than typed out, so a test cannot
 * silently drift from the contract the code enforces.
 */
function stateFile(
  dir: string,
  over: Record<string, unknown> = {},
  park = 'p',
  format = 'ndjson',
): string {
  const path = statePathFor(dir, park, format);
  writeFileSync(
    path,
    JSON.stringify({
      sdk: 'js',
      sdkVersion: PACKAGE_VERSION,
      stateVersion: STATE_VERSION,
      columns: columnsFingerprint(format),
      format,
      start: '2025-01-01',
      end: '2026-09-28',
      lastDay: null,
      resumeFrom: null,
      complete: false,
      ...over,
    }),
  );
  return path;
}

describe('the 403 fixture is a real response, not a retyped traceback', () => {
  it('nests the window error under `error`', () => {
    // THE DEFECT THIS PINS. The Python port read `body['type']` because it was
    // written from the formatted text in a traceback, where the envelope has
    // already been stripped. It matched nothing, so the recovery never ran, and
    // nine tests passed because their fixture had been retyped from the same
    // traceback. Assert the shape against the capture, in the open, so the
    // reading code cannot be "fixed" back to the flat form.
    expect(Object.keys(WINDOW_403)).toEqual(['error']);
    const inner = WINDOW_403.error as Record<string, unknown>;
    expect(inner.type).toBe('HISTORY_WINDOW_EXCEEDED');
    expect(inner.earliestAllowedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(WINDOW_403.type).toBeUndefined();
  });
});

describe('windowFloor', () => {
  const asError = (body: unknown) =>
    new ApiError('403 Forbidden', { status: 403, body, url: 'https://api.themeparks.wiki/v1/x' });

  it('reads the floor out of the real nested body', () => {
    const floor = (WINDOW_403.error as { earliestAllowedDate: string }).earliestAllowedDate;
    expect(windowFloor(asError(WINDOW_403))).toBe(floor);
  });

  it('also accepts the flat shape', () => {
    // Tolerated deliberately: it costs one line and removes the chance of
    // making the same mistake from the other direction.
    expect(windowFloor(asError(WINDOW_403.error))).toBe(
      (WINDOW_403.error as { earliestAllowedDate: string }).earliestAllowedDate,
    );
  });

  it('ignores a different error that happens to carry a date', () => {
    // INVALID_RANGE also carries earliestAllowedDate. Clamping to it would turn
    // a bad request into a silently different one.
    expect(
      windowFloor(asError({ error: { type: 'INVALID_RANGE', earliestAllowedDate: '2026-01-01' } })),
    ).toBeNull();
  });

  it('returns null for anything that is not a window error', () => {
    expect(windowFloor(asError({ error: { type: 'HISTORY_WINDOW_EXCEEDED' } }))).toBeNull();
    expect(
      windowFloor(asError({ error: { type: 'HISTORY_WINDOW_EXCEEDED', earliestAllowedDate: '' } })),
    ).toBeNull();
    expect(windowFloor(asError('403 Forbidden'))).toBeNull();
    expect(windowFloor(asError(null))).toBeNull();
    expect(windowFloor(new Error('boom'))).toBeNull();
    expect(windowFloor(undefined)).toBeNull();
  });
});

describe('normalize', () => {
  it('folds the characters that live park names actually contain', () => {
    const names = (DESTINATIONS.destinations as { name: string }[]).map((d) => d.name);
    // Each of these is in the capture, and each one broke matching.
    expect(names).toContain('Walt Disney World® Resort');
    expect(names).toContain('Walibi Rhône-Alpes');
    expect(normalize('Walt Disney World® Resort')).toBe(normalize('Walt Disney World Resort'));
    expect(normalize('Walibi Rhône-Alpes')).toBe(normalize('walibi rhone alpes'));
    expect(normalize('Knott’s Soak City')).toBe(normalize("Knott's Soak City"));
  });

  it('matches the url slug form, because that is what people paste', () => {
    expect(normalize('walt-disney-world-resort')).toBe(normalize('Walt Disney World® Resort'));
  });
});

describe('looksLikeId', () => {
  it('accepts a uuid and rejects a name', () => {
    expect(looksLikeId(WDW)).toBe(true);
    expect(looksLikeId('Magic Kingdom Park')).toBe(false);
    expect(looksLikeId(`${WDW}x`)).toBe(false);
  });
});

describe('resolving what to back fill, against the real catalogue', () => {
  it('expands a destination id to every park in it', () => {
    const parks = resolveParks(ROWS, WDW);
    expect(parks.map((p) => p.id)).toContain(MK);
    expect(parks).toHaveLength(6);
  });

  it('expands a destination name the same way', () => {
    expect(
      resolveParks(ROWS, 'Walt Disney World Resort')
        .map((p) => p.id)
        .sort(),
    ).toEqual(
      resolveParks(ROWS, WDW)
        .map((p) => p.id)
        .sort(),
    );
  });

  it('takes a park id on its own', () => {
    const [park] = resolveParks(ROWS, MK);
    expect(park?.id).toBe(MK);
    expect(park?.name).toBe('Magic Kingdom Park');
  });

  it('takes an exact park name even when other names contain it', () => {
    const parks = resolveParks(ROWS, 'EPCOT');
    expect(parks).toHaveLength(1);
    expect(parks[0]?.id).toBe('47f90d2c-e191-4239-a466-5892ef59a88b');
  });

  it('refuses a name two live parks share, and names the destinations', () => {
    // "Disneyland Park" is Anaheim AND Paris in this capture. Picking one would
    // download the wrong park and look like it worked.
    const shared = ROWS.filter((r) => r.parkName === 'Disneyland Park');
    expect(shared.length).toBe(2);
    let message = '';
    try {
      resolveParks(ROWS, 'Disneyland Park');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('matches 2');
    expect(message).not.toContain('Hong Kong');
    for (const row of shared) {
      expect(message).toContain(row.parkId);
      expect(message).toContain(row.destName);
    }
  });

  it('passes an unlisted uuid through for the API to judge', () => {
    const unknown = '00000000-1111-2222-3333-444444444444';
    expect(resolveParks(ROWS, unknown)).toEqual([{ id: unknown, name: unknown, destination: '' }]);
  });

  it('points at --list when nothing matches', () => {
    expect(() => resolveParks(ROWS, 'Dollywoodd')).toThrow(/--list/u);
  });
});

describe('printList', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts the destination total from the whole catalogue, not the filter', () => {
    // The bug: `--list epcot` printed "all 1 parks" for a destination with six,
    // on the one line whose entire job is that number.
    expect(printList(ROWS, 'EPCOT')).toBe(0);
    const text = out.join('');
    expect(text).toContain('all 6 parks (1 shown)');
  });

  it('matches a destination by its folded name', () => {
    expect(printList(ROWS, 'walt disney world resort')).toBe(0);
    expect(out.join('')).toContain(MK);
  });

  it('exits 1 when the filter matches nothing', () => {
    expect(printList(ROWS, 'zzzz')).toBe(1);
  });
});

describe('the CSV carries every field the API sends', () => {
  it('has a column for every scalar in a real page of rows', () => {
    // THE DRIFT GATE. `unknownMinutes`, `inParkHours` and `extremeWaits` are on
    // the rows the API returns and were in none of the published schema this SDK
    // had vendored, so the CSV dropped them while NDJSON kept them. The columns
    // are generated from the spec now; this fails the build if a real response
    // ever carries a field the generated list does not.
    const page = fixture('mk_park_daily_page1.json');
    const rows = (page.entities as { days: Record<string, unknown>[] }[]).flatMap((e) => e.days);
    expect(rows.length).toBeGreaterThan(50);
    const flat = (row: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(row).flatMap(([key, value]) => {
        const name = prefix === '' ? key : `${prefix}${key[0]!.toUpperCase()}${key.slice(1)}`;
        return value !== null && typeof value === 'object'
          ? flat(value as Record<string, unknown>, name)
          : [name];
      });
    const seen = new Set(rows.flatMap((row) => flat(row)));
    const columns = new Set<string>(CSV_COLUMNS);
    expect([...seen].filter((name) => !columns.has(name))).toEqual([]);
    // And the generated list is a superset, not a coincidence: this park has no
    // single-rider queue, so those columns are in the header and in no row here.
    expect(columns.has('singleRiderP90')).toBe(true);
    expect(seen.has('singleRiderP90')).toBe(false);
  });

  it('keeps every stats block symmetric', () => {
    // Python shipped all five percentiles for standby and only p50 and max for
    // singleRider. Asymmetric, silent, and for no reason.
    const of = (prefix: string) =>
      CSV_COLUMNS.filter((c) => c.startsWith(prefix) && /(Min|P50|Mean|P90|Max)$/u.test(c)).map(
        (c) => c.slice(prefix.length),
      );
    expect(of('standby')).toEqual(['Min', 'P50', 'Mean', 'P90', 'Max']);
    expect(of('singleRider')).toEqual(of('standby'));
    expect(of('inParkHoursStandby')).toEqual(of('standby'));
    expect(of('inParkHoursSingleRider')).toEqual(of('standby'));
  });

  it('matches the Python SDK column for column', () => {
    // The same command in two languages must write the same file. Before the
    // columns were generated, this SDK wrote 32 columns and Python wrote 41, with
    // `inParkScheduledMinutes` against `inParkHoursScheduledMinutes` -- a
    // customer using both got two incompatible CSVs of the same park.
    expect(CSV_COLUMNS.slice(0, 5)).toEqual([
      'parkId',
      'parkName',
      'entityId',
      'entityName',
      'entityType',
    ]);
    expect(CSV_COLUMNS).toContain('inParkHoursScheduledMinutes');
    expect(CSV_COLUMNS).toContain('extremeWaitsSingleRider');
    expect(CSV_COLUMNS).not.toContain('inParkScheduledMinutes');
  });
});

describe('row output', () => {
  const park = { id: MK, name: 'Magic Kingdom Park', destination: 'Walt Disney World® Resort' };
  const realRow = (): Record<string, unknown> => {
    const page = fixture('mk_park_daily_page1.json');
    const entity = (page.entities as { days: Record<string, unknown>[] }[])[0];
    return entity?.days[0] as Record<string, unknown>;
  };
  const entry = (over: Partial<DailyEntry> = {}): DailyEntry =>
    ({
      entityId: 'd9d12438-d999-4482-894b-8955fdb20ccf',
      name: "it's a small world",
      entityType: 'ATTRACTION',
      row: realRow(),
      ...over,
    }) as DailyEntry;

  it('puts identity before numbers and fills every column', () => {
    const cells = csvLine(park, entry()).split(',');
    expect(cells).toHaveLength(CSV_COLUMNS.length);
    expect(cells[0]).toBe(MK);
    expect(cells[2]).toBe('d9d12438-d999-4482-894b-8955fdb20ccf');
    const at = (name: string) => cells[CSV_COLUMNS.indexOf(name as (typeof CSV_COLUMNS)[number])];
    expect(at('date')).toBe(realRow().date);
    expect(at('unknownMinutes')).toBe(String(realRow().unknownMinutes));
    const inPark = realRow().inParkHours as { scheduledMinutes: number };
    expect(at('inParkHoursScheduledMinutes')).toBe(String(inPark.scheduledMinutes));
  });

  it('quotes a name containing a comma or a quote', () => {
    const cells = csvLine({ ...park, name: 'Foo, Bar' }, entry({ name: 'He said "hi"' }));
    expect(cells).toContain('"Foo, Bar"');
    expect(cells).toContain('"He said ""hi"""');
  });

  it('writes the entity type as a plain string', () => {
    // Python emitted `EntityType.SHOW` from an enum repr, so filtering on
    // 'SHOW' matched nothing and said so in no way at all.
    expect(csvLine(park, entry({ entityType: 'SHOW' })).split(',')[4]).toBe('SHOW');
    expect(JSON.parse(ndjsonLine(park, entry({ entityType: 'SHOW' }))).entityType).toBe('SHOW');
  });

  it('names the park and entity on every ndjson row', () => {
    const row = JSON.parse(ndjsonLine(park, entry())) as Record<string, unknown>;
    expect(row.parkId).toBe(MK);
    expect(row.parkName).toBe('Magic Kingdom Park');
    expect(row.entityName).toBe("it's a small world");
    // NDJSON is lossless: the whole row, including what the schema omits.
    expect(row.inParkHours).toEqual(realRow().inParkHours);
    expect(row.unknownMinutes).toBe(realRow().unknownMinutes);
  });
});

describe('isEmptyWindow', () => {
  it('is true only when the clamped start passes the last day of data', () => {
    // Typhoon Lagoon: closed, so its data ends before a 30-day window opens.
    // Asking anyway is a 400 that killed a six-park run three parks in.
    expect(isEmptyWindow('2026-09-01', '2026-08-01')).toBe(true);
    expect(isEmptyWindow('2026-08-01', '2026-09-01')).toBe(false);
    expect(isEmptyWindow('2026-09-01', '2026-09-01')).toBe(false);
    expect(isEmptyWindow(null, '2026-09-01')).toBe(false);
    expect(isEmptyWindow('2026-09-01', null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State, which is what makes running it twice safe.
// ---------------------------------------------------------------------------

describe('decide', () => {
  let dir: string;
  let out: string;
  let state: string;
  const opts = (over: Partial<{ format: 'csv' | 'ndjson'; overwrite: boolean }> = {}) => ({
    outDir: dir,
    format: 'ndjson' as 'csv' | 'ndjson',
    overwrite: false,
    ...over,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-decide-'));
    out = join(dir, 'p.ndjson');
    state = statePathFor(dir, 'p', 'ndjson');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts at the archive floor when there is nothing there', () => {
    expect(decide(out, state, opts(), '2021-07-03', '2026-09-23')).toEqual({
      start: '2021-07-03',
      hasRows: false,
      priorStart: null,
      resumed: false,
      extending: false,
      since: '2021-07-03',
      priorLastDay: null,
    });
  });

  it('asks for nothing and exits 0 when a finished park has no new final day', () => {
    writeFileSync(out, '{"a":1}\n');
    stateFile(dir, {
      start: '2021-07-03',
      end: '2026-09-23',
      lastDay: '2026-09-23',
      resumeFrom: null,
      complete: true,
    });
    expect(decide(out, state, opts(), '2021-07-03', '2026-09-23')).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('{"a":1}\n');
  });

  it('refuses a file with rows and no state beside it', () => {
    // Appending would double someone's data; truncating would destroy it.
    writeFileSync(out, '{"a":1}\n');
    expect(decide(out, state, opts(), '2021-07-03', '2026-09-23')).toBe(1);
    expect(readFileSync(out, 'utf8')).toBe('{"a":1}\n');
  });

  it('refuses to switch format part-way through a park', () => {
    writeFileSync(join(dir, 'p.csv'), 'a\n1\n');
    stateFile(dir, {
      start: '2021-07-03',
      end: '2026-09-23',
      lastDay: '2024-01-01',
      resumeFrom: '2024-01-02',
      complete: false,
    });
    expect(
      decide(join(dir, 'p.csv'), state, opts({ format: 'csv' }), '2021-07-03', '2026-09-23'),
    ).toBe(1);
  });

  it('resumes from the page boundary, not the newest row', () => {
    // THE DEFECT. `lastDay` is the newest row written; the page it came from
    // covered further, because an entity that stopped reporting has no rows for
    // the tail days. Resuming at lastDay re-fetches a day already in the file
    // and duplicates every row of it -- on the exit-75 path, which is the
    // ordinary path for a long back fill.
    writeFileSync(out, '{"a":1}\n');
    stateFile(dir, {
      start: '2021-07-03',
      end: '2026-09-23',
      lastDay: '2026-08-30',
      resumeFrom: '2026-09-01',
      complete: false,
    });
    expect(decide(out, state, opts(), '2021-07-03', '2026-09-23')).toMatchObject({
      start: '2026-09-01',
      hasRows: true,
      priorStart: '2021-07-03',
      resumed: true,
      extending: false,
    });
  });

  it('falls back to lastDay for a state file written before resumeFrom existed', () => {
    // One duplicated day beats starting from the top and appending a second
    // copy of the whole archive.
    writeFileSync(out, '{"a":1}\n');
    stateFile(dir, {
      start: '2021-07-03',
      end: '2026-09-23',
      lastDay: '2026-08-30',
      complete: false,
    });
    expect(decide(out, state, opts(), '2021-07-03', '2026-09-23')).toMatchObject({
      start: '2026-08-30',
      hasRows: true,
    });
  });

  it('treats corrupt state as a file it must not touch', () => {
    writeFileSync(out, '{"a":1}\n');
    writeFileSync(state, 'not json');
    expect(decide(out, state, opts(), '2021-07-03', '2026-09-23')).toBe(1);
  });

  it('--overwrite clears both files first', () => {
    writeFileSync(out, '{"a":1}\n');
    stateFile(dir, { complete: true });
    expect(decide(out, state, opts({ overwrite: true }), '2021-07-03', '2026-09-23')).toMatchObject(
      {
        start: '2021-07-03',
        hasRows: false,
        priorStart: null,
        resumed: false,
      },
    );
    expect(existsSync(out)).toBe(false);
    expect(existsSync(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End to end, through main(), against the real pages.
// ---------------------------------------------------------------------------

describe('a whole run', () => {
  let dir: string;
  let err: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-run-'));
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

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  /**
   * The hourly history budget's refusal, headers and all. The header is what
   * makes it a budget rather than a blip: under maxWaitMs the SDK waits it out,
   * over it the caller is told to checkpoint, and exit 75 is that distinction.
   */
  const budgetSpent = () =>
    json(RATE_LIMITED, 429, {
      'retry-after': String((RATE_LIMITED.error as { retryAfter: number }).retryAfter),
    });

  /**
   * A fetch that answers the four URLs the command uses, from real captures.
   * `daily` decides what each successive daily call returns.
   */
  async function server(options: {
    daily: (url: string, call: number) => Response | Promise<Response>;
    coverage?: Record<string, unknown>;
  }) {
    const coverage = options.coverage ?? (await loadFixture('mk_history_coverage.json'));
    let calls = 0;
    const seen: string[] = [];
    const fetchFn = vi.fn((input: unknown) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/destinations')) return Promise.resolve(json(DESTINATIONS));
      if (url.includes('/history/coverage')) return Promise.resolve(json(coverage));
      if (url.includes('/history/daily')) {
        calls += 1;
        return Promise.resolve(options.daily(url, calls));
      }
      return Promise.resolve(json({ error: { type: 'NOT_FOUND' } }, 404));
    });
    return { fetchFn, seen, calls: () => calls };
  }

  it('checkpoints the page boundary the server gave, not the newest row', async () => {
    // Page 1 covers 2026-08-01..08-31 and its newest ROW is 08-31, but two of
    // its three entities stop at 08-30. The server says carry on at 09-01.
    // Page 2 then fails on the budget, so the state file is the checkpoint a
    // rerun uses -- and it must say 09-01.
    const page1 = await loadFixture('mk_park_daily_page1.json');
    const { fetchFn, calls } = await server({
      daily: (_url, call) => (call === 1 ? json(page1) : budgetSpent()),
    });
    const code = await mainWith(fetchFn, [MK, '--out', dir]);
    expect(code).toBe(EX_TEMPFAIL);
    expect(calls()).toBe(2);
    const state = JSON.parse(readFileSync(statePathFor(dir, MK, 'ndjson'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(state.resumeFrom).toBe('2026-09-01');
    expect(state.lastDay).toBe('2026-08-31');
    expect(state.complete).toBe(false);
    const written = readFileSync(join(dir, `${MK}.ndjson`), 'utf8')
      .trim()
      .split('\n');
    expect(written).toHaveLength(64);
  });

  it('a rerun asks for the checkpoint day and appends without duplicating', async () => {
    const page1 = await loadFixture('mk_park_daily_page1.json');
    const page2 = await loadFixture('mk_park_daily_page2.json');
    const first = await server({
      daily: (_url, call) => (call === 1 ? json(page1) : budgetSpent()),
    });
    expect(await mainWith(first.fetchFn, [MK, '--out', dir])).toBe(EX_TEMPFAIL);
    const after1 = readFileSync(join(dir, `${MK}.ndjson`), 'utf8')
      .trim()
      .split('\n').length;

    const second = await server({ daily: () => json(page2) });
    expect(await mainWith(second.fetchFn, [MK, '--out', dir])).toBe(0);
    const dailyUrl = second.seen.find((u) => u.includes('/history/daily')) ?? '';
    expect(new URL(dailyUrl).searchParams.get('from')).toBe('2026-09-01');

    const lines = readFileSync(join(dir, `${MK}.ndjson`), 'utf8')
      .trim()
      .split('\n');
    expect(lines.length).toBe(after1 + 44);
    const keys = lines.map((l) => {
      const row = JSON.parse(l) as { entityId: string; date: string };
      return `${row.entityId}|${row.date}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      (
        JSON.parse(readFileSync(statePathFor(dir, MK, 'ndjson'), 'utf8')) as {
          complete: boolean;
        }
      ).complete,
    ).toBe(true);
  });

  it('writes one CSV header even when the 403 recovery restarts the stream', async () => {
    // The Python bug: the writer was built inside the retried closure with
    // `written === 0` in the predicate, and the recovery runs exactly when that
    // is true. Every CSV on every plan short of the full archive got two header
    // rows and pandas read the second as data.
    const page2 = await loadFixture('mk_park_daily_page2.json');
    const { fetchFn } = await server({
      daily: (_url, call) => (call === 1 ? json(WINDOW_403, 403) : json(page2)),
    });
    expect(await mainWith(fetchFn, [MK, '--format', 'csv', '--out', dir])).toBe(0);
    const lines = readFileSync(join(dir, `${MK}.csv`), 'utf8')
      .trim()
      .split('\n');
    expect(lines.filter((l) => l.startsWith('parkId,'))).toHaveLength(1);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(45);
    expect(err.join('')).toContain('reaches back to');
  });

  it('skips a park whose data ends before the window opens, leaving no file', async () => {
    const coverage = (await loadFixture('mk_history_coverage.json')) as {
      summary: Record<string, unknown>;
    };
    coverage.summary.archiveFrom = '2019-01-01';
    coverage.summary.retrievableThrough = '2020-03-15';
    const { fetchFn } = await server({
      coverage: coverage as unknown as Record<string, unknown>,
      daily: () => json(WINDOW_403, 403),
    });
    expect(await mainWith(fetchFn, [MK, '--out', dir])).toBe(0);
    expect(err.join('')).toContain('nothing in your window');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a destination back fills every park in it, one file each', async () => {
    const page2 = await loadFixture('mk_park_daily_page2.json');
    const { fetchFn } = await server({ daily: () => json(page2) });
    expect(await mainWith(fetchFn, [WDW, '--out', dir])).toBe(0);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
    expect(files).toHaveLength(6);
  });

  it('carries on to the next park when one fails, and names what did not finish', async () => {
    // One park's 500 used to throw straight out of main, so the parks after it
    // were never attempted: a customer paying for the archive got a partial
    // download and a traceback that did not say which parks were missing.
    // 400 rather than 500 because a 500 is retried, and this is about what
    // happens when the retries are spent.
    const page2 = await loadFixture('mk_park_daily_page2.json');
    const doomed = '1c84a229-8862-4648-9c71-378ddd2c7693'; // Animal Kingdom
    const { fetchFn } = await server({
      daily: (url) =>
        url.includes(doomed) ? json({ error: { type: 'INVALID_RANGE' } }, 400) : json(page2),
    });
    const code = await mainWith(fetchFn, [WDW, '--out', dir]);
    expect(code).toBe(1);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
    expect(files).toHaveLength(5);
    expect(files).not.toContain(`${doomed}.ndjson`);
    const text = err.join('');
    expect(text).toContain('1 of 6 did not finish');
    expect(text).toContain("Disney's Animal Kingdom Theme Park");
  });

  it('a spent budget on the coverage call is exit 75, not a traceback', async () => {
    // The most likely path after any exit 75: the rerun's first request is
    // coverage, and the window is still shut. In Python this escaped the
    // handler and exited 1, so a scheduler alerted instead of retrying.
    const fetchFn = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes('/destinations')) return Promise.resolve(json(DESTINATIONS));
      return Promise.resolve(
        new Response(JSON.stringify(RATE_LIMITED), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String((RATE_LIMITED.error as { retryAfter: number }).retryAfter),
          },
        }),
      );
    });
    expect(await mainWith(fetchFn, [MK, '--out', dir])).toBe(EX_TEMPFAIL);
    expect(err.join('')).toContain('budget');
  });

  it('a second run of a finished park changes nothing', async () => {
    const page2 = await loadFixture('mk_park_daily_page2.json');
    const first = await server({ daily: () => json(page2) });
    expect(await mainWith(first.fetchFn, [MK, '--out', dir])).toBe(0);
    const before = readFileSync(join(dir, `${MK}.ndjson`), 'utf8');
    const second = await server({ daily: () => json(page2) });
    expect(await mainWith(second.fetchFn, [MK, '--out', dir])).toBe(0);
    expect(readFileSync(join(dir, `${MK}.ndjson`), 'utf8')).toBe(before);
    expect(second.calls()).toBe(0);
    expect(err.join('')).toContain('up to date');
  });

  it('a typo exits 1 with the listing hint and no traceback', async () => {
    const { fetchFn } = await server({ daily: () => json({}, 500) });
    expect(await mainWith(fetchFn, ['Dollywoodd', '--out', dir])).toBe(1);
    expect(err.join('')).toContain('--list');
  });
});

/** main() with a stubbed transport. */
async function mainWith(fetchFn: unknown, argv: string[]): Promise<number> {
  return main([...argv, '--api-key', 'test-key'], { fetch: fetchFn });
}

describe('what the command tells the server it is', () => {
  it('names itself and the SDK version, not one or the other', async () => {
    // It used to send `themeparks-backfill/1`: a hardcoded 1, and it replaced
    // the SDK's own user agent, so a support question about a bad download had
    // no version to work from at either end.
    const seen: string[] = [];
    const fetchFn = vi.fn((_url: unknown, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers?.['user-agent'] ?? '');
      return Promise.resolve(
        new Response(JSON.stringify(DESTINATIONS), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await main(['--list', 'epcot'], { fetch: fetchFn });
    vi.restoreAllMocks();
    expect(seen[0]).toBe(
      `themeparks-backfill/${PACKAGE_VERSION} themeparks-sdk-js/${PACKAGE_VERSION}`,
    );
  });

  it('--version names the command as well as the version', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      out.push(String(c));
      return true;
    });
    const code = await main(['--version']);
    vi.restoreAllMocks();
    expect(code).toBe(0);
    // A bare `8.3.0` cannot be pasted into a bug report, and the Python SDK
    // prints `themeparks-backfill 3.4.0`.
    expect(out.join('').trim()).toBe(`themeparks-backfill ${PACKAGE_VERSION}`);
  });
});

describe('run', () => {
  it('turns a named failure into a sentence and an exit code', async () => {
    // The executable is `src/backfill-cli.ts`, which does nothing but call this.
    // The previous version put this logic behind an `import.meta.url ===
    // pathToFileURL(process.argv[1])` guard, which is false for an installed
    // binary because npm symlinks it into node_modules/.bin -- so the whole
    // command silently did nothing. `scripts/check-package.ts` is the gate for
    // that; this is the gate for what it does once it runs.
    const err: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      err.push(String(c));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { type: 'NOT_FOUND' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    // A uuid that resolves to nothing: byId passes it through for the API to
    // judge, which used to reach the customer as a raw stack.
    const code = await run(['00000000-1111-2222-3333-444444444444', '--api-key', 'k'], {
      fetch: fetchFn,
    });
    vi.restoreAllMocks();
    expect(code).toBe(1);
    expect(fetchFn).toHaveBeenCalled();
    expect(err.join('')).not.toContain('at Object.');
  });
});

describe('the CSV contract shared with the Python SDK', () => {
  it('matches the checked-in contract column for column', () => {
    // `themeparks-backfill` is ONE COMMAND WITH TWO IMPLEMENTATIONS. This SDK wrote
    // 32 columns while Python wrote 41, and `inParkScheduledMinutes` against
    // `inParkHoursScheduledMinutes` -- a customer using both got two incompatible
    // CSVs of the same park. The test that claimed to check it compared four
    // strings. Both repos hold an identical copy of this fixture and assert
    // against it, so a change in one turns red in the other.
    const contract = fixture('csv_contract.json') as unknown as {
      fingerprint: string;
      columns: string[];
    };
    expect([...CSV_COLUMNS]).toEqual(contract.columns);
    expect(columnsFingerprint('csv')).toBe(contract.fingerprint);
  });

  it('the fingerprint tracks the real header', () => {
    // Guard the guard: a constant would refuse nothing and agree with everything.
    expect(columnsFingerprint('csv')).toHaveLength(16);
    expect(columnsFingerprint('ndjson')).toBe('');
  });
});

describe('a failed write is never reported as success', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-write-'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  it('an unwritable output file fails the park instead of printing done', async () => {
    // Node hands `end`'s callback the stream's error as `cb(err)`; `finish()` took
    // no arguments and called `done()` regardless, so a failed stream resolved,
    // `record(true)` ran, and the command printed `done: N rows` and exited 0 with
    // the file truncated. On ENOSPC mid-download that is a short file marked
    // complete, which no rerun would ever continue.
    const page = await loadFixture('mk_park_daily_page2.json');
    const coverage = await loadFixture('mk_history_coverage.json');
    const fetchFn = vi.fn((input: unknown) => {
      const url = String(input);
      const body = url.includes('/history/coverage')
        ? coverage
        : url.includes('/history/daily')
          ? page
          : DESTINATIONS;
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      );
    });
    // A read-only directory: the stream cannot be created or written.
    chmodSync(dir, 0o500);
    const code = await main([MK, '--out', dir, '--api-key', 'k'], { fetch: fetchFn });
    expect(code).not.toBe(0);
    // And no state file claiming the park finished.
    const state = statePathFor(dir, MK, 'ndjson');
    if (existsSync(state)) {
      expect((JSON.parse(readFileSync(state, 'utf8')) as { complete: boolean }).complete).toBe(
        false,
      );
    }
  });

  it('an unwritable data file in a writable directory fails the park cleanly', async () => {
    // Node hands `end`'s callback the stream's error as `cb(err)`; `finish()` took
    // no arguments and called `done()` regardless, so a failed stream resolved,
    // `record(true)` ran, and the command printed `done: N rows` and exited 0 with
    // the file truncated. On ENOSPC mid-download that is a short file marked
    // complete, which no rerun would ever continue.
    const page = await loadFixture('mk_park_daily_page2.json');
    const coverage = await loadFixture('mk_history_coverage.json');
    const fetchFn = vi.fn((input: unknown) => {
      const url = String(input);
      const body = url.includes('/history/coverage')
        ? coverage
        : url.includes('/history/daily')
          ? page
          : DESTINATIONS;
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      );
    });
    // The directory takes the lock and the state; only the data file refuses.
    // The stream's open fails asynchronously, so without an 'error' listener
    // this is an uncaught exception rather than a failed park.
    writeFileSync(join(dir, `${MK}.ndjson`), '');
    chmodSync(join(dir, `${MK}.ndjson`), 0o400);
    const code = await main([MK, '--out', dir, '--api-key', 'k'], { fetch: fetchFn });
    expect(code).not.toBe(0);
    // And no state file claiming the park finished.
    const state = statePathFor(dir, MK, 'ndjson');
    if (existsSync(state)) {
      expect((JSON.parse(readFileSync(state, 'utf8')) as { complete: boolean }).complete).toBe(
        false,
      );
    }
  });
});

describe('an earlier run’s rows are never deleted', () => {
  let dir: string;
  let err: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-keep-'));
    err = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      err.push(String(c));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const partial = () => {
    writeFileSync(join(dir, `${MK}.ndjson`), '{"row":1}\n{"row":2}\n');
    stateFile(dir, { lastDay: '2026-08-30', resumeFrom: '2026-09-01' }, MK, 'ndjson');
  };

  const server = (dailyStatus: number, coverage: Record<string, unknown>) =>
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes('/destinations'))
        return Promise.resolve(
          new Response(JSON.stringify(DESTINATIONS), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      if (url.includes('/history/coverage'))
        return Promise.resolve(
          new Response(JSON.stringify(coverage), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      return Promise.resolve(
        new Response(JSON.stringify({ error: { type: 'INVALID_RANGE' } }), {
          status: dailyStatus,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

  it('keeps the file when a resumed run fails before writing a row', async () => {
    // `written === 0` means "this process wrote nothing", which on a resumed run is
    // not "the file is empty". Deleting it destroyed the archive and left the state
    // pointing mid-range, so the next run appended only the tail and recorded
    // complete.
    partial();
    const coverage = await loadFixture('mk_history_coverage.json');
    const code = await main([MK, '--out', dir, '--api-key', 'k'], {
      fetch: server(400, coverage),
    });
    expect(code).toBe(1);
    expect(existsSync(join(dir, `${MK}.ndjson`))).toBe(true);
    expect(
      readFileSync(join(dir, `${MK}.ndjson`), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(2);
  });

  it('keeps the file when the window closes under a resumed run, and fails', async () => {
    // A key rotated out of a cron's environment, or a lapsed subscription. Deleting
    // and exiting 0 made the scheduler log success and left a permanent trap.
    partial();
    const coverage = (await loadFixture('mk_history_coverage.json')) as {
      summary: Record<string, unknown>;
    };
    coverage.summary.archiveFrom = '2019-01-01';
    coverage.summary.retrievableThrough = '2020-03-15';
    const code = await main([MK, '--out', dir, '--api-key', 'k'], {
      fetch: server(200, coverage as unknown as Record<string, unknown>),
    });
    expect(code).toBe(1);
    expect(existsSync(join(dir, `${MK}.ndjson`))).toBe(true);
    expect(err.join('')).toContain('left alone');
  });
});

describe('a state file this build cannot resume', () => {
  let dir: string;
  let err: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-state-'));
    err = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      err.push(String(c));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const opts = (format: 'csv' | 'ndjson' = 'ndjson') => ({ outDir: dir, format, overwrite: false });

  it('refuses a different column layout rather than appending under the old header', () => {
    writeFileSync(join(dir, 'p.csv'), 'old,header\n1,2\n');
    stateFile(dir, { columns: '0000deadbeef0000', lastDay: '2026-08-30' }, 'p', 'csv');
    expect(
      decide(
        join(dir, 'p.csv'),
        statePathFor(dir, 'p', 'csv'),
        opts('csv'),
        '2021-07-03',
        '2026-09-23',
      ),
    ).toBe(1);
    expect(err.join('')).toContain('column layout changed');
  });

  it('refuses a state file from the other SDK', () => {
    // Same filename, and format/start/end/complete spelled identically, so the safe
    // paths interoperated and nothing warned -- while a Python run interrupted at 64
    // rows and resumed here produced 172 rows, 64 duplicated, marked complete.
    writeFileSync(join(dir, 'p.ndjson'), '{"a":1}\n');
    stateFile(dir, { sdk: 'py', lastDay: '2026-08-30' });
    expect(
      decide(
        join(dir, 'p.ndjson'),
        statePathFor(dir, 'p', 'ndjson'),
        opts(),
        '2021-07-03',
        '2026-09-23',
      ),
    ).toBe(1);
    expect(err.join('')).toContain('py SDK');
  });

  it('refuses a future state version', () => {
    writeFileSync(join(dir, 'p.ndjson'), '{"a":1}\n');
    stateFile(dir, { stateVersion: 99, lastDay: '2026-08-30' });
    expect(
      decide(
        join(dir, 'p.ndjson'),
        statePathFor(dir, 'p', 'ndjson'),
        opts(),
        '2021-07-03',
        '2026-09-23',
      ),
    ).toBe(1);
    expect(err.join('')).toContain('different version');
  });

  it('gives each format its own state file', () => {
    expect(statePathFor(dir, 'p', 'csv')).not.toBe(statePathFor(dir, 'p', 'ndjson'));
    expect(statePathFor(dir, 'p', 'csv')).toContain('p.csv.backfill-state.json');
  });
});

describe('flushAndClose', () => {
  it('rejects with the error Node hands the end callback', async () => {
    // The shipped version took no arguments and called done() regardless, so a
    // failed stream resolved and the park was recorded complete.
    const boom = new Error('EACCES: permission denied');
    await expect(flushAndClose({ end: (cb) => cb(boom) }, () => null)).rejects.toThrow('EACCES');
  });

  it('rejects with an error the stream reported earlier, even if end succeeds', async () => {
    // `write()` never throws synchronously, so the failure can arrive on the
    // 'error' event long before the flush. Either route has to fail the park.
    const earlier = new Error('ENOSPC: no space left on device');
    await expect(flushAndClose({ end: (cb) => cb(null) }, () => earlier)).rejects.toThrow('ENOSPC');
  });

  it('resolves when the stream closed cleanly', async () => {
    await expect(flushAndClose({ end: (cb) => cb(null) }, () => null)).resolves.toBeUndefined();
  });
});

describe('the spreadsheet is the reader', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-sheet-'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  async function writeCsv(entityName?: string): Promise<Buffer> {
    const page = (await loadFixture('mk_park_daily_page2.json')) as {
      entities: { name: string }[];
    };
    if (entityName !== undefined) page.entities[0]!.name = entityName;
    const coverage = await loadFixture('mk_history_coverage.json');
    const fetchFn = vi.fn((input: unknown) => {
      const url = String(input);
      const body = url.includes('/history/coverage')
        ? coverage
        : url.includes('/history/daily')
          ? page
          : DESTINATIONS;
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      );
    });
    const code = await main([MK, '--format', 'csv', '--out', dir, '--api-key', 'k'], {
      fetch: fetchFn,
    });
    expect(code).toBe(0);
    return readFileSync(join(dir, `${MK}.csv`));
  }

  it('starts the file with a single UTF-8 BOM', async () => {
    // Without it Excel on Windows reads the local code page and renders
    // `Walt Disney World® Resort` as mojibake.
    const raw = await writeCsv();
    expect(raw.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(
      [...raw].filter((_b, i) => raw.subarray(i, i + 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))),
    ).toHaveLength(1);
  });

  it('quotes a carriage return so one row cannot become two', async () => {
    // A bare CR went through unquoted: one row parsed as two with every later
    // column shifted, and Python quoted it, so the files diverged as well.
    const text = (await writeCsv('Space Mountain\rFastPass')).toString('utf8').replace(/^﻿/u, '');
    expect(text).toContain('"Space Mountain\rFastPass"');
    const rows = text
      .trim()
      .split('\n')
      .filter((l) => !l.includes('\r') || l.startsWith('"'));
    expect(rows.length).toBeGreaterThan(1);
  });

  it('defuses a name a spreadsheet would execute', async () => {
    const text = (await writeCsv("=cmd|' /C calc'!A0")).toString('utf8');
    expect(text).toContain("'=cmd");
  });
});

describe('defuse', () => {
  it('prefixes what a spreadsheet would run', () => {
    expect(defuse('=1+1')).toBe("'=1+1");
    expect(defuse('@SUM(1)')).toBe("'@SUM(1)");
    expect(defuse('\tx')).toBe("'\tx");
    expect(defuse('\rx')).toBe("'\rx");
  });

  it('leaves a number a number', () => {
    // The reason this is not a bare test of the leading character: prefixing `-5`
    // turns every negative value in the file into text.
    expect(defuse('-5')).toBe('-5');
    expect(defuse('-5.25')).toBe('-5.25');
    expect(defuse('+1')).toBe('+1');
    expect(defuse('1e-7')).toBe('1e-7');
    expect(defuse('.5')).toBe('.5');
  });

  it('agrees with the Python SDK on the awkward cases', () => {
    // `Number('\t')` is 0, so a naive numeric test leaves a tab-led cell
    // undefended here and defended there, for a file both claim to write
    // identically. Both use the same strict pattern.
    expect(defuse('\t5')).toBe("'\t5");
    expect(defuse('+')).toBe("'+");
    expect(defuse('-')).toBe("'-");
    expect(defuse('Walt Disney World® Resort')).toBe('Walt Disney World® Resort');
  });
});

describe('argument handling', () => {
  let out: string[];
  let err: string[];
  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      out.push(String(c));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      err.push(String(c));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dests = () =>
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(DESTINATIONS), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

  it('accepts a bare --list, as the help says it does', async () => {
    // `type: 'string'` made this "argument missing" and exit 2, while the help
    // advertised `--list [TEXT]` and the Python SDK listed everything.
    expect(await main(['--list'], { fetch: dests() })).toBe(0);
    expect(out.join('').split('\n').length).toBeGreaterThan(100);
  });

  it('still takes a filter, and does not eat the next flag', async () => {
    expect(await main(['--list', 'epcot'], { fetch: dests() })).toBe(0);
    expect(out.join('')).toContain('all 6 parks (1 shown)');
    out.length = 0;
    expect(await main(['--list', '--api-key', 'k'], { fetch: dests() })).toBe(0);
    expect(out.join('').split('\n').length).toBeGreaterThan(100);
  });

  it('accepts -h', async () => {
    expect(await main(['-h'])).toBe(0);
    expect(out.join('')).toContain('themeparks-backfill');
  });

  it('asks which park before spending a request', async () => {
    // This fetched /destinations first, so no arguments and no network exited 75:
    // telling a scheduler to retry a command that can never succeed.
    const fetchFn = dests();
    expect(await main([], { fetch: fetchFn })).toBe(2);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('treats an empty API key as no key', async () => {
    // `THEMEPARKS_API_KEY=""` is a clobbered env var in a cron file, which is how
    // this happens; it read as a key and the anonymous notice never printed. Not
    // via --list, which suppresses the notice deliberately: listing works without
    // a key and saying so there would be noise.
    const fetchFn = vi.fn((input: unknown) =>
      Promise.resolve(
        String(input).includes('/destinations')
          ? new Response(JSON.stringify(DESTINATIONS), {
              headers: { 'content-type': 'application/json' },
            })
          : new Response(JSON.stringify({ error: { type: 'NOT_FOUND' } }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            }),
      ),
    );
    const dir = mkdtempSync(join(tmpdir(), 'bf-key-'));
    try {
      await main([MK, '--out', dir, '--api-key', ''], { fetch: fetchFn });
      expect(err.join('')).toContain('no API key');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists an ambiguous name by park name, not by uuid', async () => {
    // Sorting the formatted line sorts by the uuid it starts with, so ten
    // "Hurricane Harbor" parks came back in an order that looks random.
    expect(await main(['Hurricane Harbor', '--api-key', 'k'], { fetch: dests() })).toBe(1);
    const listed = err
      .join('')
      .split('\n')
      .filter((l) => /^ {2}[0-9a-f]{8}-/u.test(l));
    expect(listed.length).toBeGreaterThan(5);
    const names = listed.map((l) => l.split('  ')[2] ?? '');
    expect(names).toEqual([...names].sort());
  });

  it('matches nothing for a query that folds to nothing', async () => {
    // normalize('東京') is '', and ''.includes is true of every string, so this
    // listed all 127 parks as candidates.
    expect(await main(['東京', '--api-key', 'k'], { fetch: dests() })).toBe(1);
    expect(err.join('')).toContain('no park or destination matching');
  });
});

describe('an anonymous run says so when it finishes', () => {
  // The notice at the START scrolls away under a run that takes minutes, and the
  // last thing on screen is `done: 433 rows` — which for a customer who thought
  // they were downloading five years is indistinguishable from success. Running
  // the documented example without a key gives 433 rows of Magic Kingdom instead
  // of ~94,000, and exits 0.
  let dir: string;
  let err: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-anon-'));
    err = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      err.push(String(c));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const server = async () => {
    const page = await loadFixture('mk_park_daily_page2.json');
    const coverage = await loadFixture('mk_history_coverage.json');
    return vi.fn((input: unknown) => {
      const url = String(input);
      const body = url.includes('/history/coverage')
        ? coverage
        : url.includes('/history/daily')
          ? page
          : DESTINATIONS;
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      );
    });
  };

  it('says it at the end as well as the start', async () => {
    const previous = process.env.THEMEPARKS_API_KEY;
    delete process.env.THEMEPARKS_API_KEY;
    try {
      expect(await main([MK, '--out', dir], { fetch: await server() })).toBe(0);
    } finally {
      if (previous !== undefined) process.env.THEMEPARKS_API_KEY = previous;
    }
    const text = err.join('');
    expect(text).toContain('ANONYMOUS ACCESS');
    // Both ends: before, so it can be acted on, and after, so it is read.
    expect(text.split('7 days').length - 1).toBeGreaterThanOrEqual(2);
    expect(text.trimEnd().endsWith('keys: https://www.themeparks.wiki/profile')).toBe(true);
  });

  it('says nothing of the sort when a key was given', async () => {
    expect(await main([MK, '--out', dir, '--api-key', 'tpw_test'], { fetch: await server() })).toBe(
      0,
    );
    expect(err.join('')).not.toContain('ANONYMOUS');
    expect(err.join('')).not.toContain('no API key');
  });
});
