import type { Destinations, RawClient } from '../raw';

type Destination = NonNullable<Destinations['destinations']>[number];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matches(destination: Destination, needle: string): boolean {
  const slug = (destination as { slug?: string }).slug;
  const name = (destination as { name?: string }).name;
  return (
    (slug != null && normalize(slug).includes(needle)) ||
    (name != null && normalize(name).includes(needle))
  );
}

/**
 * Destinations directory helpers.
 *
 * NOTE: `find` does a loose, case-insensitive match on slug and name. Both
 * sides are normalized (lowercased, non-alphanumerics stripped) and then
 * tested via substring containment. The destinations list grows over time
 * and entries can be renamed; if you need a stable reference, resolve the
 * id once using this helper and then pin that id in your code.
 */
export class DestinationsApi {
  constructor(private readonly raw: RawClient) {}

  /** Fetch the full destinations directory. */
  list(): Promise<Destinations> {
    return this.raw.getDestinations();
  }

  /**
   * Find the first destination whose slug or name matches `query`.
   *
   * Matching is case-insensitive and ignores non-alphanumeric characters on
   * both sides. An exact normalized match on either `slug` or `name` wins
   * over a substring match — so a query of `"walt-disney-world"` returns the
   * destination with that exact slug even when another entry's slug/name
   * contains it as a substring (e.g. `"walt-disney-world-extra"`). If no
   * exact match is found, the first substring containment match is
   * returned. Returns `undefined` when nothing matches.
   */
  async find(query: string): Promise<Destination | undefined> {
    const res = await this.list();
    const needle = normalize(query);
    const destinations = (res.destinations ?? []) as Destination[];

    // Pass 1: exact normalized match on slug or name.
    for (const d of destinations) {
      const slug = normalize(d.slug ?? '');
      const name = normalize(d.name ?? '');
      if (slug === needle || name === needle) return d;
    }

    // Pass 2: substring containment.
    for (const d of destinations) {
      if (matches(d, needle)) return d;
    }
    return undefined;
  }
}
