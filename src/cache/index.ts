export { ttlForPath } from './ttls';

export interface Cache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown, ttlMs: number): void;
  delete(key: string): void;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export interface InMemoryLruCacheOptions {
  maxEntries?: number;
}

export class InMemoryLruCache implements Cache {
  private readonly max: number;
  private readonly map = new Map<string, Entry>();

  constructor(opts: InMemoryLruCacheOptions = {}) {
    this.max = opts.maxEntries ?? 500;
  }

  get(key: string): unknown | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}
