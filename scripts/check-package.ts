/**
 * Pack the tarball, install it somewhere else, and run the binary.
 *
 * This exists because of a defect that passed the whole unit suite, worked in the
 * repo, and would have shipped: the executable's "am I the entry point" guard
 * compared `import.meta.url` against `process.argv[1]`, and npm installs a binary
 * as a SYMLINK in `node_modules/.bin`. The paths differ, the guard was false, and
 * `npx themeparks-backfill --version` printed nothing and exited 0.
 *
 * Nothing short of installing it shows that. So: pack, install into a temporary
 * directory, run the binary the way a customer does, and require real output.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'themeparks-package-'));

function sh(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  sh('npm', ['pack', '--pack-destination', dir], root);
  const tarball = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  if (tarball === undefined) throw new Error('npm pack produced no tarball');

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
  sh('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], dir);

  const bin = join(dir, 'node_modules', '.bin', 'themeparks-backfill');
  const version = sh(bin, ['--version'], dir).trim();
  const expected = JSON.parse(sh('npm', ['pkg', 'get', 'version'], root) as string) as string;
  // Named, matching the Python SDK: a bare number cannot be pasted into a bug report.
  if (version !== `themeparks-backfill ${expected}`) {
    throw new Error(
      `the installed binary printed "${version}", expected "themeparks-backfill ${expected}"`,
    );
  }

  const help = sh(bin, ['--help'], dir);
  if (!help.includes('themeparks-backfill')) throw new Error('--help printed nothing usable');

  // A bare `--list` exits 2 if parseArgs treats the option as value-taking, which is
  // exactly the class of defect only an installed run shows. Needs no key.
  const listed = sh(bin, ['--list', 'epcot'], dir);
  if (!listed.includes('EPCOT')) throw new Error(`--list epcot printed nothing usable: ${listed}`);

  // The library import path, which is a different resolution from the binary.
  const imported = sh(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {ThemeParks} from 'themeparks'; console.log(typeof ThemeParks)",
    ],
    dir,
  ).trim();
  if (imported !== 'function') throw new Error(`importing the package gave ${imported}`);

  console.log(`package ok: binary and import both work from a clean install (${version})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
