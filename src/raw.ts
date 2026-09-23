import type { components, operations } from './_generated/schema';
import type { Transport } from './transport';

export type Destinations = components['schemas']['DestinationsResponse'];
export type Entity = components['schemas']['EntityData'];
export type EntityChildren = components['schemas']['EntityChildrenResponse'];
export type EntityLive = components['schemas']['EntityLiveDataResponse'];
export type EntitySchedule = components['schemas']['EntityScheduleResponse'];

/**
 * Response of `/entity/{id}/history`. A PARK answers for every entity in it
 * (`HistoryParkRawEnvelope`, with `entities[]`); any other entity type answers
 * for itself (`HistoryEnvelope`, with `history[]`). Narrow on `'entities' in res`.
 */
export type EntityHistory =
  | components['schemas']['HistoryEnvelope']
  | components['schemas']['HistoryParkRawEnvelope'];
/**
 * Response of `/entity/{id}/history/coverage`. A PARK answers with
 * `HistoryParkCoverageDocument`, exactly as `/history` and `/history/daily`
 * do. The two shapes do not overlap where it counts: a park carries `summary`
 * and `fields`, an entity carries `firstRecordedAt`, `lastRecordedAt` and
 * `kinds`. Narrow on `'summary' in res`, or use `entity(id).history.span()`,
 * which reads both to one shape.
 */
export type EntityHistoryCoverage =
  | components['schemas']['HistoryCoverageDocument']
  | components['schemas']['HistoryParkCoverageDocument'];
/** Response of `/entity/{id}/history/daily`; a PARK answers with `entities[]`, see {@link EntityHistory}. */
export type EntityHistoryDaily =
  | components['schemas']['HistoryDailyEnvelope']
  | components['schemas']['HistoryParkDailyEnvelope'];

/**
 * Range of a history request: one park-local day (`date`), or `from`/`to`
 * as park-local days (both inclusive) or RFC 3339 instants (`to` exclusive).
 * Empty means today. The same shape serves `/history` and `/history/daily`.
 */
export type HistoryQuery = NonNullable<operations['getHistory']['parameters']['query']>;

function queryString(query: HistoryQuery): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) params.set(name, value);
  }
  const encoded = params.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

export class RawClient {
  constructor(private readonly transport: Transport) {}

  getDestinations(): Promise<Destinations> {
    return this.transport.get<Destinations>('/destinations');
  }

  getEntity(entityId: string): Promise<Entity> {
    return this.transport.get<Entity>(`/entity/${encodeURIComponent(entityId)}`);
  }

  getEntityChildren(entityId: string): Promise<EntityChildren> {
    return this.transport.get<EntityChildren>(`/entity/${encodeURIComponent(entityId)}/children`);
  }

  getEntityLive(entityId: string): Promise<EntityLive> {
    return this.transport.get<EntityLive>(`/entity/${encodeURIComponent(entityId)}/live`);
  }

  getEntitySchedule(entityId: string): Promise<EntitySchedule> {
    return this.transport.get<EntitySchedule>(`/entity/${encodeURIComponent(entityId)}/schedule`);
  }

  getEntityScheduleMonth(entityId: string, year: number, month: number): Promise<EntitySchedule> {
    const paddedMonth = String(month).padStart(2, '0');
    return this.transport.get<EntitySchedule>(
      `/entity/${encodeURIComponent(entityId)}/schedule/${String(year)}/${paddedMonth}`,
    );
  }

  getEntityHistory(entityId: string, query: HistoryQuery = {}): Promise<EntityHistory> {
    return this.transport.get<EntityHistory>(
      `/entity/${encodeURIComponent(entityId)}/history${queryString(query)}`,
    );
  }

  getEntityHistoryCoverage(entityId: string): Promise<EntityHistoryCoverage> {
    return this.transport.get<EntityHistoryCoverage>(
      `/entity/${encodeURIComponent(entityId)}/history/coverage`,
    );
  }

  getEntityHistoryDaily(entityId: string, query: HistoryQuery = {}): Promise<EntityHistoryDaily> {
    return this.transport.get<EntityHistoryDaily>(
      `/entity/${encodeURIComponent(entityId)}/history/daily${queryString(query)}`,
    );
  }

  /**
   * GET an absolute URL the API itself handed us, such as a paged response's
   * `next`. The server has already applied every parameter; re-deriving the
   * URL from its path is how a paging loop starts asking for the wrong range.
   */
  getUrl<T = unknown>(url: string): Promise<T> {
    return this.transport.getUrl<T>(url);
  }
}
