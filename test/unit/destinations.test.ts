import { describe, it, expect, vi } from 'vitest';
import { ThemeParks } from '../../src/client';

const fixture = {
  destinations: [
    {
      id: 'wdw',
      name: 'Walt Disney World Resort',
      slug: 'walt-disney-world',
      parks: [{ id: 'mk', name: 'Magic Kingdom' }],
    },
    {
      id: 'dlp',
      name: 'Disneyland Paris',
      slug: 'disneyland-paris',
      parks: [{ id: 'dlp-dl', name: 'Disneyland Park' }],
    },
  ],
};

function mockFetch(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('destinations helper', () => {
  it('list returns the parsed response', async () => {
    const tp = new ThemeParks({ fetch: mockFetch(fixture), cache: false });
    const res = await tp.destinations.list();
    expect(res.destinations).toHaveLength(2);
  });

  it('find matches by slug', async () => {
    const tp = new ThemeParks({ fetch: mockFetch(fixture), cache: false });
    const d = await tp.destinations.find('walt-disney-world');
    expect(d?.id).toBe('wdw');
  });

  it('find matches by name, case-insensitive', async () => {
    const tp = new ThemeParks({ fetch: mockFetch(fixture), cache: false });
    const d = await tp.destinations.find('disneyland paris');
    expect(d?.id).toBe('dlp');
  });

  it('find returns undefined on no match', async () => {
    const tp = new ThemeParks({ fetch: mockFetch(fixture), cache: false });
    const d = await tp.destinations.find('nowhere');
    expect(d).toBeUndefined();
  });

  it('find is case-insensitive on query', async () => {
    const tp = new ThemeParks({ fetch: mockFetch(fixture), cache: false });
    const d = await tp.destinations.find('WALT-DISNEY-WORLD');
    expect(d?.id).toBe('wdw');
  });

  it('find matches a query that collapses punctuation', async () => {
    const tp = new ThemeParks({ fetch: mockFetch(fixture), cache: false });
    const d = await tp.destinations.find('waltdisneyworld');
    expect(d?.id).toBe('wdw');
  });
});
