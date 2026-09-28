# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`themeparks-backfill --since YYYY-MM-DD` and `--until YYYY-MM-DD`.** There
  was no way to ask for less than everything: `--since` was an unknown option,
  so a key that reaches the whole archive downloaded all of it, every time. Both
  days are inclusive and must be real calendar days written `YYYY-MM-DD`
  (`2025-02-30`, `2025-1-1` and `20250101` are refused), and `--since` after
  `--until` is refused before anything is requested. `--since` applies when a
  file is started. A later run accepts the same `--since` or a later one, so a
  fixed or a rolling cron line both work, and refuses one earlier than the day
  the file was started from, or one that would leave a gap, with what to do
  instead of quietly handing back a file that is not what was asked for.

- **`history.changeRows()` exposes the `opening` state.** The raw history
  response carries, per entity, the state in force at the start of the range,
  and `changeRows()` threw it away. Without it the time between midnight and an
  entity's first change had no known status, so a day rebuilt from raw history
  disagreed with the daily summary whenever a ride was still running from the
  night before. The result is still the same async generator and yields exactly
  what it always did; it now also has `opening`, an object of `HistoryOpening`
  keyed by entity id, covering every entity in the response, including one that
  did not change all day. It is readable once the response has arrived: iterate
  first, or `await changes.load()`. Either way it is one request. The
  `HistoryChanges` and `HistoryOpening` types are exported.

- **`HistorySpan.finalThrough`**: the newest day whose daily row will not change
  again, the earlier of `recordedTo` and `retrievableThrough`.

### Fixed

- **A finished park now updates on the next run.** A rerun printed
  `already complete` and exited 0 without fetching a single new day, so a nightly
  cron looked healthy and never updated; the only way to get yesterday was
  `--overwrite`, which downloads the whole archive again. A finished file is now
  carried forward from the day after its last one, appending only the new days.
  An interrupted run still resumes at its page boundary, including a rerun
  interrupted before its first page, which would otherwise have started again
  from the top of the file's range.

- **The newest rows of a backfill were partial days, and stayed that way.** A run
  ended on `retrievableThrough`, which is usually today: today's row is the day
  so far, and the archive records days 2 to 3 behind live data, so the last few
  days of every file were still changing when they were written. A run now ends
  at `finalThrough`, says so when it holds days back, and the next run adds them
  once they are final. Every row in the file is one that will not change.

  **Files written by 8.3.x are corrected once.** Their state file does not say
  which of their newest days were final, so the first run of this version
  removes the rows dated within seven days of that run's end and fetches those
  days again. Every other row is left byte for byte as it was, and a file whose
  newest row is older than that is not rewritten at all. A file that lies wholly
  inside those seven days, as an anonymous run's does, is downloaded again. The
  state file format moves to version 2 for this; version 1 files from this SDK
  are upgraded, not refused.

