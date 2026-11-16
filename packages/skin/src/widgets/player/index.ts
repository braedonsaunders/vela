// The player chrome, for the watch route: the surface that draws the view under the chrome and
// the session hook that drives them over core's playback slice.
export { PlayerChrome } from './chrome';
export { WatchSurface } from './surface';
export { usePlaybackSession, type PlaybackSession } from './session';
export type { CommandInput, PlayerChromeState, StartFailure } from './context';
// While a player menu is open, Back (Menu on tvOS) closes it: the watch route keeps the native
// stack from popping meanwhile.
export { backFromNavigation, useBackHeld } from '../../menu-key';
