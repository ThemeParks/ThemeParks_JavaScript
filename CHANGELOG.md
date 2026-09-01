# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
