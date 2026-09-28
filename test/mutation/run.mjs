#!/usr/bin/env node
/**
 * Apply each committed mutant, run the suite, and report the survivors.
 *
 * A survivor is a change to production code that breaks no test: either the
 * tests are blind to it, or the code does not matter. Both are worth knowing and
 * neither is worth blocking a commit over, so this is a nightly job rather than
 * a gate -- it re-runs the whole suite once per mutant.
 *
 * WHY THE LIST IS COMMITTED rather than generated: a list written by the author
 * of the tests contains the mutations those tests already catch. An
 * author-written set scored 18/18 on this package while an independent sweep
 * found ten survivors. A reviewable list is the part that makes the score mean
 * anything.
 *
 *   node test/mutation/run.mjs           # every mutant
 *   node test/mutation/run.mjs --list    # names only, runs nothing
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const { mutants } = JSON.parse(readFileSync(resolve(HERE, 'mutants.json'), 'utf8'));

if (process.argv.includes('--list')) {
  for (const m of mutants) console.log(`${m.name}\n    ${m.file}: ${m.why}`);
  process.exit(0);
}

const suitePasses = () =>
  spawnSync('npx', ['vitest', 'run', 'test/unit'], { cwd: ROOT, encoding: 'utf8' }).status === 0;

const survived = [];
const stale = [];
let killed = 0;

for (const mutant of mutants) {
  const path = resolve(ROOT, mutant.file);
  const original = readFileSync(path, 'utf8');
  // A mutant whose `find` no longer matches is NOT a pass: the code moved and
  // nobody updated the mutant, so it has been silently testing nothing -- the
  // same failure mode as a test that cannot fail.
  if (!original.includes(mutant.find)) {
    stale.push(mutant);
    console.log(`STALE     ${mutant.name}`);
    continue;
  }
  writeFileSync(path, original.replace(mutant.find, mutant.replace));
  let passed;
  try {
    passed = suitePasses();
  } finally {
    // Restored whatever happened: leaving a mutated tree behind is worse than
    // any result.
    writeFileSync(path, original);
  }
  if (passed) {
    survived.push(mutant);
    console.log(`SURVIVED  ${mutant.name}`);
  } else {
    killed += 1;
    console.log(`killed    ${mutant.name}`);
  }
}

console.log(
  `\n${killed}/${mutants.length} killed, ${survived.length} survived, ${stale.length} stale`,
);
for (const m of survived) console.log(`\nSURVIVED: ${m.name}\n  ${m.file}\n  ${m.why}`);
for (const m of stale)
  console.log(
    `\nSTALE: ${m.name}\n  its \`find\` no longer matches; the mutant is testing nothing`,
  );

process.exit(survived.length || stale.length ? 1 : 0);
