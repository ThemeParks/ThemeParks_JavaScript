/**
 * Download a park's whole daily history to a file, and survive the budget.
 *
 *   themeparks-backfill "Disneyland Park"
 *   npx themeparks-backfill --list disney
 *
 * The Python SDK got this as a command first, and the reason applies here
 * identically: someone following a docs link to an example
 * script, and had to work out that a library needed installing, then what the
 * arguments were, then read a traceback. A recipe you have to reconstruct is not
 * a recipe.
 *
 * What it does that is easy to get wrong by hand:
 *
 * 1. It asks the PARK, not the rides. The history endpoints answer every entity
 *    in a park in one request, so a park-level backfill of a large resort is
 *    around a hundred times fewer calls than the same data pulled ride by ride.
 *
 * 2. It bounds the range at BOTH ends. `span().retrievableThrough` is the latest
 *    day your key may ask for; there is no field for the earliest, and
 *    `archiveFrom` is where the ARCHIVE starts, which on any plan short of the
 *    full archive is before your window opens. So the first request is refused,
 *    and the floor is read out of that 403.
 *
 * 3. It records what it has written, so re-running continues an interrupted run
 *    and never appends a second copy of a finished one.
 *
 * 4. It takes names and destinations, not just park ids. A customer has
 *    "Walt Disney World Resort", not four uuids.
 */
// Several internals are exported for tests. They are not in the package's public
// surface: `bin` points at this file and `src/index.ts` does not re-export it, so
// nothing here is reachable from `import { ... } from 'themeparks'`. The
// alternative is driving every branch through argv, which is how the resolution
// layer ended up with no tests at all in the Python SDK.
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

import { DEFAULT_USER_AGENT, PACKAGE_VERSION, ThemeParks } from './client.js';
import { DAILY_COLUMNS } from './_generated/dailyColumns.js';
import type { FetchLike } from './transport.js';
import { ApiError, NetworkError, RateLimitError, TimeoutError } from './errors.js';
import {
  BudgetExhaustedError,
  type DailyEntry,
  type HistoryPage,
  type HistorySpan,
} from './ergonomic/history.js';

/** Exit code that makes a scheduler retry rather than alert. */
export const EX_TEMPFAIL = 75;
// THE FORMAT IS IN THE FILENAME, not only inside the file. One state file served
// both formats, so ndjson -> csv -> ndjson left the ndjson file with no state
// describing it: not resuming, no rows recorded, opened in append mode. Every row
// duplicated, exit 0.
const STATE_SUFFIX = '.backfill-state.json';

/** Bumped when a field changes meaning. A foreign version is refused, not guessed. */
const STATE_VERSION = 1;
const SDK_NAME = 'js';

/** Where this park's state lives, for this format. */
export function statePathFor(outDir: string, parkId: string, format: string): string {
  return join(outDir, `${parkId}.${format}${STATE_SUFFIX}`);
}

/**
 * A short hash of the exact header this build writes.
 *
 * THE HEADER IS PART OF THE RESUME CONTRACT and nothing recorded it. The Python
 * SDK's 3.3.0 wrote 19 columns in a different order and 4.0.0 writes 41; its
 * `decide` compared only the format, so 41-field rows were appended under a
 * 19-column header. Generating the column list removed the reviewed diff that
 * used to make a header change visible; this is what replaces it.
 *
 * The same string the Python SDK hashes, so the two agree by construction.
 */
export function columnsFingerprint(format: string): string {
  if (format !== 'csv') return '';
  return createHash('sha256').update(CSV_COLUMNS.join('\n')).digest('hex').slice(0, 16);
}
const USER_AGENT_PREFIX = 'themeparks-backfill';

/**
 * Fold a name to something a person could plausibly have typed.
 *
 * The live name is `Walt Disney World® Resort`, so a plain lowercase comparison
 * rejects the string a customer actually types — and that exact string is the
 * documented example. NFKD splits an accented letter into letter plus combining
 * mark, the mark is dropped, and every non-alphanumeric goes, so ®, apostrophes
 * of either kind, spaces and hyphens stop mattering. The URL slug form matches
 * for free, and slugs are what people copy out of an address bar.
 */
export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]/gu, '');
}

/**
 * The day a paged history URL starts on, or null if it does not say.
 *
 * The server hands back a whole `next` URL and the SDK follows it verbatim. All
 * that is wanted here is its `from`, to write into the state file as the point a
 * later run carries on from -- a bare day, so the state stays readable and a
 * resume goes through the same code path as a first run.
 */
function nextPageFrom(next: string): string | null {
  try {
    return new URL(next).searchParams.get('from');
  } catch {
    return null;
  }
}

/** A park's identity, so rows can name themselves. */
interface Park {
  id: string;
  name: string;
  destination: string;
}

/** The earliest day this key may ask for, read out of a 403 body. */
export function windowFloor(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body: unknown = error.body;
  if (body == null || typeof body !== 'object') return null;
  // THE BODY IS NESTED. The API sends
  //   {"error": {"type": ..., "message": ..., "earliestAllowedDate": ...}}
  // and the Python SDK shipped a version of this reading the top level, because
  // it was written from the formatted text in a traceback rather than a real
  // response. It did nothing at all. Both shapes are accepted here so the same
  // mistake cannot be made from the other direction.
  const inner = (body as { error?: unknown }).error;
  const payload = (inner != null && typeof inner === 'object' ? inner : body) as {
    type?: unknown;
    earliestAllowedDate?: unknown;
  };
  if (payload.type !== 'HISTORY_WINDOW_EXCEEDED') return null;
  const floor = payload.earliestAllowedDate;
  return typeof floor === 'string' && floor !== '' ? floor : null;
}

