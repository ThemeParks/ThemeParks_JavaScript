import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ThemeParks } from '../../src/client';
import { ApiError } from '../../src/errors';
import { RawClient } from '../../src/raw';
import { Transport } from '../../src/transport';

// Fixtures are real responses from api.themeparks.wiki for Magic Kingdom and
// The Barnstormer, cut down to a few rows and entities.
async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(__dirname, '../fixtures', name), 'utf8'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function transportReturning(body: unknown, status = 200): Transport {
  return new Transport({
    baseUrl: 'https://api.example/v1',
    userAgent: 't/1',
    timeoutMs: 1000,
    retry: { max: 0, on429: false },
    fetch: vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(body, status))),
  });
}

describe('RawClient history paths', () => {
  it('getEntityHistory without a query calls /entity/{id}/history', async () => {
    const transport = transportReturning({});
    const spy = vi.spyOn(transport, 'get');
    await new RawClient(transport).getEntityHistory('abc-123');
    expect(spy).toHaveBeenCalledWith('/entity/abc-123/history');
  });

  it('getEntityHistory passes a day as ?date=', async () => {
    const transport = transportReturning({});
    const spy = vi.spyOn(transport, 'get');
    await new RawClient(transport).getEntityHistory('abc-123', { date: '2026-09-17' });
    expect(spy).toHaveBeenCalledWith('/entity/abc-123/history?date=2026-09-17');
  });

  it('getEntityHistory passes a range as ?from=&to=', async () => {
    const transport = transportReturning({});
    const spy = vi.spyOn(transport, 'get');
    await new RawClient(transport).getEntityHistory('abc-123', {
      from: '2026-09-01',
      to: '2026-09-17',
    });
    expect(spy).toHaveBeenCalledWith('/entity/abc-123/history?from=2026-09-01&to=2026-09-17');
  });

  it('getEntityHistory encodes the offset of an RFC 3339 instant', async () => {
    const transport = transportReturning({});
    const spy = vi.spyOn(transport, 'get');
    await new RawClient(transport).getEntityHistory('abc-123', {
      from: '2026-09-17T10:00:00+02:00',
      to: '2026-09-17T12:00:00+02:00',
    });
    // A bare '+' in a query string is a space; it has to travel as %2B.
    expect(spy).toHaveBeenCalledWith(
      '/entity/abc-123/history?from=2026-09-17T10%3A00%3A00%2B02%3A00&to=2026-09-17T12%3A00%3A00%2B02%3A00',
    );
  });

  it('getEntityHistoryCoverage calls /entity/{id}/history/coverage', async () => {
    const transport = transportReturning({});
    const spy = vi.spyOn(transport, 'get');
    await new RawClient(transport).getEntityHistoryCoverage('abc-123');
    expect(spy).toHaveBeenCalledWith('/entity/abc-123/history/coverage');
  });

  it('getEntityHistoryDaily calls /entity/{id}/history/daily with the same query shape', async () => {
    const transport = transportReturning({});
    const spy = vi.spyOn(transport, 'get');
    const raw = new RawClient(transport);
    await raw.getEntityHistoryDaily('abc-123');
    await raw.getEntityHistoryDaily('abc-123', { from: '2026-09-12', to: '2026-09-17' });
    expect(spy).toHaveBeenNthCalledWith(1, '/entity/abc-123/history/daily');
    expect(spy).toHaveBeenNthCalledWith(
      2,
      '/entity/abc-123/history/daily?from=2026-09-12&to=2026-09-17',
    );
  });

  it('url-encodes the entity id ahead of the query', async () => {
    const transport = transportReturning({});
    const spy = vi.spyOn(transport, 'get');
    await new RawClient(transport).getEntityHistory('a/b', { date: '2026-09-17' });
    expect(spy).toHaveBeenCalledWith('/entity/a%2Fb/history?date=2026-09-17');
  });
});

