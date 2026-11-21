// Keys by identity for repeated rows and cards (vocabulary.ts itemKey), shared by the document
// vocabulary and the library's.

/** Keys for a list of ids: each id, a repeat counted (`id#2`) so keys stay unique. */
export function identityKeys(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map(id => {
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return count > 1 ? `${id}#${count}` : id;
  });
}
