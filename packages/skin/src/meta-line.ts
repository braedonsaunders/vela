/** Keep each separator between words on the same line, including in prejoined card facts.
 * Ordinary spaces elsewhere remain available for wrapping in narrow cards. */
export function joinMeta(parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ').replace(/ · /g, '\u00a0·\u00a0');
}
