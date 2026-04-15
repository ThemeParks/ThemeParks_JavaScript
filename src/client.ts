import { InMemoryLruCache, ttlForPath, type Cache } from './cache';
import { EntityHandle } from './ergonomic/entity';
import { RawClient } from './raw';
import { Transport, type RetryConfig } from './transport';

const DEFAULT_BASE_URL = 'https://api.themeparks.wiki/v1';
const PACKAGE_VERSION = '7.0.0-alpha.0';
const DEFAULT_USER_AGENT = `themeparks-sdk-js/${PACKAGE_VERSION}`;

export interface ThemeParksOptions {
  baseUrl?: string;
  userAgent?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  retry?: Partial<RetryConfig>;
  cache?: Cache | false | { maxEntries?: number };
}

export class ThemeParks {
  readonly raw: RawClient;
  readonly #baseUrl: string;
  private readonly transport: Transport;
  private readonly cache: Cache | null;

  constructor(options: ThemeParksOptions = {}) {
    const fetchFn = options.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new Error(
        'No fetch implementation available. On older runtimes, pass `fetch` in options.',
      );
    }
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.transport = new Transport({
      baseUrl: this.#baseUrl,
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      timeoutMs: options.timeoutMs ?? 10_000,
      retry: { max: options.retry?.max ?? 3, on429: options.retry?.on429 ?? true },
      fetch: fetchFn,
    });
    this.cache = buildCache(options.cache);
    const cachingTransport = wrapTransportWithCache(this.transport, this.cache);
    this.raw = new RawClient(cachingTransport);
  }

  entity(id: string): EntityHandle {
    return new EntityHandle(this.raw, id);
  }

  toString(): string {
    return `ThemeParks(baseUrl=${JSON.stringify(this.#baseUrl)})`;
  }

  /** Node.js custom inspect: shows the same representation as toString(). */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

function buildCache(opt: ThemeParksOptions['cache']): Cache | null {
  if (opt === false) return null;
  if (opt && typeof (opt as Cache).get === 'function') return opt as Cache;
  const maxEntries = (opt as { maxEntries?: number } | undefined)?.maxEntries;
  return new InMemoryLruCache(maxEntries !== undefined ? { maxEntries } : {});
}

function wrapTransportWithCache(transport: Transport, cache: Cache | null): Transport {
  if (!cache) return transport;
  return new Proxy(transport, {
    get(target, prop, receiver) {
      if (prop === 'get') {
        return async (path: string): Promise<unknown> => {
          const ttl = ttlForPath(path);
          if (ttl > 0) {
            const hit = cache.get(path);
            if (hit !== undefined) return hit;
          }
          const value = await target.get(path);
          if (ttl > 0) cache.set(path, value, ttl);
          return value;
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}
