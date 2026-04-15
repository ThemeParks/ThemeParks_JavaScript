const HOUR = 60 * 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;

/**
 * Per-endpoint TTL defaults (milliseconds).
 * 0 means bypass the cache entirely.
 */
export function ttlForPath(path: string): number {
  if (/^\/entity\/[^/]+\/live$/.test(path)) return 0;
  if (/^\/entity\/[^/]+\/schedule(\/\d+\/\d+)?$/.test(path)) return FIVE_MIN;
  if (/^\/entity\/[^/]+\/children$/.test(path)) return HOUR;
  if (/^\/entity\/[^/]+$/.test(path)) return HOUR;
  if (path === '/destinations') return HOUR;
  return 0;
}
