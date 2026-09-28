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
import { run } from './backfill.js';

// Ctrl-C says how to continue, like the Python SDK. 130 is the shell's convention
// for SIGINT, and the state files on disk already say where each park got to.
process.on('SIGINT', () => {
  process.stderr.write('\nstopped. Run the same command again to continue.\n');
  process.exit(130);
});

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
