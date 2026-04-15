# themeparks — TypeScript/JavaScript SDK

A typed, modern SDK for the [ThemeParks.wiki](https://api.themeparks.wiki) API.
Zero runtime dependencies, built on platform `fetch`, default-on caching, and
ergonomic helpers for the common workflows.

## Quickstart

```bash
npm i themeparks
```

```ts
import { ThemeParks, currentWaitTime } from 'themeparks';

const tp = new ThemeParks();
const live = await tp.entity('75ea578a-adc8-4116-a54d-dccb60765ef9').live();
for (const entry of live.liveData ?? []) {
  const wait = currentWaitTime(entry);
  if (wait !== null) console.log(`${entry.name}: ${wait} min`);
}
```

See the [README](https://github.com/ThemeParks/ThemeParks_JavaScript#readme)
for the full getting-started walkthrough.

## Guides

- **[Cookbook](./cookbook.md)** — five copy-paste recipes using real entity IDs.
- **[Migration guide (v6 → v7)](https://github.com/ThemeParks/ThemeParks_JavaScript/blob/main/MIGRATION.md)** — side-by-side upgrade notes.
- **[Changelog](https://github.com/ThemeParks/ThemeParks_JavaScript/blob/main/CHANGELOG.md)** — release notes.

## API reference

The full TypeScript API reference is generated from source with TypeDoc and
lives alongside these guides on this site (see the top navigation). Key
entry points:

- `ThemeParks` — the main client class.
- `currentWaitTime`, `narrowQueues` — live-data helpers.
- `ApiError`, `RateLimitError`, `NetworkError`, `TimeoutError` — typed errors.
- `Cache`, `InMemoryLruCache` — caching adapter.

## Links

- **Repository:** https://github.com/ThemeParks/ThemeParks_JavaScript
- **Underlying API:** https://api.themeparks.wiki
- **Issues:** https://github.com/ThemeParks/ThemeParks_JavaScript/issues
