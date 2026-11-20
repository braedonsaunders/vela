/** Ether tab search uses word prefixes, ignoring case and diacritics. */
export function matchesLibrarySearch(name: string, query: string): boolean {
  const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const words = normalize(name).split(/\s+/);
  return normalize(query.trim()).split(/\s+/).every(part => words.some(word => word.startsWith(part)));
}

/** Ether's title sort key: leading punctuation and a leading English article do not count,
 * so `"Pimpernel" Smith` files under P and `The Matrix` under M. */
export function librarySortTitle(name: string): string {
  const plain = name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/^[^\p{L}\p{N}]+/u, '');
  const unarticled = plain.replace(/^(the|an|a)\s+(?=[\p{L}\p{N}])/iu, '');
  return unarticled.replace(/^[^\p{L}\p{N}]+/u, '') || plain || name;
}
