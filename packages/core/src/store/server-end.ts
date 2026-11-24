// What a session the server reports ended means to the viewer. A title, an extra or an archived
// programme has an end, and reaching it is "Finished". A live channel or a library's live stream
// has none: when the server ends one the viewer is still watching (Ether marks a broken live
// session recovering, then stops it), the channel stopped, and the viewer is told so with
// Try again, not left on a black "Finished". The player saying it reached the end is believed.
import type { PlaybackTarget } from './playback';

export type ServerEnd = 'finished' | 'stopped';

export function serverEnd(target: PlaybackTarget | null, playerEnded: boolean): ServerEnd {
  if (playerEnded) return 'finished';
  return target?.kind === 'channel' || target?.kind === 'library-live' ? 'stopped' : 'finished';
}
