import { describe, it, expect, vi } from 'vitest';
import { ThemeParks } from '../../src/client';

function makeFetchByUrl(map: Record<string, unknown>) {
  return vi.fn((input: URL | RequestInfo) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(url).pathname;
    const body = map[pathname];
    if (!body) return Promise.resolve(new Response('', { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

describe('schedule helpers', () => {
  it('schedule.month calls /entity/{id}/schedule/{year}/{month}', async () => {
    const fn = makeFetchByUrl({
      '/v1/entity/abc/schedule/2026/04': { schedule: [{ date: '2026-04-01', type: 'OPERATING' }] },
    });
    const tp = new ThemeParks({ fetch: fn, cache: false });
    const res = await tp.entity('abc').schedule.month(2026, 4);
    expect(res.schedule).toHaveLength(1);
  });

  it('schedule.range fans out across months and flattens', async () => {
    const fn = makeFetchByUrl({
      '/v1/entity/abc/schedule/2026/03': { schedule: [{ date: '2026-03-31', type: 'OPERATING' }] },
      '/v1/entity/abc/schedule/2026/04': { schedule: [{ date: '2026-04-15', type: 'OPERATING' }] },
      '/v1/entity/abc/schedule/2026/05': { schedule: [{ date: '2026-05-01', type: 'OPERATING' }] },
    });
    const tp = new ThemeParks({ fetch: fn, cache: false });
    const entries = await tp
      .entity('abc')
      .schedule.range(new Date('2026-03-20'), new Date('2026-05-10'));
    expect(entries.map((e) => e.date)).toEqual(['2026-03-31', '2026-04-15', '2026-05-01']);
  });
});
