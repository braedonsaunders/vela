/** Ether tab search uses word prefixes, ignoring case and diacritics. */
export function matchesLibrarySearch(name: string, query: string): boolean {
  const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const words = normalize(name).split(/\s+/);
  return normalize(query.trim()).split(/\s+/).every(part => words.some(word => word.startsWith(part)));
}
