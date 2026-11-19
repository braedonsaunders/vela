/** Browsing is details-only; selecting an airing programme always opens full screen. */
export function programmeSelection(airing: boolean): 'details' | 'watch' {
  return airing ? 'watch' : 'details';
}
