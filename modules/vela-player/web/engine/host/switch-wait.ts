// How long the engine waits for the server to answer a path switch it asked for, and what it does
// when the answer is late. A switch the engine asked for while its media went on playing (the
// viewer choosing the server's stream over the original) leaves nothing stalled: the server may
// take its time deciding the stream (a Plex transcode decision can take well over 15 seconds), and
// its answer is handed off at the position then playing. Only after the longer wait is the switch
// dropped, and the media plays on. A switch that left nothing playing (a recovery, or one waiting
// on a track change) fails at the short deadline, as a stalled start does.

/** A switch with nothing playing behind it. */
export const SWITCH_DEADLINE_MS = 15_000;
/** A switch the current media plays on through. */
export const PLAYING_SWITCH_DEADLINE_MS = 60_000;

export type SwitchWait = 'wait' | 'drop' | 'fail';

export function switchWait(elapsedMs: number, mediaPlays: boolean): SwitchWait {
  if (mediaPlays) return elapsedMs > PLAYING_SWITCH_DEADLINE_MS ? 'drop' : 'wait';
  return elapsedMs > SWITCH_DEADLINE_MS ? 'fail' : 'wait';
}
