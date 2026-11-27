/** Keep each separator between words on the same line, including in prejoined card facts.
 * Ordinary spaces elsewhere remain available for wrapping in narrow cards. */
export function joinMeta(parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ').replace(/ · /g, '\u00a0·\u00a0');
}

/** A card's facts, for a card a few words wide: a dot stays with the fact before it and the line
 * breaks after it ("2012 · PG ·" over "90 min"). A running time in the shape the core writes it
 * ("90 min", "2 h", "1 h 29 min") and the certificate (`rating`, the card's displayed one) are
 * kept whole, a word joiner after the certificate's hyphen holding "TV-14" together; every other
 * fact, a name, a date or a count, keeps its break opportunities. */
export function cardFacts(parts: readonly (string | null | undefined)[], rating = ''): string {
  const glue = (fact: string) => fact.replace(/ /g, '\u00a0');
  const certificate = rating.replace(/\s/g, ' ');
  return parts.flatMap(part => part?.split(' · ') ?? []).filter(Boolean).map(fact => {
    const plain = fact.replace(/\s/g, ' ');
    if (certificate && plain === certificate) return glue(fact).replace(/-/g, '-\u2060');
    return /^\p{Nd}+ (?:min|h(?: \p{Nd}+ min)?)$/u.test(plain) ? glue(fact) : fact;
  }).join('\u00a0· ');
}
