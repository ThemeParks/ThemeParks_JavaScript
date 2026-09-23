import type { components } from '../_generated/schema';
import type {
  Entity,
  EntityChildren,
  EntityHistory,
  EntityHistoryCoverage,
  EntityHistoryDaily,
  EntityLive,
  EntitySchedule,
  HistoryQuery,
  RawClient,
} from '../raw';

export type EntityChild = components['schemas']['EntityChild'];

type ScheduleEntry = NonNullable<EntitySchedule['schedule']>[number];

export interface ScheduleApi {
  upcoming(): Promise<EntitySchedule>;
  month(year: number, month: number): Promise<EntitySchedule>;
  range(start: Date, end: Date): Promise<ScheduleEntry[]>;
}

export interface HistoryApi {
  /** Every recorded change in the range, one row per change: `GET /entity/{id}/history`. */
  changes(query?: HistoryQuery): Promise<EntityHistory>;
  /** One row per park-local day with operating minutes and wait-time statistics: `GET /entity/{id}/history/daily`. */
  daily(query?: HistoryQuery): Promise<EntityHistoryDaily>;
  /** Which days and which live-data fields are held: `GET /entity/{id}/history/coverage`. */
  coverage(): Promise<EntityHistoryCoverage>;
}

export class EntityHandle {
  readonly schedule: ScheduleApi;
  readonly history: HistoryApi;

  constructor(
    private readonly raw: RawClient,
    readonly id: string,
  ) {
    this.schedule = {
      upcoming: () => this.raw.getEntitySchedule(this.id),
      month: (year, month) => this.raw.getEntityScheduleMonth(this.id, year, month),
      range: (start, end) => this.scheduleRange(start, end),
    };
    this.history = {
      changes: (query) => this.raw.getEntityHistory(this.id, query),
      daily: (query) => this.raw.getEntityHistoryDaily(this.id, query),
      coverage: () => this.raw.getEntityHistoryCoverage(this.id),
    };
  }

  get(): Promise<Entity> {
    return this.raw.getEntity(this.id);
  }

  children(): Promise<EntityChildren> {
    return this.raw.getEntityChildren(this.id);
  }

  live(): Promise<EntityLive> {
    return this.raw.getEntityLive(this.id);
  }

  /**
   * Yield every descendant of this entity in a single API call.
   *
   * The ThemeParks API's `/children` endpoint returns the entire subtree in
   * one response — this method just exposes it as an async iterator so
   * callers can `for await` without flattening themselves. The root entity
   * itself is not yielded. When the entity has no children (or the response
   * omits the `children` array) the iterator completes without yielding.
   */
  async *walk(): AsyncIterable<EntityChild> {
    const res = await this.raw.getEntityChildren(this.id);
    for (const child of res.children ?? []) {
      yield child;
    }
  }

  private async scheduleRange(start: Date, end: Date): Promise<ScheduleEntry[]> {
    if (end < start) return [];
    const months = monthsBetween(start, end);
    const responses = await Promise.all(
      months.map(([y, m]) => this.raw.getEntityScheduleMonth(this.id, y, m)),
    );
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    const all = responses.flatMap((r) => r.schedule ?? []);
    return all
      .filter((e) => {
        const d = e.date ?? '';
        return d >= startStr && d <= endStr;
      })
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }
}

function monthsBetween(start: Date, end: Date): Array<[number, number]> {
  const months: Array<[number, number]> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= stop) {
    months.push([cursor.getUTCFullYear(), cursor.getUTCMonth() + 1]);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
