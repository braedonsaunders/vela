export const NOW_PLAYING_PLAY = 'now-playing-toggle';

/** Focus Play once the open TV player's transport is laid out. The request ends on focus. */
export function nowPlayingFirstFocus({ tv, open, laidOut, entered }: {
  tv: boolean;
  open: boolean;
  laidOut: boolean;
  entered: boolean;
}): typeof NOW_PLAYING_PLAY | undefined {
  return tv && open && laidOut && !entered ? NOW_PLAYING_PLAY : undefined;
}
