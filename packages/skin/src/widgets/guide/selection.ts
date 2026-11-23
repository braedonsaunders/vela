/** Browsing is details-only; selecting an airing programme always opens full screen, and selecting a
 * past programme the channel's archive still holds plays it from the archive. */
export function programmeSelection(airing: boolean, replay: 'catchUp' | 'startOver' | '' = ''): 'details' | 'watch' | 'replay' {
  if (airing) return 'watch';
  return replay === 'catchUp' ? 'replay' : 'details';
}
