# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [8.2.0] - 2026-09-26

### Added

- **The client reads the rate-limit headers, and acts on them.** Both meters,
  the per-minute REST one and the separate hourly history budget, on
  `client.rateLimit`:

  ```js
  tp.rateLimit.rest.remaining;
  tp.rateLimit.history.remaining;
  secondsUntilReset(tp.rateLimit.rest);
  ```

  Every field can be null, and null means the server did not say rather than
  "nothing left". Use `isExhausted`, true only when the server said zero. The
  per-minute figures ride most responses; the hourly history ones are withheld
  from anything a shared cache may store, because they are per-caller; an
  unmetered plan advertises nothing. A response served from a cache is ignored
  entirely, because its figures belong to whoever populated the entry. `reset` is a relative
  countdown frozen when it was read, so `secondsUntilReset` ages it rather
  than returning a stale number.

  A window the server says is spent is now waited out instead of walked into,
  since that request is a certain 429 that also spends budget being refused.
  `retry: { respectRemaining: false }` opts out.

  The hourly history budget is new on the wire; before it there was nothing to
  read.

### Changed

- **Calls may now block before sending.** When the server has said your window
  is spent, or has issued a 429 that is still in force, the client waits rather
  than sending a request certain to be refused. A call that used to return in
  200ms can now take up to `retry.maxRetryAfterMs` (120000) first. That is a
  TOTAL across the call, not per wait: the shared 429 gate and the
  spent-window wait stack, and before the budget existed a 429 carrying both a
  `Retry-After` and a spent window blocked for 180 seconds under a 120 second
  cap. Turn the two halves off with `retry: { respectRemaining: false }` and
  `retry: { on429: false }`.

### Fixed

- **A paged history call crashed on the default configuration.** `#private`
  fields on the transport failed their brand check through the caching Proxy,
  so `history.days()` threw `TypeError: Receiver must be an instance of class
Transport` on page two for anyone who had not passed `cache: false`. Every
  test passed `cache: false`, so none of them saw it.

- **`on429: false` did not opt out.** It threw the error the caller asked for
  and then held their NEXT call for the full `Retry-After` anyway, because the
  shared gate was closed regardless of the setting.

- **The gate timed off the wall clock.** A backward NTP step turned a
  five-second wait into however far the clock moved, unbounded, because the cap
  is applied when the gate is armed and not when it is served. It uses a
  monotonic clock now, as the Python sibling always did.

- **A 429 was waited out once per in-flight request.** The wait belongs to the
  caller, not to whichever request met it, so ten concurrent requests each
  slept their own `Retry-After` and then retried at the same instant,
  re-tripping the limit together. It is taken once now, on a gate shared by the
  whole client, with a little jitter so waiters do not wake in unison. A
  shorter wait arriving while a longer one is in force no longer brings the
  gate forward.

## [8.1.0] - 2026-09-23

### Added

- **`entity(id).history.span()`, `.days()` and `.changeRows()`** — the loop
  above the three history calls.

  ```js
  const history = tp.entity(DISNEYLAND).history;
  const span = await history.span();
  for await (const { entityId, row } of history.days({
    from: span.archiveFrom,
    to: span.retrievableThrough,
  })) {
    // ...
  }
  ```

  - `span()` returns `archiveFrom`, `recordedTo` and `retrievableThrough` in
    one shape. The underlying coverage documents do not: a park nests them
    under `summary`, an entity carries them at the top level under different
    names, so without this every caller writes that branch first.
    `retrievableThrough` is the end date to bound a backfill by, because it is
    what the key may read rather than what the archive holds.
  - `days()` pages until the server stops offering a `next`, following that URL
    verbatim, and yields `{ entityId, row }` as rows arrive rather than
    collecting them. A park's daily call is the one paged call in the family,
    so without this a park backfill silently stopped at the first 31 days.
  - Both flatten a park envelope and an entity envelope to the same stream, so
    a caller writes one loop and does not branch on `'entities' in res`.
  - `BudgetExhaustedError` (a `RateLimitError`) is thrown when the history
    budget is spent and the server asks for longer than `maxWaitMs` (120000 by
    default). It carries `retryAfterMs`, so a backfill can checkpoint and
    resume rather than hold a process open for most of an hour.

