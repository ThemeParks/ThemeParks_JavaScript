/**
 * The README's queue table against the generated types.
 *
 * The Python SDK's README said `waitTime` is an `int` while the spec declares a
 * JSON `number` and its models use `float`. This README says `number`, which is
 * right; this pins it, so a later edit cannot promise whole minutes the API
 * does not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('the README queue table', () => {
  it('types waitTime as the spec does: number, never int', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const rows = readme.split('\n').filter((l) => /^\| `queue\.[A-Z_]+`/u.test(l));
    const waits = rows.filter((l) => l.includes('waitTime'));
    expect(waits.map((l) => /`queue\.([A-Z_]+)`/u.exec(l)?.[1])).toEqual([
      'STANDBY',
      'SINGLE_RIDER',
      'PAID_STANDBY',
    ]);
    for (const row of waits) expect(row).toContain('`waitTime: number \\| null`');
    expect(readme).not.toMatch(/waitTime:?\s*`?int/u);

    const schema = readFileSync(resolve(ROOT, 'src/_generated/schema.ts'), 'utf8');
    const declared = [...schema.matchAll(/waitTime\??: ([^;]+);/gu)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared)).toEqual(new Set(['number | null']));
  });
});