- **A continued file no longer jumps forward to the key's first day.** When the
  day a file continues from is older than the key may read (a cron that did not
  run for longer than the key's window, or a key that lost its plan), the run
  used to carry on from the key's first day and leave a gap the file then did not
  record. It is refused now, the file is left alone, and the message says how to
  start again.

- **A finished file written to a different column layout was appended to.** Only
  an unfinished one was refused. A finished one fell through to a fresh start,
  which opened the existing file in append mode and wrote the whole archive into
  it a second time under a second header, exit 0. It is refused now, the same
  way.

- **A state file whose data file had been deleted was continued**, producing a
  file that started part-way through its range and was then recorded as
  complete. The park is downloaded again from the start instead.

## [8.3.1] - 2026-09-28

### Fixed

- **A run with no API key now says so when it finishes**, not only when it
  starts. Without a key the command SUCCEEDS: it reads the 7 days anonymous
  access allows, writes 433 rows of Magic Kingdom instead of about 94,000, and
  exits 0. The notice was printed before a run that takes minutes, so it scrolled
  away, and the last thing on screen was `done: 433 rows` — which for someone who
  has just paid for 400 days is indistinguishable from success. There is a file,
  there is no error, and the number means nothing unless you already know what it
  should have been.

  The README and `--help` now `export THEMEPARKS_API_KEY` before the example that
  needs it, and still say `--list` does not: finding a park before you have paid
  is the point of that flag.

### Added

- **A committed mutant list** (`test/mutation/mutants.json`) and a nightly,
  non-gating job that runs it. An author-written mutant list contains the
  mutations that author's tests already catch — one scored 18/18 on this package
  while an independent sweep found ten survivors. The list is committed so a
  reviewer can see what is checked and, more usefully, what is not. One mutant
  targets the generated column list, so the shared `csv_contract.json` fixture is
  exercised as a mutation as well as a test: renaming a column there must turn
  the suite red, or the two SDKs can drift apart again.

## [8.3.0] - 2026-09-28

### Added

- **`themeparks-backfill`: the archive download as a command.** The Python SDK
  shipped this first; this is the same tool, and the two write byte-for-byte
  identical CSVs. Magic Kingdom's full five-year archive: 94,223 rows, 41 columns,
  identical from both, the only differences being today's row, which grows as the
  day elapses.

  ```bash
  npm install themeparks
  npx themeparks-backfill "magic kingdom"
  ```

  - Takes a park or a **destination**, by name or id, and a name that identifies one
    park unambiguously is enough. A destination back fills every park in it, one
    file each. An ambiguous name lists the ids that match, sorted by park name.
  - `--list [text]` prints destinations with their parks underneath and **needs no
    key**, so you can find your park before deciding whether to pay.
  - **Runs without a key**, reading the 7 days anonymous access allows, and says
    what a key would add.
  - NDJSON by default, `--format csv` for one wide row per entity per day. Every row
    carries `parkId`, `parkName`, `entityId`, `entityName` and `entityType`, so two
    files load into one table and `(entityId, date)` is the natural key. The entity
    name is the one the history response gave for those rows, not the park's current
    children list: rides get renamed, and today's name on a row from three years ago
    rewrites the record. Files are named for the park's id, because names change.
  - The CSV carries a **UTF-8 BOM** so Excel on Windows does not mangle `®` and
    accents, and a cell a spreadsheet would execute as a formula is prefixed with an
    apostrophe. Numeric cells are untouched, so a negative number stays a number.
  - **Resumable.** It checkpoints against the hourly history budget and exits 75
    (`EX_TEMPFAIL`), so a cron or systemd timer retries rather than alerting, and
    running the same command again continues. The checkpoint is the day the server's
    own `next` URL starts on, never the newest row written -- an entity that stopped
    reporting has no rows for the tail days of its page, so resuming from a row
    re-fetches days already in the file.
  - The state file is `<parkId>.<format>.backfill-state.json` and records the SDK,
    its version, a state version and a fingerprint of the exact header. Anything
    that does not match is refused with a message saying why, never resumed --
    including a state file written by the Python SDK, whose keys differ.
  - One park's failure does not abandon the rest of a destination; what did not
    finish is named at the end. A network failure or timeout exits 75, anything the
    API rejected exits 1, and neither is a traceback.
  - An earlier run's rows are never deleted. A failure or a closed window on a
    resumed run keeps the file and says the run did not finish.

- **`onPage` on `days()`**, called once every row of a page has been yielded, with a
  `HistoryPage` (`from`, `to`, `next`). The page boundary is the server's own answer
  to "where do I carry on", and the rows cannot tell you -- so it is the only safe
  checkpoint for a resumable download. `HistoryPage` and `PageOptions` are exported.

- **`DailyEntry` carries `name` and `entityType`**, taken from the history response
  itself. Already in the payload, so nothing has to ask what an id refers to. Both
  are required fields, so a hand-built `DailyEntry` in a test double needs them.

- **`test/fixtures/csv_contract.json`**, an identical copy of which lives in the
  Python SDK. Both suites assert their column list against it, because this is one
  command with two implementations and a customer using both should get one file
  format. Before it existed, this SDK wrote 32 columns and Python wrote 41.

- **`npm run test:package`**, in CI and `prepublishOnly`: it packs the tarball,
  installs it elsewhere and runs the binary. See below for why.

### Fixed

- **The vendored OpenAPI schema was stale.** `unknownMinutes`, `inParkHours` (the
  day's numbers limited to the park's published hours) and `extremeWaits` (how many
  readings of 480+ minutes are folded into the statistics, which is how you spot a
  feed error) are on the rows the API returns and were in none of the types. The CSV
  column list is now **generated from the spec**, the nightly drift job commits it
  alongside the schema, and the generator refuses a duplicate column name or a
  missing nested block.

- **A failed write was reported as success.** Node hands `end`'s callback the
  stream's error; the callback took no arguments and resolved regardless, so on
  ENOSPC or EDQUOT mid-download the command printed `done: N rows`, recorded
  `complete: true` and exited 0 with a truncated file that no rerun would continue.
  The stream also had no `'error'` listener until the flush, so an earlier failure
  became an unhandled `'error'` event that killed the whole run.

- **A bare `\r` in an entity name was written unquoted**, so one row parsed as two
  with every later column shifted.

- **`--list` with no value exited 2** although the help advertises `--list [TEXT]`;
  `-h` was not accepted; a query that folds to nothing (`東京`) listed all 127 parks
  instead of none; an empty `--api-key` or `THEMEPARKS_API_KEY=""` counted as a key;
  running with no arguments fetched `/destinations` before saying so, which exited
  75 with no network; `--version` printed a bare number; and the 404 hint for a
  mistyped id sat where nothing could reach it.

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
