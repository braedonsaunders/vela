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
