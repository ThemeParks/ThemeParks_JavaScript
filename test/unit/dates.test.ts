import { describe, it, expect } from 'vitest';
import { parseApiDateTime } from '../../src/dates';

describe('parseApiDateTime', () => {
  it('parses an ISO string with offset into a Date', () => {
    const d = parseApiDateTime('2026-04-14T09:00:00-04:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-04-14T13:00:00.000Z');
  });

  it('parses an ISO string with Z', () => {
    const d = parseApiDateTime('2026-04-14T13:00:00Z', 'America/New_York');
    expect(d.toISOString()).toBe('2026-04-14T13:00:00.000Z');
  });

  it('parses a naive ISO string as local-to-timezone', () => {
    const d = parseApiDateTime('2026-04-14T09:00:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-04-14T13:00:00.000Z');
  });

  it('throws on junk input', () => {
    expect(() => parseApiDateTime('not a date', 'UTC')).toThrow();
  });
});
