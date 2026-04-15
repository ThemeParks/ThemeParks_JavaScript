# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
