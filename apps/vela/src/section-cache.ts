/** Touch Android retains only the scenes participating in the current transition. */
export function trimSectionCache<T>(cache: Map<string, T>, current: string, outgoing?: string): void {
  for (const key of cache.keys()) {
    if (key !== current && key !== outgoing) cache.delete(key);
  }
}
