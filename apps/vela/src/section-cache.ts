/** Keep Home ready for search; release other scenes after their outgoing transition. */
export function trimSectionCache<T>(cache: Map<string, T>, current: string, outgoing?: string): void {
  for (const key of cache.keys()) {
    if (key !== 'home:home' && key !== current && key !== outgoing) cache.delete(key);
  }
}
