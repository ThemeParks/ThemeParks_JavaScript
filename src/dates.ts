/**
 * Parse a date/time string from the ThemeParks API into a JS Date.
 *
 * Accepts:
 *   - full ISO with offset (e.g. 2026-04-14T09:00:00-04:00)
 *   - ISO with Z
 *   - naive ISO (no zone info); interpreted as local time in `timezone`
 */
export function parseApiDateTime(input: string, timezone: string): Date {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(input)) {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${input}`);
    return d;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
  if (!match) throw new Error(`invalid date: ${input}`);
  const [, y, mo, da, h, mi, s] = match;
  const asUtc = Date.UTC(+y!, +mo! - 1, +da!, +h!, +mi!, s ? +s : 0);
  const offsetMs = zoneOffsetMs(timezone, asUtc);
  return new Date(asUtc - offsetMs);
}

function zoneOffsetMs(timezone: string, atUtcMs: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(atUtcMs)).map((p) => [p.type, p.value]),
  );
  const asIfLocal = Date.UTC(
    +parts.year!,
    +parts.month! - 1,
    +parts.day!,
    +parts.hour!,
    +parts.minute!,
    +parts.second!,
  );
  return asIfLocal - atUtcMs;
}