/**
 * True when the plan's floor sits past the park's last day of data.
 *
 * `end` is the newest day the park has; the 403 recovery clamps the start UP to
 * the first day this key may read. For a park that stopped reporting before the
 * window opens — a seasonal water park — the clamp pushes start past end and the
 * API answers `400 INVALID_RANGE`. In Python that killed a six-park destination
 * run three parks in, leaving an empty file and two parks never attempted.
 */
export function isEmptyWindow(from: string | null, to: string | null): boolean {
  return to != null && from != null && from > to;
}

// ---------------------------------------------------------------------------
// Finding what to back fill, without knowing any uuid.
// ---------------------------------------------------------------------------

interface CatalogueRow {
  parkId: string;
  parkName: string;
  destId: string;
  destName: string;
}

export async function catalogue(tp: ThemeParks): Promise<CatalogueRow[]> {
  const rows: CatalogueRow[] = [];
  const { destinations } = await tp.destinations.list();
  for (const dest of destinations) {
    for (const park of dest.parks ?? []) {
      rows.push({ parkId: park.id, parkName: park.name, destId: dest.id, destName: dest.name });
    }
  }
  return rows;
}

/**
 * Whether the token after `--list` is its filter rather than the next flag.
 *
 * `--list disney` filters; `--list` alone lists everything; `--list --out x` lists
 * everything into x. A following token that starts with `-` belongs to the next
 * option, not to this one.
 */
function isFilterNext(argv: string[], i: number): boolean {
  const next = argv[i + 1];
  return next !== undefined && !next.startsWith('-');
}

/** A uuid, loosely. Loose on purpose: the API decides what is valid, not us. */
export function looksLikeId(value: string): boolean {
  return value.length === 36 && value.split('-').length === 5;
}

function byId(rows: CatalogueRow[], wanted: string): Park[] | null {
  // A destination id expands to its parks. Checked first, deliberately.
  const inDestination = rows.filter((r) => r.destId === wanted);
  if (inDestination.length > 0) return inDestination.map(toPark);
  const park = rows.find((r) => r.parkId === wanted);
  if (park) return [toPark(park)];
  // An id we do not list: a park with no destination row, an attraction, or a
  // typo. Pass it through and let the API say which.
  if (looksLikeId(wanted)) return [{ id: wanted, name: wanted, destination: '' }];
  return null;
}

function toPark(r: CatalogueRow): Park {
  return { id: r.parkId, name: r.parkName, destination: r.destName };
}

/**
 * Parks for a name, or a thrown message listing the candidates.
 *
 * Exact wins outright, so "Magic Kingdom Park" is not ambiguous merely because
 * something else contains it. A destination name expands exactly as its id does.
 * More than one match is an error that lists them: guessing between two parks
 * would quietly download the wrong one and look like it worked.
 */
function byName(rows: CatalogueRow[], wanted: string): Park[] {
  const needle = normalize(wanted);
  // A QUERY THAT FOLDS TO NOTHING MATCHES NOTHING. `normalize('東京')` is '', and
  // ''.includes is true of every string, so a CJK or Cyrillic query listed all 127
  // parks as candidates instead of saying it found none.
  if (needle === '') {
    throw new Error(
      `no park or destination matching "${wanted}".\n` +
        `  themeparks-backfill --list           everything\n` +
        `  themeparks-backfill --list disney    the ones matching "disney"`,
    );
  }
  const parksIn = (destId: string): Park[] => rows.filter((r) => r.destId === destId).map(toPark);

  const exactDest = [
    ...new Set(rows.filter((r) => normalize(r.destName) === needle).map((r) => r.destId)),
  ];
  const [onlyDest] = exactDest;
  if (exactDest.length === 1 && onlyDest !== undefined) return parksIn(onlyDest);

  const exactPark = rows.filter((r) => normalize(r.parkName) === needle);
  const [onlyPark] = exactPark;
  if (exactPark.length === 1 && onlyPark !== undefined) return [toPark(onlyPark)];

  // WHEN THE EXACT NAME IS AMBIGUOUS, the exact matches ARE the candidates.
  // "Disneyland Park" is two live parks, Anaheim and Paris; widening to
  // substrings adds Hong Kong Disneyland Park, which is not what was typed and
  // pads the one list whose job is "which of these did you mean".
  const parkHits =
    exactPark.length > 1 ? exactPark : rows.filter((r) => normalize(r.parkName).includes(needle));
  const destHits = [
    ...new Set(rows.filter((r) => normalize(r.destName).includes(needle)).map((r) => r.destId)),
  ];
  const [onlyDestHit] = destHits;
  if (destHits.length === 1 && parkHits.length === 0 && onlyDestHit !== undefined) {
    return parksIn(onlyDestHit);
  }

  // THE DESTINATION GOES IN THE LABEL, and it is load-bearing: two live parks
  // are named exactly "Disneyland Park" — Anaheim and Paris — so a list of bare
  // park names offers a choice between two identical lines.
  // A UNIQUE SUBSTRING RESOLVES. `themeparks-backfill "magic kingdom"` names exactly
  // one park, and refusing a query that is unambiguous is hostile. This threw
  // `"magic kingdom" matches 1. Pass an id` while the Python SDK downloaded it --
  // one SDK refusing what the other accepts, for four real names.
  const [onlyHit] = parkHits;
  if (parkHits.length === 1 && onlyHit !== undefined) return [toPark(onlyHit)];

  // SORTED BY PARK NAME. Sorting the formatted line sorts by the uuid it starts
  // with, so "Hurricane Harbor" -- ten live parks -- came back in an order that
  // looks random to the person reading it. The id stays first on the line because
  // the id is the part they copy.
  const candidates = (
    parkHits.length > 0
      ? parkHits.map((r) => ({
          sort: r.parkName,
          line: `  ${r.parkId}  ${r.parkName}  (${r.destName})`,
        }))
      : destHits.map((d) => {
          const name = rows.find((r) => r.destId === d)?.destName ?? d;
          return {
            sort: name,
            line: `  ${d}  ${name}  (destination, ${String(parksIn(d).length)} parks)`,
          };
        })
  )
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
    .map((c) => c.line);

  if (candidates.length === 0) {
    throw new Error(
      `no park or destination matching "${wanted}".\n` +
        `  themeparks-backfill --list           everything\n` +
        `  themeparks-backfill --list disney    the ones matching "disney"`,
    );
  }
  throw new Error(
    `"${wanted}" matches ${String(candidates.length)}. Pass one of these ids, or the ` +
      `destination name to get all of its parks:\n${candidates.join('\n')}`,
  );
}

