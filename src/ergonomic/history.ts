/**
 * The loop above the history endpoints.
 *
 * The raw calls are honest but they hand the caller four jobs: walk the `next`
 * links, respect an hourly budget separate from the per-minute one, know that
 * asking a PARK returns a different shape from asking a ride, and keep five
 * years of rows out of memory. Every customer who buys history writes the same
 * loop, and most write it wrong: the first version of our own monitor treated
 * a 429 as "no data" and reported all-clear for eight days.
 *
 * So this does the walking. `days()` pages until the server stops offering a
 * `next`, and yields rows rather than returning an array, because a resort's
 * five years is not an array.
 *
 * THE ONE THING THAT MATTERS MOST is that asking about a park uses the PARK
 * call. Both history endpoints answer a whole park in one request; asking ride
 * by ride costs around a hundred times more for the same data. A caller who
 * passes a park id gets the cheap path without having to know the expensive
 * one exists.
 */

import { RateLimitError, type RateLimitErrorInit } from '../errors';
import type {
  EntityHistory,
  EntityHistoryCoverage,
  EntityHistoryDaily,
  HistoryQuery,
  RawClient,
} from '../raw';
import type { components } from '../_generated/schema';

type HistoryDailyRow = components['schemas']['HistoryDailyRow'];
type HistoryRow = components['schemas']['HistoryRow'];

/**
 * The state an entity was in at the START of a raw history range, before its
 * first change: the same shape as a row, plus when it was last observed.
 */
export type HistoryOpening = components['schemas']['HistoryOpening'];

/**
 * The hourly history budget is spent and the wait is longer than this client
 * will sit through.
 *
 * Carries `retryAfterMs` from the underlying 429, so a backfill can record
 * where it got to and come back after that long rather than holding a process
 * open waiting for a budget window to roll.
 */
export class BudgetExhaustedError extends RateLimitError {
  constructor(message: string, init: RateLimitErrorInit) {
    super(message, init);
    this.name = 'BudgetExhaustedError';
  }
}

/**
 * Past this, a 429 is reported rather than waited out. Matches the transport's
 * own `retry.maxRetryAfterMs`, so the two agree: the transport stops retrying,
 * and this turns what comes back into an error a backfill can act on.
 */
export const DEFAULT_MAX_WAIT_MS = 120_000;

function asBudgetError(error: unknown, maxWaitMs: number): unknown {
  if (!(error instanceof RateLimitError) || error instanceof BudgetExhaustedError) return error;
  const wait = error.retryAfterMs;
  if (wait === null || wait <= maxWaitMs) return error;
  return new BudgetExhaustedError(
    `history budget exhausted; retry in ${String(Math.round(wait / 1000))}s ` +
      `(longer than maxWaitMs=${String(maxWaitMs)}). Checkpoint and resume.`,
    { status: error.status, body: error.body, url: error.url, retryAfterMs: wait },
  );
}

/**
 * One daily row, tagged with the entity it belongs to.
 *
 * `name` and `entityType` come from the history response itself, which matters
 * for more than convenience: they are the labels that response gives for these
 * rows. A park's current `/children` list gives TODAY's name, and stamping that
 * on a row recorded three years ago rewrites the record, because rides get
 * renamed. They are also already in the payload, so nothing needs to ask what
 * an id refers to.
 *
 * Empty strings rather than undefined when the envelope omits them: a writer
 * should not have to branch, and "" is what lands in a CSV cell either way.
 */
export interface DailyEntry {
  entityId: string;
  name: string;
  entityType: string;
  row: HistoryDailyRow;
}

/** One recorded change, tagged with the entity it belongs to. */
export interface ChangeEntry {
  entityId: string;
  row: HistoryRow;
}

/**
 * The three dates a backfill needs, in one shape for parks and rides.
 *
 * A park's coverage document nests these under `summary`; an entity's carries
 * them at the top level under different names. Without this, every caller
 * writes the same branch before they can ask their first question.
 */
export interface HistorySpan {
  /** First park-local day the archive holds anything for, or null. */
  archiveFrom: string | null;
  /** Newest day in the archive, or null. Runs a few days behind live data. */
  recordedTo: string | null;
  /**
   * Newest day YOUR key may retrieve, or null.
   *
   * This, not `recordedTo`, is the end date to bound a backfill by: it is what
   * the plan allows rather than what exists, and asking past it is how a long
   * run ends in 403s.
   */
  retrievableThrough: string | null;
  /**
   * The newest day whose daily rows will not change again, or null.
   *
   * `retrievableThrough` is usually today, and today's row is the day so far.
   * Recent days can still change after that too: the archive records days 2 to
   * 3 behind live data. `recordedTo` is the newest day the archive holds, so a
   * day on or before it is final. Store those, and ask for anything later again
   * once `finalThrough` has moved past it.
   *
   * The earlier of `recordedTo` and `retrievableThrough`, because a key may be
   * entitled to fewer days than the archive holds. Null when either is unknown.
   */
  finalThrough: string | null;
}