- **`examples/backfill.mjs`** — a complete backfill with resume and NDJSON or
  CSV output. It pulled Disneyland Resort's whole daily archive, 98,452 rows,
  in one run.

### Fixed

- **A 429 could park the client for hours.** The transport honoured any
  `Retry-After` up to `retry.max` times. That is right for a REST 429, which
  asks for seconds, and wrong for a history 429: that budget is hourly, so a
  spent one can ask for most of an hour, and three of those is roughly two and
  a half hours of a silent process. `RetryConfig` gains `maxRetryAfterMs`
  (120000 by default): past it the client does not sleep at all and throws
  `RateLimitError` with `retryAfterMs` set.

- **`EntityHistoryCoverage` was missing the park shape.**
  `/entity/{id}/history/coverage` answers a PARK with
  `HistoryParkCoverageDocument`, the same way `/history` and `/history/daily`
  do, and the type named only `HistoryCoverageDocument`. The two do not
  overlap where it counts: a park carries `summary` and `fields`, an entity
  carries `firstRecordedAt`, `lastRecordedAt` and `kinds`. A TypeScript user
  read `.kinds` off a park's coverage, got `undefined` at runtime, and the
  compiler said nothing. The fixture that covered this was hand-written in the
  entity shape and named after a park, so it agreed with the code for the same
  reason the code was wrong; both coverage fixtures are now captured from
  production, and the live smoke test asserts the park shape it actually gets.

- **The user agent announced the wrong version.** `PACKAGE_VERSION` was still
  `7.0.0-alpha.0` in a package at `8.0.0`, so every request announced a version
  a major old and nothing failed. A gate test now asserts the `User-Agent` the
  server actually receives carries the version `package.json` declares, so
  forgetting the bump is a red test rather than a quiet lie in a header.

- **`apiKey` client option.** Sent as the `X-API-Key` header on every
  request. Every endpoint still answers without one; a key raises the limits,
  which matters for the history endpoints (30 days of history and 600
  requests an hour with a free key, against 7 days and 60 without).

  ```js
  const tp = new ThemeParks({ apiKey: 'your-api-key' });
  ```

- **History endpoints.** `tp.entity(id).history.changes(query)`,
  `.daily(query)` and `.coverage()` over `GET /entity/{id}/history`,
  `/history/daily` and `/history/coverage`, with `tp.raw.getEntityHistory`,
  `getEntityHistoryDaily` and `getEntityHistoryCoverage` underneath. The
  query is `{ date }` or `{ from, to }`, park-local days or RFC 3339
  instants, and is sent through `URLSearchParams`, so an instant's `+02:00`
  offset survives the trip. A `PARK` answers with `entities[]` for every
  entity in it; every other type answers for itself. New exported types:
  `EntityHistory`, `EntityHistoryDaily`, `EntityHistoryCoverage`,
  `HistoryQuery`.

  ```js
  const day = await tp.entity(barnstormerId).history.changes({ date: '2026-09-17' });
  if (!('entities' in day)) {
    for (const row of day.history) console.log(row.time, row.queue?.STANDBY?.waitTime);
  }
  ```

  The default cache keeps `coverage` for an hour and leaves `changes` and
  `daily` uncached, since a range that holds today is not final.

## [8.0.0] - 2026-09-08

### Fixed

- **Schedule entries now expose `purchases`, and `type` is a union again.**
  The upstream spec described a park's schedule two different ways: precisely
  when nested under a destination, loosely when fetched directly. The direct
  path is the one this client uses, so `purchases` was invisible and `type`
  was a bare `string`.

  Magic Kingdom served 26 of 79 upcoming entries with `purchases` on the day
  this shipped. If you reached them before, you did it with a cast. You no
  longer need to:

  ```ts
  const sched = await tp.entity(parkId).schedule.upcoming();
  for (const day of sched.schedule ?? []) {
    for (const p of day.purchases ?? []) {
      console.log(day.date, p.name, p.price.amount, p.price.currency);
      // 2026-09-08 Lightning Lane for Seven Dwarfs Mine Train 1100 USD
    }
  }
  ```

  Purchases are not limited to `TICKETED_EVENT` days — Lightning Lane entries
  attach to ordinary `OPERATING` days, so do not filter on `type` to find
  them.

