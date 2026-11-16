// The player chrome, for the watch route: the surface that draws the view under the chrome and
// the session hook that drives them over core's playback slice.
export { PlayerChrome } from './chrome';
export { WatchSurface } from './surface';
export { usePlaybackSession, type PlaybackSession } from './session';
export type { CommandInput, PlayerChromeState, StartFailure } from './context';
