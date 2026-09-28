export { ThemeParks, type ThemeParksOptions } from './client';
export { ApiError, NetworkError, RateLimitError, ThemeParksError, TimeoutError } from './errors';
export { InMemoryLruCache, type Cache } from './cache';
export {
  DEFAULT_MAX_RETRY_AFTER_MS,
  type FetchLike,
  type FetchLikeResponse,
  type RetryConfig,
  type TransportOptions,
} from './transport';
export {
  RawClient,
  type Destinations,
  type Entity,
  type EntityChildren,
  type EntityHistory,
  type EntityHistoryCoverage,
  type EntityHistoryDaily,
  type EntityLive,
  type EntitySchedule,
  type HistoryQuery,
} from './raw';
export { EntityHandle } from './ergonomic/entity';
export {
  BudgetExhaustedError,
  DEFAULT_MAX_WAIT_MS,
  HistoryApi,
  type BudgetOptions,
  type ChangeEntry,
  type ChangesOptions,
  type DailyEntry,
  type DaysOptions,
  type HistoryChanges,
  type HistoryOpening,
  // `HistoryPage` is what `onPage` hands you, so a caller who wants to name the
  // type or store a page needs it. It was declared `export` in its own module and
  // never re-exported here, so `import type { HistoryPage } from 'themeparks'`
  // failed while the changelog advertised it as the new API.
  type HistoryPage,
  type HistorySpan,
  type PageOptions,
} from './ergonomic/history';
export { DestinationsApi } from './ergonomic/destinations';
export {
  currentWaitTime,
  narrowQueues,
  type LiveDataEntry,
  type LiveQueue,
} from './ergonomic/live';
export { isExhausted, secondsUntilReset, type RateLimit, type RateLimits } from './ratelimit';
export { parseApiDateTime } from './dates';