export function resolve(rows: CatalogueRow[], wanted: string): Park[] {
  return byId(rows, wanted) ?? byName(rows, wanted);
}

export function printList(rows: CatalogueRow[], needle: string | undefined): number {
  const all = rows;
  const shown = needle
    ? rows.filter(
        (r) =>
          normalize(r.parkName).includes(normalize(needle)) ||
          normalize(r.destName).includes(normalize(needle)),
      )
    : rows;
  if (shown.length === 0) {
    process.stderr.write(`nothing matching "${needle ?? ''}"\n`);
    return 1;
  }
  const byDest = new Map<string, { name: string; parks: CatalogueRow[] }>();
  for (const r of shown) {
    const entry = byDest.get(r.destId) ?? { name: r.destName, parks: [] };
    entry.parks.push(r);
    byDest.set(r.destId, entry);
  }
  for (const [destId, entry] of [...byDest].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    // The TOTAL, counted from the unfiltered catalogue. Counting the filtered
    // rows made `--list epcot` report "all 1 parks" for a destination with six,
    // on the one line whose whole job is that number.
    const total = all.filter((r) => r.destId === destId).length;
    const shownNote = total === entry.parks.length ? '' : ` (${String(entry.parks.length)} shown)`;
    const parkWord = total === 1 ? 'park' : 'parks';
    process.stdout.write(
      `${destId}  ${entry.name}  <- destination: all ${String(total)} ${parkWord}${shownNote}\n`,
    );
    for (const p of entry.parks.sort((a, b) => a.parkName.localeCompare(b.parkName))) {
      process.stdout.write(`    ${p.parkId}  ${p.parkName}\n`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Output. Identity first, so a row says what it is before it says numbers.
// ---------------------------------------------------------------------------

/** Identity first, so a row says what it is before it says numbers. */
export const IDENTITY_COLUMNS = [
  'parkId',
  'parkName',
  'entityId',
  'entityName',
  'entityType',
] as const;

/**
 * The CSV header. The data half is GENERATED from the OpenAPI spec
 * (`src/_generated/dailyColumns.ts`), not typed out here.
 *
 * Hand-written, it had drifted three ways at once: `unknownMinutes` and the whole
 * `inParkHours` block were on every row the API returns and in no column,
 * `extremeWaits` likewise, and `singleRider` carried two of its five percentiles
 * while `standby` carried all five. Ten of thirty-six fields missing from a file
 * people pay for -- and the Python SDK's header did not match this one, so the
 * same command in two languages wrote two different files.
 */
export const CSV_COLUMNS = [...IDENTITY_COLUMNS, ...DAILY_COLUMNS] as const;

/**
 * Characters that make a spreadsheet execute a cell rather than display it.
 * Tab and CR are here because Excel strips them and reads what follows.
 */
const FORMULA_LEADERS = /^[=+\-@\t\r]/u;

/**
 * A number, strictly: no surrounding whitespace, no sign-only, no `\t5`.
 *
 * The Python SDK uses the same pattern. Testing with `Number(text)` instead would
 * call `'\t'` numeric (it is 0) and leave a tab-led cell undefended, and the two
 * SDKs would disagree about a cell they both claim to write identically.
 */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/u;

/**
 * Prefix a cell a spreadsheet would run as a formula.
 *
 * Every string that reaches a cell here comes from the API -- park and entity
 * names -- and there is no path from a command-line argument into one, so this
 * needs an upstream park feed to publish such a name. Cheap enough regardless.
 *
 * NUMERIC CELLS ARE LEFT ALONE, which is why this is not a bare test of the
 * leading character: `-5` is a number and must stay one, or every negative value
 * in the file becomes text and arithmetic breaks in the tool this protects.
 */
export function defuse(text: string): string {
  if (!FORMULA_LEADERS.test(text) || NUMERIC.test(text)) return text;
  return `'${text}`;
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  const text = defuse(String(value));
  // \r IS IN HERE NOW. Without it a bare CR went through unquoted, one row parsed
  // as two, and every later column shifted -- while Python's csv module quoted it,
  // so the two files stopped being identical as well as one being malformed.
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/**
 * A row flattened to `{column: value}` the same way the columns were generated:
 * a nested object contributes `<outer><Inner>` for each of its own keys.
 *
 * Derived from the DATA rather than from the column list, so a field the API adds
 * shows up here immediately; the test that compares this against a real capture
 * is what turns a new field into a failing build instead of a silent loss.
 */
function flatten(row: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const name = prefix === '' ? key : `${prefix}${key[0]!.toUpperCase()}${key.slice(1)}`;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Record<string, unknown>, name));
    } else {
      out[name] = value;
    }
  }
  return out;
}

export function csvLine(park: Park, entry: DailyEntry): string {
  const cells: Record<string, unknown> = {
    parkId: park.id,
    parkName: park.name,
    entityId: entry.entityId,
    entityName: entry.name,
    entityType: entry.entityType,
    ...flatten(entry.row as Record<string, unknown>),
  };
  return CSV_COLUMNS.map((c) => csvCell(cells[c])).join(',');
}

export function ndjsonLine(park: Park, entry: DailyEntry): string {
  return `${JSON.stringify({
    parkId: park.id,
    parkName: park.name,
    entityId: entry.entityId,
    entityName: entry.name,
    entityType: entry.entityType,
    ...(entry.row as Record<string, unknown>),
  })}\n`;
}

// ---------------------------------------------------------------------------
// Per-park state. One file, and it is what makes re-running safe.
// ---------------------------------------------------------------------------
//
// The Python version shipped with "finished" encoded as THE ABSENCE of a
// checkpoint file, which is indistinguishable from "never started", plus an
// always-append data file. That silently doubled the rows on a second run, made a
// destination retry re-download completed parks in full, and let a
// --format switch truncate the output with a zero exit code. The state is
// explicit here from the start.
interface BackfillState {
  sdk: string;
  sdkVersion: string;
  stateVersion: number;
  columns: string;
  format: string;
  start: string | null;
  end: string | null;
  /** Newest day written. For the human reading the file, not for resuming. */
  lastDay: string | null;
  /**
   * The day to carry on from: the `from` of the page after the last one fully
   * written, straight from the server's own `next`. Resuming at `lastDay`
   * instead re-fetches a day that is already in the file and duplicates every
   * row of it, and `(entityId, date)` stops being a key -- on the EX_TEMPFAIL
   * path, which is the ordinary path for a long back fill, not an edge case.
   */
  resumeFrom: string | null;
  complete: boolean;
}

function readState(path: string): BackfillState | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value != null && typeof value === 'object' ? (value as BackfillState) : null;
  } catch {
    // Unreadable state is treated as no state. A corrupt file must not be a
    // permanent wall the customer cannot see.
    return null;
  }
}