describe('history responses', () => {
  it('an attraction answers with its own rows', async () => {
    const fixture = await loadFixture('barnstormer_history.json');
    const raw = new RawClient(transportReturning(fixture));
    const res = await raw.getEntityHistory('924a3b2c-6b4b-49e5-99d3-e9dc3f2e8a48', {
      date: '2026-09-17',
    });
    expect(res).toEqual(fixture);
    if ('entities' in res) throw new Error('expected a single-entity envelope');
    expect(res.entityType).toBe('ATTRACTION');
    expect(res.range).toEqual({ from: '2026-09-17', to: '2026-09-17' });
    expect(res.opening.status).toBe('CLOSED');
    expect(res.history[1]?.changed).toContain('queue.STANDBY.waitTime');
    expect(res.history[1]?.queue?.STANDBY?.waitTime).toBe(5);
  });

  it('a park answers for every entity in it', async () => {
    const fixture = await loadFixture('mk_history_park.json');
    const raw = new RawClient(transportReturning(fixture));
    const res = await raw.getEntityHistory('75ea578a-adc8-4116-a54d-dccb60765ef9', {
      date: '2026-09-17',
    });
    if (!('entities' in res)) throw new Error('expected a park envelope');
    expect(res.entityType).toBe('PARK');
    expect(res.entities.map((e) => e.name)).toEqual([
      'Astro Orbiter',
      'Be Our Guest Restaurant',
      'Big Thunder Mountain Railroad',
    ]);
    // Present with no change in the range, which is not the same as absent.
    expect(res.entities[1]?.history).toEqual([]);
  });

  it('daily statistics of a park', async () => {
    const fixture = await loadFixture('mk_history_daily.json');
    const raw = new RawClient(transportReturning(fixture));
    const res = await raw.getEntityHistoryDaily('75ea578a-adc8-4116-a54d-dccb60765ef9', {
      from: '2026-09-12',
      to: '2026-09-17',
    });
    if (!('entities' in res)) throw new Error('expected a park envelope');
    const thunder = res.entities.find((e) => e.name === 'Big Thunder Mountain Railroad');
    expect(thunder?.days[0]).toMatchObject({
      date: '2026-09-12',
      operatingMinutes: expect.any(Number),
      standby: { min: 5, p50: 40, p90: 60, max: 70, mean: 39 },
    });
  });

  // Magic Kingdom is a PARK, and /history/coverage answers a park with the
  // park document: summary + fields + entities, no `kinds`. The fixture this
  // test used to read was hand-written in the entity shape and named after a
  // park, so it agreed with the code for the same reason the code was wrong.
  // Both fixtures below are captured from production.
  it('coverage of a PARK summarises the park and names the fields it holds', async () => {
    const fixture = await loadFixture('mk_history_coverage.json');
    const raw = new RawClient(transportReturning(fixture));
    const res = await raw.getEntityHistoryCoverage('75ea578a-adc8-4116-a54d-dccb60765ef9');
    expect(res.timezone).toBe('America/New_York');
    if (!('summary' in res)) throw new Error('expected a park coverage document');
    expect(res.summary.archiveFrom <= res.summary.recordedTo).toBe(true);
    // retrievableThrough is what YOUR key may read, not what the archive
    // holds. Bounding a backfill by the wrong one ends it in 403s.
    expect(typeof res.summary.retrievableThrough).toBe('string');
    expect(Object.keys(res.fields)).toContain('queue.STANDBY');
    // entities[] is truncated in the fixture; the shape is what matters.
    expect(res.entities.length).toBeGreaterThan(0);
  });

  it('coverage of a single entity names the recorded days per field', async () => {
    const fixture = await loadFixture('mk_attraction_history_coverage.json');
    const raw = new RawClient(transportReturning(fixture));
    const res = await raw.getEntityHistoryCoverage('some-attraction');
    expect(res.timezone).toBe('America/New_York');
    if ('summary' in res) throw new Error('expected an entity coverage document');
    expect(Object.keys(res.kinds)).toContain('queue.STANDBY');
    expect(res.kinds['queue.STANDBY']).toMatchObject({
      first: expect.any(String),
      last: expect.any(String),
    });
  });

  it('a day outside the window is an ApiError carrying the earliest allowed date', async () => {
    const fixture = await loadFixture('history_window_exceeded.json');
    const raw = new RawClient(transportReturning(fixture, 403));
    const err = await raw
      .getEntityHistory('75ea578a-adc8-4116-a54d-dccb60765ef9', { from: '2026-09-10' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).body).toMatchObject({
      error: { type: 'HISTORY_WINDOW_EXCEEDED', earliestAllowedDate: '2026-09-12' },
    });
  });
});

describe('EntityHandle.history', () => {
  function client(body: unknown) {
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(body)));
    return { tp: new ThemeParks({ fetch: fetchFn, cache: false }), fetchFn };
  }

  it('.changes() calls /entity/{id}/history with the query', async () => {
    const { tp, fetchFn } = client({ history: [] });
    await tp.entity('abc').history.changes({ date: '2026-09-17' });
    expect(fetchFn.mock.calls[0]![0]).toBe(
      'https://api.themeparks.wiki/v1/entity/abc/history?date=2026-09-17',
    );
  });

  it('.daily() calls /entity/{id}/history/daily', async () => {
    const { tp, fetchFn } = client({ days: [] });
    await tp.entity('abc').history.daily();
    expect(fetchFn.mock.calls[0]![0]).toBe(
      'https://api.themeparks.wiki/v1/entity/abc/history/daily',
    );
  });

  it('.coverage() calls /entity/{id}/history/coverage', async () => {
    const { tp, fetchFn } = client({ kinds: {} });
    await tp.entity('abc').history.coverage();
    expect(fetchFn.mock.calls[0]![0]).toBe(
      'https://api.themeparks.wiki/v1/entity/abc/history/coverage',
    );
  });

  it('coverage is cached for an hour, changes are not cached', async () => {
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    const tp = new ThemeParks({ fetch: fetchFn });
    await tp.entity('abc').history.coverage();
    await tp.entity('abc').history.coverage();
    await tp.entity('abc').history.changes({ date: '2026-09-17' });
    await tp.entity('abc').history.changes({ date: '2026-09-17' });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
