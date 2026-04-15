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
   * Find the first destination whose slug or name loosely matches `query`.
   *
   * Matching is case-insensitive and ignores non-alphanumeric characters on
   * both sides, then checks substring containment. For example, the query
   * `"waltdisneyworld"` matches a destination with slug
   * `"walt-disney-world"`. Returns `undefined` when nothing matches.
   */
  async find(query: string): Promise<Destination | undefined> {
    const res = await this.list();
    const needle = normalize(query);
    return (res.destinations as Destination[]).find((d) => matches(d, needle));
  }
}