/**
 * Why this state file cannot be resumed by this build, or null.
 *
 * The two SDKs wrote the same filename and spelled `format`, `start`, `end` and
 * `complete` identically, differing only in `lastDay`/`resumeFrom` versus
 * `last_day`/`resume_from` -- the two keys that matter on the interrupted path.
 * So the safe paths interoperated and nothing warned, while a Python run
 * interrupted at 64 rows and resumed by this command produced 172 rows, 64 of
 * them duplicates, marked complete.
 */
function stateMismatch(state: BackfillState, format: string): string | null {
  if (state.stateVersion !== STATE_VERSION) {
    return `it was written by a different version of this command (state v${String(state.stateVersion)})`;
  }
  if (state.sdk !== SDK_NAME) {
    return `it was written by the ${String(state.sdk)} SDK, and resuming across SDKs is not supported`;
  }
  if (state.format !== format) return `it is a ${String(state.format)} run`;
  if (state.columns !== columnsFingerprint(format)) {
    return 'the column layout changed since it was written';
  }
  return null;
}

function writeState(path: string, state: BackfillState): void {
  writeFileSync(path, `${JSON.stringify(state, null, 0)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// One park.
// ---------------------------------------------------------------------------

interface RunOptions {
  outDir: string;
  format: 'ndjson' | 'csv';
  overwrite: boolean;
}

/** A plan to proceed with, or an exit code meaning do not. */
type Decision =
  | {
      start: string | null;
      hasRows: boolean;
      priorStart: string | null;
      /**
       * True when rows from an EARLIER run are already in the file. Every deletion
       * in this module must consult it: `written === 0` means "this process wrote
       * nothing", which on a resumed run is not "the file is empty".
       */
      resumed: boolean;
    }
  | number;

export function decide(
  outPath: string,
  statePath: string,
  opts: RunOptions,
  archiveFrom: string | null,
): Decision {
  if (opts.overwrite) {
    rmSync(outPath, { force: true });
    rmSync(statePath, { force: true });
  }
  const state = opts.overwrite ? null : readState(statePath);
  const fileHasRows = existsSync(outPath) && statSync(outPath).size > 0;
  const mismatch = state === null ? null : stateMismatch(state, opts.format);
  const resumable = state !== null && mismatch === null;

  if (state?.complete === true && resumable && fileHasRows) {
    process.stderr.write(
      `  already complete: ${String(state.start)} .. ${String(state.end)} ` +
        `in ${basename(outPath)} — pass --overwrite to fetch it again\n`,
    );
    return 0;
  }
  if (fileHasRows && state === null) {
    // Appending would double it; truncating would destroy someone's data.
    process.stderr.write(
      `  ${basename(outPath)} already has rows and there is no state file beside it.\n` +
        `    --overwrite   replace it\n` +
        `    or move it aside and run again\n`,
    );
    return 1;
  }
  // A state file this build cannot resume. Refusing is the only safe answer: the
  // file beside it was written to a different contract, and appending to it
  // produces a file no reader can parse, or one that parses wrongly.
  if (state !== null && mismatch !== null && state.complete !== true) {
    process.stderr.write(
      `  there is an unfinished ${basename(outPath)} beside this state file, but ${mismatch}.\n` +
        `    --overwrite   start this park again from the beginning\n` +
        `    or move both files aside and run again\n`,
    );
    return 1;
  }
  const resuming = resumable && state.complete !== true;
  // `lastDay` is the fallback for the two cases with no page boundary to use: a
  // state file written by an older version, and a run that died part-way through
  // its FIRST page. It re-fetches one day, so that day's rows appear twice --
  // bad, and still far better than starting from the top and appending a second
  // copy of everything, which is what an unconditional archiveFrom would do.
  return {
    start: (resuming ? (state.resumeFrom ?? state.lastDay) : null) ?? archiveFrom,
    hasRows: fileHasRows && resuming,
    priorStart: resuming ? state.start : null,
    resumed: resuming,
  };
}

/** The minimum of a writable stream this module needs, so a test can stand in. */
interface Closable {
  end(cb: (error?: Error | null) => void): unknown;
}

/**
 * Flush and close, rejecting if the stream failed.
 *
 * THE ERROR ARGUMENT WAS DISCARDED. Node calls `end`'s callback as `cb(err)` on a
 * failed stream, and this took no arguments and called `done()` regardless -- so a
 * failed stream resolved, the state file recorded `complete: true`, and the command
 * printed `done: N rows` and exited 0 with the file truncated. On ENOSPC or EDQUOT
 * mid-download that is a short file marked finished, which no rerun would continue.
 * Demonstrated: `end(cb)` receives `['EACCES']`.
 *
 * Extracted so it can be tested directly. Arranging a stream that writes fine and
 * then fails on flush is not portable; the callback contract is the thing that was
 * wrong, so the callback contract is what this pins.
 */
export function flushAndClose(handle: Closable, pending: () => Error | null): Promise<void> {
  return new Promise((done, fail) => {
    handle.end((error?: Error | null) => {
      const failure = error ?? pending();
      if (failure) fail(failure);
      else done();
    });
  });
}

export async function backfillPark(tp: ThemeParks, park: Park, opts: RunOptions): Promise<number> {
  const history = tp.entity(park.id).history;

  // SPAN IS INSIDE THE BUDGET HANDLING. `coverage()` is the one history call the
  // SDK does not wrap, so a spent hourly budget surfaces as a plain
  // RateLimitError. In Python this sat outside the handler and escaped as a
  // traceback with exit 1 — on the MOST LIKELY path after any exit 75, because
  // the retry runs while the window is still shut and this is its first request.
  let span: HistorySpan;
  try {
    span = await history.span();
  } catch (error) {
    if (error instanceof RateLimitError) {
      const mins = Math.round((error.retryAfterMs ?? 0) / 60_000);
      process.stderr.write(
        `${park.id}: history budget is spent; rerun the same command` +
          `${mins > 0 ? ` in ${String(mins)} min` : ' later'} to continue\n`,
      );
      return EX_TEMPFAIL;
    }
    throw error;
  }

  const ext = opts.format === 'csv' ? 'csv' : 'ndjson';
  const outPath = join(opts.outDir, `${park.id}.${ext}`);
  const statePath = statePathFor(opts.outDir, park.id, opts.format);
  const end = span.retrievableThrough;

  const decided = decide(outPath, statePath, opts, span.archiveFrom);
  if (typeof decided === 'number') return decided;
  let { start } = decided;
  const { hasRows, priorStart, resumed } = decided;

  process.stderr.write(
    `${park.id}: ${String(start)} .. ${String(end)}` +
      `${priorStart !== null ? ' (resumed)' : ''} -> ${outPath}\n`,
  );

  if (isEmptyWindow(start, end)) {
    process.stderr.write(
      `  nothing in your window: this park's data ends ${String(end)}, and your ` +
        `plan reaches back to ${String(start)} — skipping\n`,
    );
    // NEVER DELETE ROWS AN EARLIER RUN DOWNLOADED. `start` is the resume point on a
    // rerun, so a key rotated out of a scheduler's environment or a lapsed
    // subscription used to wipe the partial archive and exit 0 -- the scheduler
    // logged success -- then trap: the file gone, the state surviving, `hasRows`
    // false, every later run re-entering this branch and exiting 0 with no data.
    if (resumed) {
      process.stderr.write(
        `  the rows already downloaded are left alone. Your plan no longer reaches ` +
          `the day this run would continue from\n`,
      );
      return 1;
    }
    rmSync(outPath, { force: true });
    return 0;
  }

  const handle = createWriteStream(outPath, { flags: 'a', encoding: 'utf8' });
  // A LISTENER FROM THE MOMENT THE STREAM EXISTS. `handle.write()` never throws
  // synchronously, and the only listener used to be attached inside `finish()`,
  // so a filesystem error before that became an unhandled 'error' event: an
  // uncaught exception and a stack dump, with the five remaining parks of a
  // destination never attempted. Whichever of the two arrives first -- the error
  // or the end of the stream -- this records it and the park fails cleanly.
  let streamError: Error | null = null;
  handle.on('error', (error: Error) => {
    streamError = error;
  });
  // ONE header decision for the whole park. Python built the writer inside the
  // retried closure with `written === 0` in the predicate, and the 403 recovery
  // runs precisely when that is true — so every CSV on every plan short of the
  // full archive got TWO header rows, and pandas read the second as data.
  if (opts.format === 'csv' && !hasRows) {
    // A UTF-8 BOM, so Excel on Windows does not read the local code page and render
    // `Walt Disney World® Resort` as mojibake. The primary reader of this file is a
    // spreadsheet. Written with the header, so a resume never adds a second.
    handle.write(`\ufeff${CSV_COLUMNS.join(',')}\n`);
  }

  let written = 0;
  let lastDay: string | null = null;
  let resumeFrom: string | null = null;
  let skipped = false;

  const stream = async (from: string | null): Promise<void> => {
    // `exactOptionalPropertyTypes` means an explicit undefined is not the same
    // as an absent key, so the query is built rather than spread with nulls.
    const query: { from?: string; to?: string; onPage: (page: HistoryPage) => void } = {
      // The checkpoint. Fires once a page's rows are all written, carrying the
      // day the NEXT page starts on, so a resume asks for nothing twice.
      onPage: (page) => {
        resumeFrom = page.next === null ? null : nextPageFrom(page.next);
      },
    };
    if (from !== null) query.from = from;
    if (end !== null) query.to = end;
    for await (const entry of history.days(query)) {
      // Checked every row: the stream reports failures asynchronously, so without
      // this the loop keeps "writing" into a broken stream for the rest of the
      // archive and only the flush would notice.
      if (streamError) throw streamError;
      handle.write(opts.format === 'csv' ? `${csvLine(park, entry)}\n` : ndjsonLine(park, entry));
      written += 1;
      const day = (entry.row as { date?: string }).date ?? null;
      // MAX, not last-seen. Entities arrive name-ordered with independent day
      // lists, so the final row can belong to an entity that stopped reporting
      // mid-page — taking it would rewind the resume point by up to a full page.
      if (day !== null && (lastDay === null || day > lastDay)) lastDay = day;
      if (written % 5000 === 0)
        process.stderr.write(`  ${String(written)} rows, at ${String(lastDay)}\n`);
    }
  };

  /**
   * Flush and close, rejecting if the stream failed.
   *
   * THE ERROR ARGUMENT WAS DISCARDED. Node calls `end`'s callback as `cb(err)` on
   * a failed stream, and this took no arguments and called `done()` regardless --
   * so `finish()` resolved, `record(true)` ran, and the command printed
   * `done: N rows` and returned 0 with the file truncated. On ENOSPC or EDQUOT
   * mid-download the customer got a short file marked complete, which no rerun
   * would ever continue. Demonstrated: `end(cb)` receives `['EACCES']`.
   */
  const finish = (): Promise<void> => flushAndClose(handle, () => streamError);

  const record = (complete: boolean): void => {
    writeState(statePath, {
      sdk: SDK_NAME,
      sdkVersion: PACKAGE_VERSION,
      stateVersion: STATE_VERSION,
      columns: columnsFingerprint(opts.format),
      format: opts.format,
      start: priorStart ?? start,
      end,
      lastDay,
      resumeFrom,
      complete,
    });
  };

  try {
    try {
      await stream(start);
    } catch (error) {
      const floor = windowFloor(error);
      // Retry only when nothing was written: a 403 mid-stream is not a plan
      // boundary, and restarting would duplicate rows.
      if (floor === null || written > 0) throw error;
      process.stderr.write(
        `  this key reaches back to ${floor}, not ${String(start)} — starting there\n`,
      );
      start = floor;
      if (isEmptyWindow(floor, end)) {
        process.stderr.write(
          `  nothing in your window: this park's data ends ${String(end)} — skipping\n`,
        );
        skipped = true;
      } else {
        await stream(floor);
      }
    }
  } catch (error) {
    await finish();
    if (error instanceof BudgetExhaustedError) {
      record(false);
      if (written === 0 && !resumed) rmSync(outPath, { force: true });
      process.stderr.write(
        `  budget spent after ${String(written)} rows; rerun the same command to continue\n`,
      );
      return EX_TEMPFAIL;
    }
    // Any other failure still records where it got to, or the next run starts
    // over and appends a second partial copy.
    if (lastDay !== null) record(false);
    if (written === 0 && resumed) {
      // An earlier run's rows are real and are not ours to remove.
      process.stderr.write(`  the rows already downloaded are kept\n`);
      throw error;
    }
    // AN EMPTY FILE IS A LIE. The stream opened the file before the first
    // request, so a park that failed with nothing written leaves a 0-byte file
    // that looks like "this park has no history" — and on a six-park
    // destination the customer counts six files and never sees which one is
    // empty. Written rows stay: they are real, and the state file beside them
    // says where to carry on.
    if (written === 0) rmSync(outPath, { force: true });
    throw error;
  }

  await finish();
  if (skipped && written === 0) {
    if (resumed) {
      // Same rule: keep the file, record where it got to, and say it did not finish.
      record(false);
      return 1;
    }
    rmSync(outPath, { force: true });
    rmSync(statePath, { force: true });
    return 0;
  }
  record(true);
  process.stderr.write(`  done: ${String(written)} rows -> ${outPath}\n`);
  return 0;
}

