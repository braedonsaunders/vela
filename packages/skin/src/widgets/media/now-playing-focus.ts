export const NOW_PLAYING_PLAY = 'now-playing-toggle';

/** Prefer Play from the first draw and request it once the transport is laid out. */
export function nowPlayingFirstFocus({ tv, open, laidOut, entered }: {
  tv: boolean;
  open: boolean;
  laidOut: boolean;
  entered: boolean;
}) {
  const preferPlay = tv && open && !entered;
  return { preferPlay, requestTarget: preferPlay && laidOut ? NOW_PLAYING_PLAY : undefined };
}

/** The open TV dock covers the route behind it. Apple TV also enters through a native guide. */
export function nowPlayingDockFocus({ tv, os, open, fullscreen, playTag }: {
  tv: boolean;
  os: string;
  open: boolean;
  fullscreen: boolean;
  playTag?: number;
}) {
  const appleTV = tv && os === 'ios';
  const guideTarget = appleTV && !fullscreen ? playTag : undefined;
  const guideAction = appleTV ? (open && guideTarget !== undefined ? 'request' : 'clear') : undefined;
  return { routeActive: !tv || !open, appleTV, guideTarget, guideAction };
}