- **`purchases[].price.amount` is nullable, matching `PriceData`.** 7.1.0 made
  `PriceData.amount` nullable but the schedule path carried a second, inline
  copy of the price shape that kept `amount` non-nullable. Both now resolve to
  one `PriceData`. Tokyo Disneyland serves six Premier Access rows with a null
  amount right now, so this was a type that disagreed with production.

- Schedule entries gained the `description` field the API has always sent.

### Changed

- **BREAKING — `tags[].value` is now `unknown`.** The spec declares no type
  for it, only a prose description, so the previous
  `string | number | Record<string, never>` was an invention. Narrow before
  use:

  ```ts
  const v = entity.tags?.[0]?.value;
  if (typeof v === 'string') {
    /* ... */
  }
  ```

- **BREAKING — nullability tightened where the API never sends null.**
  `location` on entities and children is no longer `| null`, and
  `purchases[].type` is no longer `| null`. Verified against production: 412
  sampled children all carried a location, 255 sampled purchases all carried a
  type. Comparisons against `null` on these will now fail to compile.

- `destinations` on the destinations response is required rather than
  optional, and a destination's `parks` are typed as their own shape rather
  than recursively as a schedule response.

- **BREAKING — minimum supported Node is now 20.** Node 18 reached end of life
  on 2025-04-30 and is no longer tested. `engines` moves from `>=18` to
  `>=20`, and CI runs Node 20, 22 and 24.

  Nothing in the shipped bundle needed Node 18 specifically; the constraint
  arrives from the dev toolchain, where eslint 10 and vitest 4 both require
  Node 20 or newer. Rather than keep claiming support for a runtime nothing
  verifies, the claim is withdrawn. If you are still on Node 18, stay on
  7.1.x.

- Dev dependencies: eslint 9 to 10, vitest 1 to 4.

  TypeScript stays on 5.x. `openapi-typescript@7.13.0` still declares
  `peer typescript@"^5.x"`, so TypeScript 6 cannot be installed here until
  that range widens upstream.

## [7.1.0] - 2026-09-01

### Fixed

- `PriceData.amount` is now `number | null`, matching the API spec, which has
  declared this field nullable for some time. The API returns `null` when a
  paid queue exists but the provider does not publish a price; `0` is reserved
  for a queue that is genuinely free. The two were previously conflated as `0`.

  **This is a compile break for strict TypeScript consumers.** If you read
  `price.amount` directly you will now get `TS18047: 'amount' is possibly
'null'` or `TS2322`. Narrow it first:

  ```ts
  const amount = queue.PAID_RETURN_TIME?.price.amount;
  const label = amount === null ? 'price not published' : formatCents(amount);
  ```

  Runtime output is unchanged — the emitted JS is byte-identical, only the
  type declarations move. Plain-JavaScript and non-strict consumers are
  unaffected. See MIGRATION.md.

## [7.0.0] - 2026-04-15

First stable v7 release. After two alpha iterations (`alpha.0`/`alpha.1` blocked
by CI release-pipeline issues, `alpha.2` published to `next` dist-tag) the
public surface is unchanged. Also landed post-alpha.2:

- Docs site deploys the hand-written cookbook alongside the generated API ref.
- README and cookbook examples are plain JavaScript (previously mixed
  TypeScript syntax into blocks labeled runnable).
- Dependabot action bumps merged (`actions/checkout`, `deploy-pages`,
  `upload-pages-artifact`, `create-pull-request`, `action-gh-release`).

## [7.0.0-alpha.0] - 2026-04-15

### Added

- Full TypeScript rewrite; dual ESM + CJS output.
- Sync-by-default API built on platform `fetch` (Node 18+, browsers, Deno, Bun, Workers).
- Ergonomic `tp.entity(id)` navigation with `walk()`, `schedule.range()`,
  discriminated-union `narrowQueues()` and `currentWaitTime()` helpers.
- Default-on per-endpoint caching with pluggable adapter.
- 429 `Retry-After` handling.
- Types generated from the upstream OpenAPI spec; post-gen patches not needed
  (openapi-typescript handles nullability correctly).

### Removed

- Legacy `Themeparks.DestinationsApi` / `EntitiesApi` generated surface.
  See [MIGRATION.md](./MIGRATION.md).
- Babel 7 toolchain, `superagent`, `mocha`.
