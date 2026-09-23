#!/usr/bin/env node
/**
 * Pull a park's whole daily history into a file, and survive the budget.
 *
 *   node examples/backfill.mjs 7340550b-c14d-4def-80bb-acdb51d49a66
 *   node examples/backfill.mjs --format csv PARK_ID_A PARK_ID_B
 *
 * The key comes from --api-key or the THEMEPARKS_API_KEY environment variable.
 *
 * Three things this shows that are easy to get wrong by hand:
 *
 * 1. It asks the PARK, not the rides. Both history endpoints answer every
 *    entity in a park in one request, so a park-level backfill of a large
 *    resort is around a hundred times fewer calls than the same data pulled
 *    ride by ride.
 *
 * 2. It bounds the range with span().retrievableThrough, not with what the
 *    archive holds. Those are different dates on every plan below the top one,
 *    and asking past the entitlement is how a long backfill ends in 403s.
 *
 * 3. It checkpoints. The history budget is hourly, so a spent one can be most
 *    of an hour from resetting. The SDK raises BudgetExhaustedError rather
 *    than sleeping through that; this writes down the last day it wrote and
 *    exits 75 (EX_TEMPFAIL), the code that makes a cron or a systemd timer
 *    retry rather than alert.
 *
 * Re-running picks up from the checkpoint. It re-reads the last day on
 * purpose: a page can end mid-day, and one duplicate day is cheaper to
 * de-duplicate than a missing one is to notice.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BudgetExhaustedError, ThemeParks } from 'themeparks';

const EX_TEMPFAIL = 75;

const CSV_COLUMNS = [
  'entityId',
  'date',
  'firstOperatingAt',
  'lastClosedAt',
  'operatingMinutes',
  'downMinutes',
  'showCount',
  'changes',
  'standbyMin',
  'standbyP50',
  'standbyMean',
  'standbyP90',
  'standbyMax',
  'singleRiderP50',
  'singleRiderMax',
];

/** Flatten the nested standby/singleRider statistics into one wide row. */
function csvRow(entityId, row) {
  const s = row.standby;
  const sr = row.singleRider;
  const cells = [
    entityId,
    row.date,
    row.firstOperatingAt ?? '',
    row.lastClosedAt ?? '',
    row.operatingMinutes,
    row.downMinutes,
    row.showCount ?? '',
    row.changes,
    s?.min ?? '',
    s?.p50 ?? '',
    s?.mean ?? '',
    s?.p90 ?? '',
    s?.max ?? '',
    sr?.p50 ?? '',
    sr?.max ?? '',
  ];
  // No field here can contain a comma or a quote, so this stays a join rather
  // than pulling in a CSV writer.
  return cells.join(',') + '\n';
}

async function backfillPark(tp, parkId, outDir, format) {
  const history = tp.entity(parkId).history;
  const span = await history.span();

  const outPath = join(outDir, `${parkId}.${format === 'csv' ? 'csv' : 'ndjson'}`);
  const checkpointPath = join(outDir, `${parkId}.checkpoint`);

  const resuming = existsSync(checkpointPath);
  const hasRows = existsSync(outPath) && statSync(outPath).size > 0;
  const from = resuming ? readFileSync(checkpointPath, 'utf8').trim() : span.archiveFrom;
  const to = span.retrievableThrough;

  console.error(`${parkId}: ${from} .. ${to}${resuming ? ' (resumed)' : ''} -> ${outPath}`);

  if (format === 'csv' && !hasRows) {
    writeFileSync(outPath, CSV_COLUMNS.join(',') + '\n');
  }

  let written = 0;
  let lastDay = null;
  try {
    for await (const { entityId, row } of history.days({ from, to })) {
      appendFileSync(
        outPath,
        format === 'csv' ? csvRow(entityId, row) : JSON.stringify({ entityId, ...row }) + '\n',
      );
      written++;
      lastDay = row.date;
      if (written % 5000 === 0) console.error(`  ${written} rows, at ${lastDay}`);
    }
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    if (lastDay !== null) writeFileSync(checkpointPath, lastDay);
    const seconds = Math.round((error.retryAfterMs ?? 0) / 1000);
    console.error(
      `  budget spent after ${written} rows at ${lastDay}; rerun in ${seconds}s to continue`,
    );
    return EX_TEMPFAIL;
  }

  rmSync(checkpointPath, { force: true });
  console.error(`  done: ${written} rows`);
  return 0;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'api-key': { type: 'string' },
      format: { type: 'string', default: 'ndjson' },
      out: { type: 'string', default: '.' },
    },
  });

  const apiKey = values['api-key'] ?? process.env.THEMEPARKS_API_KEY;
  if (!apiKey) {
    console.error('no key: pass --api-key or set THEMEPARKS_API_KEY');
    return 2;
  }
  if (positionals.length === 0) {
    console.error('usage: node examples/backfill.mjs [--format csv] [--out DIR] PARK_ID...');
    return 2;
  }
  if (values.format !== 'ndjson' && values.format !== 'csv') {
    console.error(`unknown format ${values.format}; use ndjson or csv`);
    return 2;
  }

  mkdirSync(values.out, { recursive: true });

  // One client for every park: the connection pool is worth reusing, and the
  // budget is per account either way.
  const tp = new ThemeParks({ apiKey, userAgent: 'themeparks-backfill-example/1' });
  for (const parkId of positionals) {
    const status = await backfillPark(tp, parkId, values.out, values.format);
    // Stop at the first exhausted budget. Carrying on to the next park only
    // spends the retry-after on 429s.
    if (status !== 0) return status;
  }
  return 0;
}

process.exitCode = await main();
