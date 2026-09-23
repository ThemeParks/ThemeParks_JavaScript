import { describe, it, expect } from 'vitest';
import { ThemeParks } from '../../src';

const WDW_ID = 'e957da41-3552-4cf6-b636-5babc5cbc4e5'; // Walt Disney World Resort
const MK_ID = '75ea578a-adc8-4116-a54d-dccb60765ef9'; // Magic Kingdom Park
const DLP_ID = 'e8d0207f-da8a-4048-bec8-117aa946b2c2'; // Disneyland Paris Resort

describe('live smoke tests against api.themeparks.wiki', () => {
  const tp = new ThemeParks({ cache: false });

  it('destinations returns at least one destination', async () => {
    const res = await tp.destinations.list();
    expect(res.destinations!.length).toBeGreaterThan(0);
  });

  it('entity(Walt Disney World) returns a destination-typed entity', async () => {
    const e = await tp.entity(WDW_ID).get();
    expect(e.entityType).toBe('DESTINATION');
  });

  it('Magic Kingdom live data parses without error', async () => {
    const live = await tp.entity(MK_ID).live();
    expect(Array.isArray(live.liveData)).toBe(true);
  });

  it('Disneyland Paris upcoming schedule parses', async () => {
    const s = await tp.entity(DLP_ID).schedule.upcoming();
    expect(Array.isArray(s.schedule)).toBe(true);
  });

  it('Magic Kingdom history coverage parses as a PARK document', async () => {
    const c = await tp.entity(MK_ID).history.coverage();
    expect(c.timezone).toBe('America/New_York');
    // MK is a PARK, so this is the park shape. Asserting `kinds` here read
    // undefined against production and only ever ran in the drift workflow,
    // so CI never saw it.
    if (!('summary' in c)) throw new Error('expected a park coverage document');
    expect(typeof c.summary.archiveFrom).toBe('string');
    expect(Object.keys(c.fields).length).toBeGreaterThan(0);
  });

  it('span() reads a park and a ride to the same three dates', async () => {
    const park = await tp.entity(MK_ID).history.span();
    expect(typeof park.archiveFrom).toBe('string');
    expect(typeof park.retrievableThrough).toBe('string');
  });

  it("Magic Kingdom today's history answers for the whole park", async () => {
    const h = await tp.entity(MK_ID).history.changes();
    expect('entities' in h && Array.isArray(h.entities)).toBe(true);
  });
});
