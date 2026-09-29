#!/usr/bin/env node
/**
 * The `themeparks-backfill` executable. Nothing but the call.
 *
 * This is a separate file because of how the previous version failed. The runner
 * lived at the bottom of `backfill.ts` behind
 *
 *   import.meta.url === pathToFileURL(process.argv[1]).href
 *
 * which is the usual "am I the entry point" test and is WRONG for an installed
 * binary: npm puts a symlink in `node_modules/.bin`, so argv[1] is the link's
 * path and the module's URL is the real file's. The comparison failed, `main`
 * never ran, and `npx themeparks-backfill --version` printed nothing and exited
 * 0. It passed every test in the suite and worked in the repo, where the file IS
 * invoked by its own path; only installing the tarball and running the binary
 * showed it.
 *
 * A file whose only job is to run has no condition to get wrong.
 */
import { releaseLocks, run } from './backfill.js';

// Ctrl-C, or a scheduler's SIGTERM, says how to continue, like the Python SDK.
// Exiting straight away is safe: the state file is rewritten atomically after
// every complete page, and the next run cuts off any rows written after that
// checkpoint before resuming, so an interrupted page is fetched again rather
// than appended twice. The locks are released so the next run need not wait
// to find them stale. 130 and 143 are the shell's conventions (128 + signal).
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.on(signal, () => {
    releaseLocks();
    process.stderr.write('\nstopped. Run the same command again to continue.\n');
    process.exit(code);
  });
}

run().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Anything `run` did not recognise. The stack is deliberate: an unexpected
    // failure with no detail is worse than an ugly one.
    console.error(error);
    process.exitCode = 1;
  },
);
