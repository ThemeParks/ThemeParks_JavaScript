# themeparks

A typed, modern TypeScript/JavaScript SDK for the [ThemeParks.wiki](https://api.themeparks.wiki) API. Built on the platform `fetch` with zero runtime dependencies, first-class TypeScript types, default-on caching, and ergonomic helpers for the common workflows (list destinations, walk a park's children, fetch live wait times, pull a date-ranged schedule).

📚 **[Full documentation, API reference, and cookbook](https://themeparks.github.io/ThemeParks_JavaScript/)**

## Install

```bash
npm i themeparks
```

Runs on Node 20+, evergreen browsers, Deno, Bun, and Cloudflare Workers. Zero runtime dependencies.

## Print live wait times

Every example in this README works as plain JavaScript — save as `.mjs` and
run with `node`. To use them as TypeScript, rename to `.ts` and run with
`npx tsx`; the SDK ships full `.d.ts` types so TypeScript infers everything.

```js
import { ThemeParks, currentWaitTime } from 'themeparks';

const MAGIC_KINGDOM = '75ea578a-adc8-4116-a54d-dccb60765ef9';

const tp = new ThemeParks();
const live = await tp.entity(MAGIC_KINGDOM).live();

for (const entry of (live.liveData ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
  const wait = currentWaitTime(entry);
  console.log(`${entry.name.padEnd(50)} ${wait === null ? '--' : `${wait} min`}`);
}
```

Sample output:

```
Astro Orbiter                                      15 min
Big Thunder Mountain Railroad                      45 min
Buzz Lightyear's Space Ranger Spin                 20 min
Haunted Mansion                                    35 min
Jungle Cruise                                      40 min
...
```

`currentWaitTime` returns `null` for entities with no STANDBY queue right now (closed rides, shows, restaurants).

## Client options

`new ThemeParks(options)` takes the following keyword options:

| Option      | Type                                | Default                                            | Purpose                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`   | `string`                            | `https://api.themeparks.wiki/v1`                   | API base URL (point at a mock / staging if you need to).                                                                                                                                                                                       |
| `userAgent` | `string`                            | `themeparks-sdk-js/<version>`                      | Sent as the `User-Agent` header. Set this to identify your app.                                                                                                                                                                                |
| `apiKey`    | `string`                            | none                                               | API key from api.themeparks.wiki, sent as `X-API-Key`. Optional; a key raises the limits.                                                                                                                                                      |
| `fetch`     | `typeof fetch`                      | `globalThis.fetch`                                 | Custom fetch implementation. Useful for logging, mocking, or older runtimes.                                                                                                                                                                   |
| `timeoutMs` | `number`                            | `10000`                                            | Per-request timeout in milliseconds.                                                                                                                                                                                                           |
| `retry`     | `Partial<RetryConfig>`              | `{ max: 3, on429: true, maxRetryAfterMs: 120000 }` | Retry/backoff behavior. `max` counts retries **beyond** the initial attempt (so `3` = up to 4 total). `maxRetryAfterMs` is the longest `Retry-After` the client will sleep through; past it you get `RateLimitError` instead of a silent wait. |
| `cache`     | `Cache \| false \| { maxEntries? }` | in-memory LRU                                      | See [Caching](#caching) below. `false` disables caching entirely.                                                                                                                                                                              |

Example:

```js
const tp = new ThemeParks({
  userAgent: 'my-app/1.2.3 (+https://example.com)',
  apiKey: 'your-api-key',
  timeoutMs: 15_000,
  retry: { max: 5, on429: true },
});
```

## Reading every queue variant

`currentWaitTime` covers the standby-queue case. There are six queue variants in total, and an attraction may have more than one populated at once (e.g. STANDBY + SINGLE_RIDER + PAID_RETURN_TIME for a Lightning Lane ride).

Each variant is exposed as a key on `entry.queue`. All are optional — `undefined` if that queue type isn't offered for the attraction:

| Key                      | Fields                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `queue.STANDBY`          | `waitTime: number \| null`                                                                        |
| `queue.SINGLE_RIDER`     | `waitTime: number \| null`                                                                        |
| `queue.PAID_STANDBY`     | `waitTime: number \| null`                                                                        |
| `queue.RETURN_TIME`      | `state`, `returnStart`, `returnEnd`                                                               |
| `queue.PAID_RETURN_TIME` | `state`, `returnStart`, `returnEnd`, `price`                                                      |
| `queue.BOARDING_GROUP`   | `allocationStatus`, `currentGroupStart`, `currentGroupEnd`, `nextAllocationTime`, `estimatedWait` |

### Direct access

```js
import { ThemeParks } from 'themeparks';

const tp = new ThemeParks();
const live = await tp.entity('75ea578a-adc8-4116-a54d-dccb60765ef9').live();

for (const entry of live.liveData ?? []) {
  if (!entry.queue) continue;

  if (entry.queue.STANDBY?.waitTime != null) {
    console.log(`${entry.name}: standby ${entry.queue.STANDBY.waitTime} min`);
  }

  if (entry.queue.PAID_RETURN_TIME) {
    const prt = entry.queue.PAID_RETURN_TIME;
    const price = prt.price?.formatted ?? '?';
    console.log(
      `${entry.name}: Lightning Lane ${price}, return ${prt.returnStart} → ${prt.returnEnd}`,
    );
  }

  if (entry.queue.BOARDING_GROUP) {
    const bg = entry.queue.BOARDING_GROUP;
    console.log(
      `${entry.name}: boarding group ${bg.currentGroupStart}–${bg.currentGroupEnd}, ` +
        `~${bg.estimatedWait} min, status ${bg.allocationStatus}`,
    );
  }
}
```

### Generic iteration

If branching on every variant is too verbose, `narrowQueues(queue)` flattens all populated variants into a typed discriminated union:

```js
import { ThemeParks, narrowQueues } from 'themeparks';

const tp = new ThemeParks();
const live = await tp.entity('75ea578a-adc8-4116-a54d-dccb60765ef9').live();

for (const entry of live.liveData ?? []) {
  if (!entry.queue) continue;
  for (const q of narrowQueues(entry.queue)) {
    // q.type is 'STANDBY' | 'SINGLE_RIDER' | 'RETURN_TIME' | 'PAID_RETURN_TIME'
    //         | 'BOARDING_GROUP' | 'PAID_STANDBY'
    // Narrowing on q.type gives you the exact fields for that variant.
    console.log(entry.name, q.type, q);
  }
}
```

## Ergonomic helpers

```js
import { ThemeParks } from 'themeparks';

const tp = new ThemeParks();

// Directory lookup (loose, case-insensitive match on slug or name)
const wdw = await tp.destinations.find('waltdisneyworld');
console.log(wdw?.id, wdw?.name);

// Walk a destination and yield every descendant in ONE API call
for await (const child of tp.entity('e957da41-3552-4cf6-b636-5babc5cbc4e5').walk()) {
  console.log(child.entityType, child.name);
}

// Schedule across a date range (stitches monthly responses and filters)
const mk = '75ea578a-adc8-4116-a54d-dccb60765ef9';
const entries = await tp.entity(mk).schedule.range(new Date('2026-05-01'), new Date('2026-05-31'));
console.log(`${entries.length} schedule entries`);
```

## History

Three endpoints answer what an entity did in the past. Days are park-local; the
range is one day (`date`) or `from`/`to` (days inclusive, or RFC 3339 instants
with `to` exclusive). Without a range the call means today.

```js
import { ThemeParks } from 'themeparks';

const tp = new ThemeParks({ apiKey: 'your-api-key' });
const barnstormer = tp.entity('924a3b2c-6b4b-49e5-99d3-e9dc3f2e8a48');

// Every recorded change of one day: the full live-data object per change, plus
// `time` and the `changed` paths.
const day = await barnstormer.history.changes({ date: '2026-09-17' });
if (!('entities' in day)) {
  console.log(`opened ${day.opening.status}, ${day.history.length} changes`);
  for (const row of day.history) {
    console.log(row.time, row.status, row.queue?.STANDBY?.waitTime ?? '--', row.changed.join(','));
  }
}

// One row per day: operating and down minutes, standby min/p50/p90/max/mean.
const week = await barnstormer.history.daily({ from: '2026-09-11', to: '2026-09-17' });
if (!('entities' in week)) {
  for (const d of week.days) console.log(d.date, d.operatingMinutes, d.standby?.p50);
}

// Which days, and which live-data fields, are held at all. A PARK answers the
// park document here too (summary + fields + entities), so narrow, or use
// span() below, which reads both to one shape.
const coverage = await barnstormer.history.coverage();
if (!('summary' in coverage)) {
  console.log(coverage.firstRecordedAt, coverage.retrievableThrough, Object.keys(coverage.kinds));
}
```

Sample output of the first loop:

```
2026-09-17T12:30:25Z OPERATING 5 status,queue.STANDBY.waitTime,queue.RETURN_TIME.returnStart,queue.RETURN_TIME.returnEnd
2026-09-17T12:43:48Z OPERATING 10 queue.STANDBY.waitTime
```

Three things to know before polling these:

- **A park answers for the whole park.** `changes` and `daily` on a `PARK`
  return an `entities[]` array, one entry per entity with history, instead of
  `history[]` / `days[]`; the range of a park is limited to one day for
  `changes`. Every other entity type, a `DESTINATION` included, answers for
  itself. Narrow with `'entities' in res`, as above.
- **The window and the budget depend on the key.** Anonymous callers see 7
  days back and 60 history requests an hour; a free key sees 30 days and 600.
  A day outside the window is a 403 `ApiError` whose
  `body.error.earliestAllowedDate` names the first day you may ask for. Over
  the budget is a 429 whose `Retry-After` can be most of an hour. The client
  will not sleep that long: past `retry.maxRetryAfterMs` (120000) it stops
  retrying and throws `RateLimitError` with `retryAfterMs` set, so a poller
  fails fast by default rather than looking hung. A REST 429, which asks for
  seconds, is still ridden out.
- **Today is not final.** The default cache leaves `changes` and `daily`
  uncached and keeps `coverage` for an hour. A completed day never changes, so
  cache it yourself for as long as you like.

`tp.raw.getEntityHistory(id, query)`, `getEntityHistoryDaily(id, query)` and
`getEntityHistoryCoverage(id)` are the underlying calls.

### Backfilling: span, paging, and the budget

The three calls above are one request each. A backfill is not one request, and
the three things it needs are here rather than in your code.

```js
import { BudgetExhaustedError, ThemeParks } from 'themeparks';

const DISNEYLAND = '7340550b-c14d-4def-80bb-acdb51d49a66';
const tp = new ThemeParks({ apiKey: process.env.THEMEPARKS_API_KEY });
const history = tp.entity(DISNEYLAND).history;

// What exists, and what your key may read. The same three fields whether the
// id is a park or a single ride.
const span = await history.span();
// -> { archiveFrom: '2021-07-03', recordedTo: '2026-09-22', retrievableThrough: '2026-09-23' }

// Pages until the server stops offering a `next`, yielding as it goes.
for await (const { entityId, row } of history.days({
  from: span.archiveFrom,
  to: span.retrievableThrough,
})) {
  console.log(entityId, row.date, row.operatingMinutes, row.standby?.p50);
}
```

**Ask the park, not the rides.** Both history endpoints answer every entity in
a park in one request. Pulling the same data ride by ride is around a hundred
times more calls against the same budget. Pass a park id and `days()` takes the
cheap path; every row is tagged with the entity it came from, which is the only
thing you give up.

**Bound the range with `retrievableThrough`, not `recordedTo`.** The first is
what your key may read, the second is what the archive holds. They differ on
every plan below the top one, and asking past the entitlement is how a long run
ends in 403s.

**`days()` yields, it does not collect.** Nothing accumulates, so the only thing
that grows is whatever you write the rows to.

**The budget is hourly.** When it runs out the server asks for a wait the client
will not sit through, and `days()` throws `BudgetExhaustedError` carrying
`retryAfterMs`, so you can write down where you got to:

```js
let lastDay = null;
try {
  for await (const { entityId, row } of history.days({ from, to })) {
    write(entityId, row);
    lastDay = row.date;
  }
} catch (error) {
  if (!(error instanceof BudgetExhaustedError)) throw error;
  checkpoint(lastDay);
  console.error(`resume in ${Math.round(error.retryAfterMs / 1000)}s`);
}
```

`history.changeRows(query)` is the same treatment for `changes`: one flattened
stream of `{ entityId, row }` whether you asked a park or a ride.

A complete backfill with resume and CSV output is in
[`examples/backfill.mjs`](examples/backfill.mjs). It pulled Disneyland Resort's
whole daily archive, 98,452 rows, in one run.

## Low-level escape hatch

Every ergonomic helper is built on top of `tp.raw`, which is a thin, typed 1:1 wrapper over the OpenAPI operations. Use it directly when you want the raw response shape:

```js
const live = await tp.raw.getEntityLive('75ea578a-adc8-4116-a54d-dccb60765ef9');
const dests = await tp.raw.getDestinations();
const children = await tp.raw.getEntityChildren('e957da41-3552-4cf6-b636-5babc5cbc4e5');
```

## Error handling

All SDK errors inherit from `ThemeParksError`. The ones you'll typically catch:

```js
import { ThemeParks, ApiError, RateLimitError, NetworkError, TimeoutError } from 'themeparks';

const tp = new ThemeParks();
try {
  await tp.entity('75ea578a-adc8-4116-a54d-dccb60765ef9').live();
} catch (err) {
  if (err instanceof RateLimitError) {
    // 429: err.retryAfterMs is set if the server sent a Retry-After header
    console.log(`rate limited, retry after ${err.retryAfterMs}ms`);
  } else if (err instanceof ApiError) {
    // any non-2xx status
    console.log(`api error ${err.status} at ${err.url}:`, err.body);
  } else if (err instanceof NetworkError || err instanceof TimeoutError) {
    console.log('transport:', err);
  } else {
    throw err;
  }
}
```

`RateLimitError` is a subclass of `ApiError`, so order the branches carefully if you want to handle 429 specially.

## Debugging — see every HTTP request

There's no built-in HTTP logger to flip on (we run directly on platform `fetch`). The clean idiom is to pass a wrapping `fetch` implementation:

```js
import { ThemeParks } from 'themeparks';

const tp = new ThemeParks({
  fetch: async (url, init) => {
    console.log('→', init?.method ?? 'GET', url);
    const res = await fetch(url, init);
    console.log('←', res.status, url);
    return res;
  },
  cache: false, // so every call goes through the wrapper
});
```

> **Note:** cached responses bypass the `fetch` wrapper — they're returned before the transport is touched. Pass `cache: false` while debugging so every call is a real network round-trip.

## Caching

The default client caches `GET` responses in-memory (LRU) with sensible per-endpoint TTLs:

| Endpoint                              | TTL        | Rationale                           |
| ------------------------------------- | ---------- | ----------------------------------- |
| `GET /destinations`                   | 1 hour     | Directory rarely changes.           |
| `GET /entity/{id}`                    | 1 hour     | Entity metadata is static.          |
| `GET /entity/{id}/children`           | 1 hour     | Park topology is stable.            |
| `GET /entity/{id}/schedule[/yyyy/mm]` | 5 minutes  | Schedules update but not rapidly.   |
| `GET /entity/{id}/live`               | 0 (bypass) | Live data is always fetched.        |
| `GET /entity/{id}/history/coverage`   | 1 hour     | Whole days; changes once a day.     |
| `GET /entity/{id}/history[/daily]`    | 0 (bypass) | A range holding today is not final. |

### Disable caching

```js
const tp = new ThemeParks({ cache: false });
```

### Plug in your own adapter

`Cache` is a structural interface — any object implementing `get`, `set`, and `delete` works. Redis, filesystem, IndexedDB, etc. (TypeScript shown; drop the annotations for plain JS):

```ts
import { ThemeParks, type Cache } from 'themeparks';

class MapCache implements Cache {
  private readonly data = new Map<string, unknown>();
  get(key: string) {
    return this.data.get(key);
  }
  set(key: string, value: unknown, _ttlMs: number) {
    this.data.set(key, value);
  }
  delete(key: string) {
    this.data.delete(key);
  }
}

const tp = new ThemeParks({ cache: new MapCache() });
```

The per-endpoint TTL table is applied by the transport layer, so your adapter receives the correct `ttlMs` for each call and can honor it however it likes (Redis `EXPIRE`, filesystem mtime, etc.).

## What's new in v7

v7 is a full TypeScript rewrite. It replaces the v6 OpenAPI-Generator surface with a hand-crafted client built on platform `fetch`, ships real TypeScript types, adds ergonomic helpers (`entity().walk()`, `schedule.range()`, `currentWaitTime`, `narrowQueues`), default-on caching, and 429 `Retry-After` handling. See [MIGRATION.md](./MIGRATION.md) for a side-by-side v6 → v7 guide.

## Supported runtimes

- Node 20, 22, 24
- Evergreen browsers
- Deno
- Bun
- Cloudflare Workers

## Links

- **SDK documentation:** https://themeparks.github.io/ThemeParks_JavaScript/
- **API reference:** https://themeparks.github.io/ThemeParks_JavaScript/modules.html
- **Cookbook:** https://themeparks.github.io/ThemeParks_JavaScript/documents/cookbook.html
- **Underlying API:** https://api.themeparks.wiki
- **Issues:** https://github.com/ThemeParks/ThemeParks_JavaScript/issues
- **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

## License

MIT.