const HELP = `themeparks-backfill — download a park's daily history to a file

usage:
  themeparks-backfill [options] PARK...

  PARK is a park or a DESTINATION, by name or id. A destination back fills every
  park in it, one file each.

options:
  --list [TEXT]    list ids and names, optionally filtered, then exit. No key needed.
  --api-key KEY    API key. Defaults to $THEMEPARKS_API_KEY.
  --format FORMAT  ndjson (default) or csv
  --out DIR        output directory (default: .)
  --overwrite      replace an existing file instead of refusing
  --help           this
  --version        print the package version

examples:
  themeparks-backfill --list disney
      find an id, or check a spelling. Destinations with their parks indented
      underneath. Works before you have a key.

  themeparks-backfill "Disneyland Park"
      the daily history your plan reaches, as NDJSON, into the current directory

  themeparks-backfill "Walt Disney World Resort"
      a DESTINATION: every park in it, one file each

  themeparks-backfill 7340550b-c14d-4def-80bb-acdb51d49a66 --format csv --out ./data

exit codes:
  0   done
  75  the hourly history budget ran out. Progress is recorded; run the same
      command again to continue. 75 is EX_TEMPFAIL by convention — systemd needs
      RestartForceExitStatus=75 to treat it as retry rather than failure, and
      cron mails on output rather than on exit code.

how far back this reaches is your plan: 7 days with no key at all, 30 on a free
key, more on the paid tiers. It runs either way, asks the API what you may see,
and starts there.

files are named for the park's id, not its name, because names change. Every row
carries parkId, parkName, entityId, entityName and entityType, so two files load
into one table and \`(entityId, date)\` is the natural key.
`;

