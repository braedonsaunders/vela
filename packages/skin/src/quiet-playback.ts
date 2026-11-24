// Lab and development builds start playback silent: a build that opens a channel or a multiview on
// launch (start routes, a deep link on a shared TV) must never blare. The app sets this once at
// start; release builds leave it off. The viewer unmutes as usual.
let quiet = false;

export function setQuietPlayback(on: boolean): void {
  quiet = on;
}

export function quietPlayback(): boolean {
  return quiet;
}

// A plugin screen previewed from Ether Studio (screen-preview in the app) keeps playback muted:
// the console is an authoring tool in someone's browser tab, never a speaker.
let forced = false;

export function setForcedMute(on: boolean): void {
  forced = on;
  if (on) quiet = true;
}

/** Playback stays muted: the viewer's unmute is ignored. */
export function forcedMute(): boolean {
  return forced;
}
