# Cookbook

Five complete recipes you can copy, paste, and run. Each uses real entity
IDs from the live ThemeParks.wiki API.

Entity IDs used throughout:

- Magic Kingdom: `75ea578a-adc8-4116-a54d-dccb60765ef9`
- Walt Disney World Resort: `e957da41-3552-4cf6-b636-5babc5cbc4e5`

## Recipe 1 — Wait times in order (longest → shortest)

Pull the live data for Magic Kingdom, keep only the rides that are reporting
a wait time, and print them sorted from longest to shortest queue.

```ts
import { ThemeParks, currentWaitTime } from 'themeparks';

const MAGIC_KINGDOM = '75ea578a-adc8-4116-a54d-dccb60765ef9';

const tp = new ThemeParks();
const live = await tp.entity(MAGIC_KINGDOM).live();

const waits = (live.liveData ?? [])
  .map((entry) => ({ name: entry.name, wait: currentWaitTime(entry) }))
  .filter((w): w is { name: string; wait: number } => w.wait !== null)
  .sort((a, b) => b.wait - a.wait);

for (const { name, wait } of waits) {
  console.log(`${String(wait).padStart(3)} min  ${name}`);
}
```

Sample output:

```
 90 min  Seven Dwarfs Mine Train
 75 min  TRON Lightcycle / Run
 65 min  Space Mountain
 55 min  Peter Pan's Flight
 45 min  Big Thunder Mountain Railroad
 40 min  Jungle Cruise
 35 min  Haunted Mansion
 ...
```

`currentWaitTime` returns `null` for entities that don't have a STANDBY queue
right now (closed rides, shows, restaurants), which is why we filter those
out before sorting.

## Recipe 2 — Schedule for the next 7 days

Use `schedule.range(start, end)` to pull every schedule entry for a 7-day
window. A single date can have multiple entries — regular operating hours,
EXTRA_HOURS (early entry / extended evening), and TICKETED_EVENT (after-hours
events). `range()` returns them all in chronological order across any month
boundaries.

```ts
import { ThemeParks } from 'themeparks';

const MAGIC_KINGDOM = '75ea578a-adc8-4116-a54d-dccb60765ef9';

const tp = new ThemeParks();
const today = new Date();
const sevenDays = new Date(today);
sevenDays.setDate(today.getDate() + 7);

const entries = await tp.entity(MAGIC_KINGDOM).schedule.range(today, sevenDays);

for (const entry of entries) {
  if (entry.type === 'OPERATING') {
    console.log(`${entry.date}  ${entry.openingTime} → ${entry.closingTime}  (${entry.type})`);
  } else {
    console.log(`${entry.date}  ${entry.type}`);
  }
}
```

Sample output:

```
2026-04-15  2026-04-15T09:00:00-04:00 → 2026-04-15T22:00:00-04:00  (OPERATING)
2026-04-15  2026-04-15T17:00:00-04:00 → 2026-04-15T19:00:00-04:00  (TICKETED_EVENT)
2026-04-16  2026-04-16T09:00:00-04:00 → 2026-04-16T23:00:00-04:00  (OPERATING)
2026-04-17  2026-04-17T08:30:00-04:00 → 2026-04-17T09:00:00-04:00  (EXTRA_HOURS)
2026-04-17  2026-04-17T09:00:00-04:00 → 2026-04-17T22:00:00-04:00  (OPERATING)
...
```

## Recipe 3 — All entity geo-locations, grouped by type

`entity(destinationId).walk()` enumerates every descendant of a destination
(parks, attractions, restaurants, hotels, shows). Group the ones with known
coordinates by `entityType`:

> **One API call.** The `/children` endpoint returns the entire descendant
> tree in a single response, so even for the largest destinations this is
> one HTTP request.

```ts
import { ThemeParks } from 'themeparks';

const WALT_DISNEY_WORLD = 'e957da41-3552-4cf6-b636-5babc5cbc4e5';

const tp = new ThemeParks();

const byType = new Map<string, Array<{ name: string; lat: number; lng: number }>>();

for await (const child of tp.entity(WALT_DISNEY_WORLD).walk()) {
  const loc = child.location;
  if (!loc || loc.latitude == null || loc.longitude == null) continue;
  const bucket = byType.get(child.entityType) ?? [];
  bucket.push({ name: child.name, lat: loc.latitude, lng: loc.longitude });
  byType.set(child.entityType, bucket);
}

for (const [type, items] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`\n${type} (${items.length})`);
  console.log('='.repeat(40));
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, lat, lng } of items) {
    console.log(`  ${lat.toFixed(6).padStart(10)}, ${lng.toFixed(6).padStart(11)}  ${name}`);
  }
}
```

Sample output:

```
ATTRACTION (78)
========================================
   28.418250,  -81.581417  Astro Orbiter
   28.420278,  -81.583944  Big Thunder Mountain Railroad
   ...

HOTEL (33)
========================================
   28.371333,  -81.555111  Disney's All-Star Movies Resort
   ...

PARK (4)
========================================
   28.385233,  -81.563867  Disney's Animal Kingdom Theme Park
   ...

RESTAURANT (218)
========================================
   ...
```

## Recipe 4 — See every HTTP request the SDK makes

There's no built-in HTTP logger to flip on (the SDK runs directly on platform
`fetch`). The clean idiom is to pass a wrapping `fetch` implementation:

