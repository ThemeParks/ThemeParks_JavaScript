# Migrating from v6 to v7

v7 is a full rewrite. The package name on npm is still `themeparks`, but the
import surface has changed. This guide walks through the common patterns.

If you are blocked on a migration detail not covered here, please open an
issue: https://github.com/ThemeParks/ThemeParks_JavaScript/issues

## TL;DR

- Replace the default/namespace import with a named `ThemeParks` import.
- One client object; `tp.destinations`, `tp.entity(...)`, and `tp.raw.*` replace
  the per-resource classes.
- All response types are real TypeScript types — no more `any`.
- Ad-hoc `{ body, response, status }` error shapes are replaced with typed
  `ApiError` / `RateLimitError` / `NetworkError` / `TimeoutError`.

## Imports and client setup

### v6

```js
const Themeparks = require('themeparks');
// or: import Themeparks from 'themeparks';

const destinationsApi = new Themeparks.DestinationsApi();
const entitiesApi = new Themeparks.EntitiesApi();
```

### v7

```ts
import { ThemeParks } from 'themeparks';

const tp = new ThemeParks();
// tp.destinations, tp.entity(...), tp.raw.*
```

One client, fully typed.

## Listing destinations

### v6

```js
const response = await destinationsApi.getDestinations();
for (const d of response.destinations) {
  console.log(d.id, d.name);
}
```

### v7

```ts
// Ergonomic
const resp = await tp.destinations.list();
for (const d of resp.destinations ?? []) {
  console.log(d.id, d.name);
}

// Or raw (same return type)
const resp2 = await tp.raw.getDestinations();
```

## Fetching an entity

### v6

```js
const entity = await entitiesApi.getEntity(entityId);
console.log(entity.name, entity.entityType);
```

### v7

```ts
const entity = await tp.entity(entityId).get(); // ergonomic
const entityRaw = await tp.raw.getEntity(entityId); // raw
console.log(entity.name, entity.entityType);
```

## Live wait times

Queue fields are now correctly typed end-to-end. Null `waitTime` is
`number | null` rather than an untyped surprise.

### v7

```ts
import { ThemeParks, currentWaitTime } from 'themeparks';

const tp = new ThemeParks();
const live = await tp.entity(parkId).live();
for (const item of live.liveData ?? []) {
  const wait = currentWaitTime(item);
  if (wait === null) {
    console.log(`${item.name}: closed / no data`);
  } else {
    console.log(`${item.name}: ${wait} min`);
  }
}
```

## Error handling

### v6

```js
try {
  await entitiesApi.getEntity(entityId);
} catch (err) {
  // ad-hoc shape — { body, response, status } or a raw superagent error
  console.log(err.status, err.body);
}
```

### v7

```ts
import { ApiError, RateLimitError, NetworkError, TimeoutError } from 'themeparks';

try {
  await tp.entity(entityId).get();
} catch (err) {
  if (err instanceof RateLimitError) {
    // 429: err.retryAfterMs is set if the server sent a Retry-After header
  } else if (err instanceof ApiError) {
    console.log(err.status, err.url, err.body);
  } else if (err instanceof NetworkError || err instanceof TimeoutError) {
    // transport failure
  } else {
    throw err;
  }
}
```

All four inherit from `ThemeParksError` if you want a single catch-all.

## New in v7 (not in v6)

- `tp.entity(id).walk()` — async iterator over every descendant in a single
  API call (the `/children` endpoint already returns the full subtree).
- `tp.entity(id).schedule.range(start, end)` — stitches monthly schedule
  responses into a sorted, filtered list across a date range.
- `tp.destinations.find(query)` — case-insensitive lookup by slug or name.
- `currentWaitTime(entry)` — null-safe standby-wait accessor.
- `narrowQueues(queue)` — typed discriminated-union iterator over populated
  queue variants.
- Default-on response caching with per-endpoint TTLs (see README).
- Automatic 429 `Retry-After` handling.
- First-class TypeScript types generated from the upstream OpenAPI spec.
