import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RawClient } from '../../src/raw';
import { Transport } from '../../src/transport';

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(__dirname, '../fixtures', name), 'utf8'));
}

function mockTransportReturning(body: unknown): Transport {
  const fetchFn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  return new Transport({
    baseUrl: 'https://api.example/v1',
    userAgent: 't/1',
    timeoutMs: 1000,
    retry: { max: 0, on429: false },
    fetch: fetchFn,
  });
}

describe('RawClient', () => {
  it('getDestinations returns parsed body', async () => {
    const fixture = await loadFixture('destinations.json');
    const raw = new RawClient(mockTransportReturning(fixture));
    const res = await raw.getDestinations();
    expect(res).toEqual(fixture);
  });

  it('getEntity calls /entity/{id}', async () => {
    const fixture = await loadFixture('mk_entity.json');
    const transport = mockTransportReturning(fixture);
    const spy = vi.spyOn(transport, 'get');
    const raw = new RawClient(transport);
    await raw.getEntity('abc-123');
    expect(spy).toHaveBeenCalledWith('/entity/abc-123');
  });

  it('getEntityChildren calls /entity/{id}/children', async () => {
    const transport = mockTransportReturning({ children: [] });
    const spy = vi.spyOn(transport, 'get');
    const raw = new RawClient(transport);
    await raw.getEntityChildren('abc-123');
    expect(spy).toHaveBeenCalledWith('/entity/abc-123/children');
  });

  it('getEntityLive parses responses with null queue fields without throwing', async () => {
    const fixture = await loadFixture('null-queue-field.json');
    const raw = new RawClient(mockTransportReturning(fixture));
    await expect(raw.getEntityLive('abc-123')).resolves.toBeDefined();
  });

  it('getEntitySchedule calls /entity/{id}/schedule', async () => {
    const transport = mockTransportReturning({ schedule: [] });
    const spy = vi.spyOn(transport, 'get');
    const raw = new RawClient(transport);
    await raw.getEntitySchedule('abc-123');
    expect(spy).toHaveBeenCalledWith('/entity/abc-123/schedule');
  });

  it('getEntityScheduleMonth calls /entity/{id}/schedule/{year}/{month} with zero-padded month', async () => {
    const transport = mockTransportReturning({ schedule: [] });
    const spy = vi.spyOn(transport, 'get');
    const raw = new RawClient(transport);
    await raw.getEntityScheduleMonth('abc-123', 2026, 4);
    expect(spy).toHaveBeenCalledWith('/entity/abc-123/schedule/2026/04');
  });

  it('getEntityScheduleMonth zero-pads single-digit month', async () => {
    const transport = mockTransportReturning({ schedule: [] });
    const spy = vi.spyOn(transport, 'get');
    const raw = new RawClient(transport);
    await raw.getEntityScheduleMonth('abc', 2026, 5);
    expect(spy).toHaveBeenCalledWith('/entity/abc/schedule/2026/05');
  });

  it('url-encodes entity ids', async () => {
    const transport = mockTransportReturning({});
    const spy = vi.spyOn(transport, 'get');
    const raw = new RawClient(transport);
    await raw.getEntity('walt disney/world');
    expect(spy).toHaveBeenCalledWith('/entity/walt%20disney%2Fworld');
  });
});
