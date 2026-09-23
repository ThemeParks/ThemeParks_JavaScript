/**
 * The version the SDK announces must be the version it is.
 *
 * `PACKAGE_VERSION` is a literal in client.ts. It said `7.0.0-alpha.0` in a
 * package at `8.0.0`, so every request announced a version a major old and
 * nothing anywhere failed. The Python sibling had the same bug and was two
 * majors out.
 *
 * A literal only stays right while someone remembers to change it, and across
 * two releases nobody did. This makes forgetting a red test instead of a quiet
 * lie in a header.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ThemeParks } from '../../src/client';
import type { FetchLike } from '../../src/transport';

async function declaredVersion(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  ) as Record<string, unknown>;
  return pkg.version as string;
}

async function sentUserAgent(): Promise<string> {
  const seen: Array<Record<string, string>> = [];
  const fetchFn = vi.fn((_url: string | URL, init?: { headers?: Record<string, string> }) => {
    seen.push(init?.headers ?? {});
    return Promise.resolve(
      new Response(JSON.stringify({ destinations: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  await new ThemeParks({
    fetch: fetchFn as unknown as FetchLike,
    cache: false,
  }).destinations.list();
  return seen[0]!['user-agent']!;
}

describe('the announced version', () => {
  it('package.json declares a plain semver version', async () => {
    // Guard the helper: a lookup that silently found nothing would make the
    // test below pass for the wrong reason.
    expect(await declaredVersion()).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('is the one the package declares', async () => {
    // This is the assertion the drift would have failed. It is checked through
    // the header the server actually receives, not through the constant, so a
    // correct constant wired up wrongly fails here too.
    expect(await sentUserAgent()).toBe(`themeparks-sdk-js/${await declaredVersion()}`);
  });

  it('is not a stale prerelease of an older major', async () => {
    const [sdkMajor] = (await sentUserAgent()).split('/')[1]!.split('.');
    const [pkgMajor] = (await declaredVersion()).split('.');
    expect(sdkMajor).toBe(pkgMajor);
  });
});