/**
 * Run the command. `deps.fetch` is the seam the tests drive it through: the whole
 * command, argument parsing to written file, against captured responses.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  deps: { fetch?: unknown } = {},
): Promise<number> {
  // `--list` TAKES AN OPTIONAL VALUE and parseArgs has no way to say so: with
  // `type: 'string'` a bare `--list` is "argument missing" and exit 2, though the
  // help advertises `--list [TEXT]` and the Python SDK lists everything. Rewriting
  // it to `--list=` before parsing is the least surprising way to get there.
  argv = argv.map((arg, i) => (arg === '--list' && !isFilterNext(argv, i) ? '--list=' : arg));
  // `-h`, because every other command in the world accepts it.
  argv = argv.map((arg) => (arg === '-h' ? '--help' : arg));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        list: { type: 'string' },
        'api-key': { type: 'string' },
        format: { type: 'string', default: 'ndjson' },
        out: { type: 'string', default: '.' },
        overwrite: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.help === true) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version === true) {
    // Named, not a bare number: `8.3.0` alone cannot be pasted into a bug report,
    // and the Python SDK prints `themeparks-backfill 3.4.0`.
    process.stdout.write(`themeparks-backfill ${PACKAGE_VERSION}\n`);
    return 0;
  }
  if (values.format !== 'ndjson' && values.format !== 'csv') {
    process.stderr.write(`--format must be ndjson or csv, not "${String(values.format)}"\n`);
    return 2;
  }

  // `?? ` only catches null and undefined, so `THEMEPARKS_API_KEY=""` -- a
  // clobbered env var in a cron file, which is how this actually happens -- read
  // as a key and the anonymous notice never printed. Both SDKs treat empty as
  // absent now.
  const rawKey = values['api-key'] ?? process.env.THEMEPARKS_API_KEY;
  const apiKey = rawKey === '' ? undefined : rawKey;
  const listing = Object.hasOwn(values, 'list');

  // NO KEY IS NOT AN ERROR. Anonymous access reads 7 days, so it runs and says
  // what a key would add. Refusing to start while explaining that anonymous
  // access exists is worse than either.
  if (apiKey == null && !listing) {
    process.stderr.write(
      'no API key: reading the 7 days anonymous access allows.\n' +
        '  a free key reads 30 days, and the paid tiers reach further\n' +
        '  set THEMEPARKS_API_KEY, or pass --api-key\n' +
        '  keys: https://www.themeparks.wiki/profile\n\n',
    );
  }

  const tp = new ThemeParks({
    ...(apiKey != null ? { apiKey } : {}),
    ...(deps.fetch !== undefined ? { fetch: deps.fetch as FetchLike } : {}),
    // The command's identity IN FRONT OF the SDK's, not instead of it: the
    // server's logs are how a support question gets answered, and "which SDK
    // version" is the first thing anyone asks.
    userAgent: `${USER_AGENT_PREFIX}/${PACKAGE_VERSION} ${DEFAULT_USER_AGENT}`,
  });

  // CHECKED BEFORE THE REQUEST. This fetched /destinations first, so
  // `themeparks-backfill` with no arguments and no network exited 75 -- telling a
  // scheduler to retry a command that can never succeed.
  if (!listing && positionals.length === 0) {
    process.stderr.write(`which park or destination? try: themeparks-backfill --list disney\n`);
    return 2;
  }
  const rows = await catalogue(tp);
  if (listing) {
    const needle = values.list === '' ? undefined : values.list;
    return printList(rows, needle);
  }
  if (positionals.length === 0) {
    process.stderr.write(`which park or destination? try: themeparks-backfill --list disney\n`);
    return 2;
  }

  let targets: Park[];
  try {
    const seen = new Set<string>();
    targets = [];
    for (const wanted of positionals) {
      for (const park of resolve(rows, wanted)) {
        // A destination and one of its parks can both be named on one command
        // line; back filling the same park twice would double every row.
        if (!seen.has(park.id)) {
          seen.add(park.id);
          targets.push(park);
        }
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  // ALWAYS ECHO WHAT A NAME RESOLVED TO, with its destination, and recommend the
  // id. Twelve live parks contain "Hurricane Harbor" and the bare name is an
  // exact match for one of them, so a reasonable query could fetch the wrong
  // park and say nothing. Names find a park once; ids are what you script with.
  const resolvedByName = positionals.some((p) => !looksLikeId(p));
  if (targets.length > 1) {
    process.stderr.write(`${String(targets.length)} parks to back fill:\n`);
    for (const p of targets) {
      const where = p.destination !== '' && p.destination !== p.name ? `  (${p.destination})` : '';
      process.stderr.write(`  ${p.name}${where}  ${p.id}\n`);
    }
  } else if (resolvedByName && targets[0] !== undefined) {
    const p = targets[0];
    const where = p.destination !== '' && p.destination !== p.name ? `  (${p.destination})` : '';
    process.stderr.write(`resolved to ${p.name}${where}  ${p.id}\n`);
  }
  if (resolvedByName) {
    process.stderr.write(
      `  use the id next time — names are convenient once, ids are exact:\n` +
        `    themeparks-backfill ${targets.map((p) => p.id).join(' ')}\n`,
    );
  }

  mkdirSync(values.out, { recursive: true });
  const opts: RunOptions = {
    outDir: values.out,
    format: values.format,
    overwrite: values.overwrite,
  };
  // ONE PARK'S FAILURE IS NOT THE DESTINATION'S. A 500 on Animal Kingdom used
  // to throw straight out of here, so the four parks after it were never
  // attempted and the customer got a partial download with a traceback and no
  // statement of what was missing. Every park is tried, what failed is named at
  // the end, and the exit code still says something went wrong.
  const failed: string[] = [];
  for (const park of targets) {
    let status: number;
    try {
      status = await backfillPark(tp, park, opts);
    } catch (error) {
      process.stderr.write(
        `${park.id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      // THE HINT BELONGS HERE. It sat in the top-level handler, which this catch
      // makes unreachable for every ApiError, so the one message that helps with a
      // mistyped id was never printed. An unlisted uuid is passed through to the
      // API deliberately, so a 404 here is the likeliest single mistake.
      if (error instanceof ApiError && error.status === 404) {
        process.stderr.write(
          `  that id is not something with history. try: themeparks-backfill --list\n`,
        );
      }
      failed.push(park.name);
      continue;
    }
    // A spent budget stops everything: the next park would spend the retry-after
    // for nothing, and the state files say where each one got to.
    if (status === EX_TEMPFAIL) return status;
    if (status !== 0) failed.push(park.name);
  }
  if (failed.length > 0) {
    process.stderr.write(
      `\n${String(failed.length)} of ${String(targets.length)} did not finish: ${failed.join(', ')}\n` +
        `  the rest are written. Run the same command again to retry just these.\n`,
    );
    return 1;
  }
  return 0;
}

/**
 * Run the command and turn a failure into a sentence.
 *
 * A traceback is a bug report about this tool; an unreachable API, a 404 on a
 * mistyped id and a spent budget are none of them bugs in it, and a customer who
 * has just paid reads one as the tool being broken. Errors we can name get one
 * line; anything else still prints its stack, because an unexpected failure with
 * no detail is worse than an ugly one.
 */
export async function run(argv?: string[], deps: { fetch?: unknown } = {}): Promise<number> {
  try {
    return await main(argv, deps);
  } catch (error) {
    if (error instanceof ApiError) {
      process.stderr.write(`\n${error.message}\n`);
      return 1;
    }
    if (error instanceof NetworkError || error instanceof TimeoutError) {
      process.stderr.write(
        `\n${error.message}\n  the run is resumable: the same command continues it\n`,
      );
      return EX_TEMPFAIL;
    }
    throw error;
  }
}
