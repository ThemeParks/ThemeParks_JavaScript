## history_rate_limited.json

The hourly history budget's 429, in the shape the API sends it
(`{error: {type, message, retryAfter}}`, with `Retry-After` in seconds alongside). `retryAfter` is longer than the SDK's
120s `maxWaitMs`, which is what turns it into `BudgetExhaustedError` rather
than a retry — the distinction the back fill's exit 75 depends on.

**This one is hand-written, not captured**, and the SDK reads only the
`Retry-After` header, never the body — so replacing this body with nonsense
leaves the suite green. What it does not prove is that a real hourly-budget 429
carries that header. Capturing one costs an hour of a metered key's budget; until
then, treat the header contract as unverified against production.

## mk_park_daily_page1.json / mk_park_daily_page2.json

Two consecutive pages of one real request, captured 2026-09-28:
`GET /entity/75ea578a-adc8-4116-a54d-dccb60765ef9/history/daily?from=2026-08-01&to=2026-09-20`
then its `next` followed verbatim. Trimmed to three entities (an attraction, a
show, a restaurant) and otherwise untouched: `range`, `next` and every row are
the server's.

They are the oracle for resumable paging. Page 1 covers through 2026-08-31 and
the server says continue at 2026-09-01, but two of its three entities have no
rows after 2026-08-30 — so a checkpoint taken from the newest ROW rewinds and
re-downloads days already written. On the full 72-entity capture the same page
holds 1,684 rows, of which every one carries `unknownMinutes` and an
`inParkHours` block that the published schema does not mention.
