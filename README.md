# themeparks

A typed, modern TypeScript/JavaScript SDK for the [ThemeParks.wiki](https://api.themeparks.wiki) API. Built on the platform `fetch` with zero runtime dependencies, first-class TypeScript types, default-on caching, and ergonomic helpers for the common workflows (list destinations, walk a park's children, fetch live wait times, pull a date-ranged schedule).

📚 **[Full documentation, API reference, and cookbook](https://themeparks.github.io/ThemeParks_JavaScript/)**

## Install

```bash
npm i themeparks
```

Runs on Node 18+, evergreen browsers, Deno, Bun, and Cloudflare Workers. Zero runtime dependencies.

## Print live wait times

```ts
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

| Option      | Type                                | Default                          | Purpose                                                                                               |
| ----------- | ----------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `baseUrl`   | `string`                            | `https://api.themeparks.wiki/v1` | API base URL (point at a mock / staging if you need to).                                              |
| `userAgent` | `string`                            | `themeparks-sdk-js/<version>`    | Sent as the `User-Agent` header. Set this to identify your app.                                       |
| `fetch`     | `typeof fetch`                      | `globalThis.fetch`               | Custom fetch implementation. Useful for logging, mocking, or older runtimes.                          |
| `timeoutMs` | `number`                            | `10000`                          | Per-request timeout in milliseconds.                                                                  |
| `retry`     | `Partial<RetryConfig>`              | `{ max: 3, on429: true }`        | Retry/backoff behavior. `max` counts retries **beyond** the initial attempt (so `3` = up to 4 total). |
| `cache`     | `Cache \| false \| { maxEntries? }` | in-memory LRU                    | See [Caching](#caching) below. `false` disables caching entirely.                                     |

Example:

```ts
const tp = new ThemeParks({
  userAgent: 'my-app/1.2.3 (+https://example.com)',
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

```ts
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

```ts
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

```ts
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

## Low-level escape hatch

Every ergonomic helper is built on top of `tp.raw`, which is a thin, typed 1:1 wrapper over the OpenAPI operations. Use it directly when you want the raw response shape:

```ts
const live = await tp.raw.getEntityLive('75ea578a-adc8-4116-a54d-dccb60765ef9');
const dests = await tp.raw.getDestinations();
const children = await tp.raw.getEntityChildren(wdw!.id);
```

## Error handling

All SDK errors inherit from `ThemeParksError`. The ones you'll typically catch:

```ts
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

```ts
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

| Endpoint                              | TTL        | Rationale                         |
| ------------------------------------- | ---------- | --------------------------------- |
| `GET /destinations`                   | 1 hour     | Directory rarely changes.         |
| `GET /entity/{id}`                    | 1 hour     | Entity metadata is static.        |
| `GET /entity/{id}/children`           | 1 hour     | Park topology is stable.          |
| `GET /entity/{id}/schedule[/yyyy/mm]` | 5 minutes  | Schedules update but not rapidly. |
| `GET /entity/{id}/live`               | 0 (bypass) | Live data is always fetched.      |

### Disable caching

```ts
const tp = new ThemeParks({ cache: false });
```

### Plug in your own adapter

`Cache` is a structural interface — any object implementing `get`, `set`, and `delete` works. Redis, filesystem, IndexedDB, etc.:

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

- Node 18, 20, 22
- Evergreen browsers
- Deno
- Bun
- Cloudflare Workers

## Links

- **SDK documentation:** https://themeparks.github.io/ThemeParks_JavaScript/
- **API reference:** https://themeparks.github.io/ThemeParks_JavaScript/modules.html
- **Cookbook:** https://themeparks.github.io/ThemeParks_JavaScript/cookbook/
- **Underlying API:** https://api.themeparks.wiki
- **Issues:** https://github.com/ThemeParks/ThemeParks_JavaScript/issues
- **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

## License

MIT.
