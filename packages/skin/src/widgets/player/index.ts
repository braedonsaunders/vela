// The player chrome, for the watch route: the surface that draws the view under the chrome,
// the session hook that drives them, and the controller contract the route implements.
export { PlayerChrome } from './chrome';
export { WatchSurface } from './surface';
export { PlaybackControllerContext, playbackController, usePlaybackController, type PlaybackServer } from './controller';
export { usePlaybackSession, type PlaybackController, type PlaybackSession, type StartOutcome } from './session';
export type { CommandInput, PlayerChromeState, StartFailure } from './context';
