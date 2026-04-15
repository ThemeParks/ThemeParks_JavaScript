import { describe, it, expect, vi } from 'vitest';
import { ThemeParks } from '../../src/client';

function sequentialFetch(responses: unknown[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(
      new Response(JSON.stringify(r), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return fn;
}

describe('EntityHandle', () => {
  it('.get() calls /entity/{id}', async () => {
    const fn = sequentialFetch([{ id: 'abc', name: 'X' }]);
    const tp = new ThemeParks({ fetch: fn, cache: false });
    const e = await tp.entity('abc').get();
    expect(e.id).toBe('abc');
  });

  it('.live() calls /entity/{id}/live', async () => {
    const fn = sequentialFetch([{ liveData: [] }]);
    const tp = new ThemeParks({ fetch: fn, cache: false });
    const r = await tp.entity('abc').live();
    expect(r.liveData).toEqual([]);
  });

  it('walk yields every descendant from a single /children call', async () => {
    const fn = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'root',
          children: [
            { id: 'a', name: 'A', entityType: 'PARK' },
            { id: 'b', name: 'B', entityType: 'PARK' },
            { id: 'c', name: 'C', entityType: 'ATTRACTION' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const tp = new ThemeParks({ fetch: fn, cache: false });
    const ids: string[] = [];
    for await (const child of tp.entity('root').walk()) ids.push(child.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