/** The earlier of the two days, or null when either is unknown. ISO days sort as text. */
function earlierDay(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null;
  return a < b ? a : b;
}

function toSpan(document: EntityHistoryCoverage): HistorySpan {
  const [archiveFrom, recordedTo, retrievableThrough] =
    'summary' in document
      ? [
          document.summary.archiveFrom,
          document.summary.recordedTo,
          document.summary.retrievableThrough,
        ]
      : [document.firstRecordedAt, document.lastRecordedAt, document.retrievableThrough];
  return {
    archiveFrom,
    recordedTo,
    retrievableThrough,
    finalThrough: earlierDay(recordedTo, retrievableThrough),
  };
}

/**
 * A park envelope carries many entities; an entity envelope carries its own
 * rows. Both flatten to the same stream, so a caller writes one loop.
 */
function labelOf(source: { name?: string; entityType?: string }): {
  name: string;
  entityType: string;
} {
  return { name: source.name ?? '', entityType: source.entityType ?? '' };
}

function* dailyEntries(envelope: EntityHistoryDaily): Generator<DailyEntry> {
  if ('entities' in envelope) {
    for (const entity of envelope.entities) {
      const label = labelOf(entity);
      for (const row of entity.days) yield { entityId: entity.id, ...label, row };
    }
    return;
  }
  const label = labelOf(envelope);
  for (const row of envelope.days) yield { entityId: envelope.id, ...label, row };
}

function* changeEntries(envelope: EntityHistory): Generator<ChangeEntry> {
  if ('entities' in envelope) {
    for (const entity of envelope.entities) {
      for (const row of entity.history) yield { entityId: entity.id, row };
    }
    return;
  }
  for (const row of envelope.history) yield { entityId: envelope.id, row };
}

/** Each entity's `opening`, keyed by id, in the order the response lists them. */
function openingsOf(envelope: EntityHistory): Record<string, HistoryOpening> {
  if ('entities' in envelope) {
    const out: Record<string, HistoryOpening> = {};
    for (const entity of envelope.entities) out[entity.id] = entity.opening;
    return out;
  }
  return { [envelope.id]: envelope.opening };
}

/**
 * What {@link HistoryApi.changeRows} returns: the rows, and the state before them.
 *
 * It is the async generator it always was. `for await` yields the same
 * `{ entityId, row }` entries, and each row is the entity's complete live data
 * from its `time` until the next row's.
 *
 * `opening` is the one thing the rows cannot tell you: the state in force at the
 * START of the range, before the first change. Without it, the stretch between
 * midnight and an entity's first change has no known status. On a night a ride
 * runs past midnight that is real operating time, and a day rebuilt from the
 * rows alone disagrees with the daily summary. It has an entry for every entity
 * in the response, including one that did not change at all that day.
 *
 * Nothing is requested until the result is first used, as before. A getter
 * cannot await, so `opening` is readable once the response has arrived: after
 * the first step of iteration, or straight away with
 * `const changes = await history.changeRows(query).load()`. Either way it is
 * one request.
 */
export type HistoryChanges = AsyncGenerator<ChangeEntry, void, undefined> & {
  /** The state at the start of the range, per entity id. Throws before the response. */
  readonly opening: Record<string, HistoryOpening>;
  /** Make the request now, if it has not been made, and resolve to this object. */
  load(): Promise<HistoryChanges>;
};

export interface BudgetOptions {
  /** Past this, a 429 becomes {@link BudgetExhaustedError} instead of a retry. */
  maxWaitMs?: number;
}

/**
 * One page of daily history, as the server described it.
 *
 * `from`/`to` are the park-local days this page actually covered, which is not
 * the range you asked for: a park call is capped, so a 50-day request comes
 * back as 31 days plus a `next`. `next` is the URL of the following page, or
 * null on the last one.
 *
 * This exists for resumable downloads. A checkpoint taken from the ROWS is
 * wrong in both directions: the newest row's date can be earlier than the page
 * covered, since an entity that stopped reporting has no rows for the tail
 * days, so resuming there re-fetches days already written; and there is no way
 * to tell a complete page from one interrupted mid-write. The page boundary is
 * the server's own answer to "where do I carry on", so it is the only safe
 * checkpoint.
 */
export interface HistoryPage {
  from: string;
  to: string;
  next: string | null;
}

