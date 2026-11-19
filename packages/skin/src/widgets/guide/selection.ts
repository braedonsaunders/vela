/** Browsing is details-only. An explicit airing selection tunes once, then opens watch. */
export function programmeSelection(airing: boolean, channelId: string, playingChannelId: string): 'details' | 'preview' | 'watch' {
  if (!airing) return 'details';
  return channelId === playingChannelId ? 'watch' : 'preview';
}