```ts
import { ThemeParks } from 'themeparks';

const tp = new ThemeParks({
  fetch: async (url, init) => {
    const started = Date.now();
    console.log('→', init?.method ?? 'GET', url);
    const res = await fetch(url, init);
    console.log('←', res.status, url, `(${Date.now() - started}ms)`);
    return res;
  },
  cache: false, // so every call goes through the wrapper
});

await tp.destinations.list();
await tp.entity('75ea578a-adc8-4116-a54d-dccb60765ef9').live();
```

Output:

```
→ GET https://api.themeparks.wiki/v1/destinations
← 200 https://api.themeparks.wiki/v1/destinations (142ms)
→ GET https://api.themeparks.wiki/v1/entity/75ea578a-adc8-4116-a54d-dccb60765ef9/live
← 200 https://api.themeparks.wiki/v1/entity/75ea578a-adc8-4116-a54d-dccb60765ef9/live (98ms)
```

> **Tip:** requests served from the in-memory cache do **not** appear in the
> wrapper — they're returned before the transport is touched. Pass
> `cache: false` while debugging to force every call to hit the network.

## Recipe 5 — Read every queue variant, not just standby

An attraction can expose more than one queue type at the same time — a
classic Disney ride often has STANDBY plus PAID_RETURN_TIME (Lightning
Lane) plus SINGLE_RIDER. The full set of variants is:

| Variant            | Use case                                            |
| ------------------ | --------------------------------------------------- |
| `STANDBY`          | Regular wait line                                   |
| `SINGLE_RIDER`     | Single-rider line wait                              |
| `PAID_STANDBY`     | Paid express line wait                              |
| `RETURN_TIME`      | Virtual queue (free)                                |
| `PAID_RETURN_TIME` | Lightning Lane / paid return time + price           |
| `BOARDING_GROUP`   | Boarding-group rides (Rise of the Resistance, TRON) |

Print all populated queue variants for every attraction at Magic Kingdom:

```ts
import { ThemeParks } from 'themeparks';

const MAGIC_KINGDOM = '75ea578a-adc8-4116-a54d-dccb60765ef9';

const tp = new ThemeParks();
const live = await tp.entity(MAGIC_KINGDOM).live();

for (const entry of live.liveData ?? []) {
  const q = entry.queue;
  if (!q) continue;
  const name = entry.name.padEnd(40);

  if (q.STANDBY?.waitTime != null) {
    console.log(`${name}  STANDBY        ${q.STANDBY.waitTime} min`);
  }
  if (q.SINGLE_RIDER?.waitTime != null) {
    console.log(`${name}  SINGLE_RIDER   ${q.SINGLE_RIDER.waitTime} min`);
  }
  if (q.PAID_RETURN_TIME) {
    const prt = q.PAID_RETURN_TIME;
    const price = prt.price?.formatted ?? '?';
    console.log(`${name}  LIGHTNING LANE ${price}, return ${prt.returnStart} → ${prt.returnEnd}`);
  }
  if (q.RETURN_TIME) {
    const rt = q.RETURN_TIME;
    console.log(`${name}  VIRTUAL QUEUE  ${rt.returnStart} → ${rt.returnEnd} (${rt.state})`);
  }
  if (q.BOARDING_GROUP) {
    const bg = q.BOARDING_GROUP;
    console.log(
      `${name}  BOARDING GROUP ${bg.currentGroupStart}–${bg.currentGroupEnd}, ` +
        `~${bg.estimatedWait} min, status ${bg.allocationStatus}`,
    );
  }
  if (q.PAID_STANDBY?.waitTime != null) {
    console.log(`${name}  PAID_STANDBY   ${q.PAID_STANDBY.waitTime} min`);
  }
}
```

Sample output:

```
Big Thunder Mountain Railroad             STANDBY        45 min
Big Thunder Mountain Railroad             LIGHTNING LANE $15.00, return 2026-04-15T14:30:00-04:00 → 2026-04-15T15:30:00-04:00
Pirates of the Caribbean                  STANDBY        20 min
TRON Lightcycle / Run                     BOARDING GROUP 38–41, ~25 min, status AVAILABLE
TRON Lightcycle / Run                     LIGHTNING LANE $20.00, return 2026-04-15T15:00:00-04:00 → 2026-04-15T16:00:00-04:00
...
```

### Generic alternative

If branching on every variant is too verbose, `narrowQueues(queue)` flattens
all populated variants into a typed discriminated union you can switch over:

```ts
import { ThemeParks, narrowQueues } from 'themeparks';

const tp = new ThemeParks();
const live = await tp.entity(MAGIC_KINGDOM).live();

for (const entry of live.liveData ?? []) {
  if (!entry.queue) continue;
  for (const q of narrowQueues(entry.queue)) {
    switch (q.type) {
      case 'STANDBY':
      case 'SINGLE_RIDER':
      case 'PAID_STANDBY':
        console.log(entry.name, q.type, q.waitTime);
        break;
      case 'RETURN_TIME':
      case 'PAID_RETURN_TIME':
        console.log(entry.name, q.type, q.returnStart, '→', q.returnEnd);
        break;
      case 'BOARDING_GROUP':
        console.log(entry.name, 'boarding', q.currentGroupStart, '-', q.currentGroupEnd);
        break;
    }
  }
}
```