export interface PageOptions {
  /** Called after every row of a page has been yielded. See {@link HistoryPage}. */
  onPage?: (page: HistoryPage) => void;
}

export type DaysOptions = HistoryQuery & BudgetOptions & PageOptions;
export type ChangesOptions = HistoryQuery & BudgetOptions;

function toQuery(options: HistoryQuery & BudgetOptions & PageOptions): HistoryQuery {
  const query: HistoryQuery = {};
  if (options.date !== undefined) query.date = options.date;
  if (options.from !== undefined) query.from = options.from;
  if (options.to !== undefined) query.to = options.to;
  return query;
}

/** History for one entity id, reached as `tp.entity(id).history`. */
export class HistoryApi {
  constructor(
    private readonly raw: RawClient,
    private readonly entityId: string,
  ) {}

  /** Every recorded change in the range: `GET /entity/{id}/history`. */
  changes(query: HistoryQuery = {}): Promise<EntityHistory> {
    return this.raw.getEntityHistory(this.entityId, query);
  }

  /** One row per park-local day: `GET /entity/{id}/history/daily`. */
  daily(query: HistoryQuery = {}): Promise<EntityHistoryDaily> {
    return this.raw.getEntityHistoryDaily(this.entityId, query);
  }

  /** Which days and which live-data fields are held. */
  coverage(): Promise<EntityHistoryCoverage> {
    return this.raw.getEntityHistoryCoverage(this.entityId);
  }

  /**
   * The dates a backfill should run between: one call, and the same three
   * fields whether this id is a park or a single ride.
   */
  async span(): Promise<HistorySpan> {
    return toSpan(await this.coverage());
  }

  /**
   * Every daily row in the range, paged automatically, yielded as it arrives.
   *
   * Given a park id this uses the park call, which answers every entity in the
   * park in one request. Nothing accumulates, so the only thing that grows is
   * whatever the caller writes the rows to.
   */
  async *days(options: DaysOptions = {}): AsyncGenerator<DailyEntry> {
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    let envelope: EntityHistoryDaily;
    try {
      envelope = await this.raw.getEntityHistoryDaily(this.entityId, toQuery(options));
    } catch (error) {
      throw asBudgetError(error, maxWaitMs);
    }

    for (;;) {
      yield* dailyEntries(envelope);
      const next = envelope.next;
      // AFTER the rows, never before: a caller checkpointing on this has to be
      // able to trust that everything the page held is already written.
      options.onPage?.({
        from: envelope.range.from,
        to: envelope.range.to,
        next: next === '' ? null : next,
      });
      if (next === null || next === '') return;
      try {
        // Followed verbatim: the server has already applied every parameter,
        // and re-deriving the URL is how a paging loop starts asking for the
        // wrong range.
        envelope = await this.raw.getUrl<EntityHistoryDaily>(next);
      } catch (error) {
        throw asBudgetError(error, maxWaitMs);
      }
    }
  }

  /**
   * Every recorded change in the range, flattened to one stream, plus the state
   * before the first of them.
   *
   * A park answers one day per call; a single entity answers up to 31 days.
   * The caller does not have to know which cap applies: ask for what you want,
   * and the API answers or says the range is too long.
   *
   * Iterate the result for the rows. Its `opening` is each entity's state at the
   * start of the range, which is what a day has to be rebuilt from. See
   * {@link HistoryChanges}.
   */
  changeRows(options: ChangesOptions = {}): HistoryChanges {
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    // ONE promise, shared, so `load()` and the iteration (or two `load()`s in
    // flight) cost one request between them.
    let pending: Promise<EntityHistory> | null = null;
    let envelope: EntityHistory | null = null;
    const fetchOnce = (): Promise<EntityHistory> => {
      pending ??= this.raw.getEntityHistory(this.entityId, toQuery(options)).then(
        (value) => {
          envelope = value;
          return value;
        },
        (error: unknown) => {
          throw asBudgetError(error, maxWaitMs);
        },
      );
      return pending;
    };

    async function* rows(): AsyncGenerator<ChangeEntry, void, undefined> {
      yield* changeEntries(await fetchOnce());
    }

    const changes = rows() as HistoryChanges;
    Object.defineProperties(changes, {
      opening: {
        enumerable: true,
        get(): Record<string, HistoryOpening> {
          if (envelope === null) {
            throw new Error(
              'the response has not arrived yet: iterate first, or ' +
                '`await changes.load()` before reading `opening`',
            );
          }
          return openingsOf(envelope);
        },
      },
      load: {
        value: async (): Promise<HistoryChanges> => {
          await fetchOnce();
          return changes;
        },
      },
    });
    return changes;
  }
}
