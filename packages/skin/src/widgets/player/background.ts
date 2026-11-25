// What a full-screen watch does when the app leaves the foreground.

/**
 * Whether the session stops as the app goes to the background (and starts again where it was on return).
 * iPhone and iPad keep a playing watch: the app has the audio background mode, so playback goes on behind
 * the home screen or in its picture-in-picture window. Apple TV and Android may suspend and end the app
 * without running JavaScript, and a paused iPhone app is suspended too, so those stop. A browser tab in the
 * background keeps playing, so the web keeps its session.
 */
export function stopsInBackground(platform: { os: string; tv: boolean }, paused: boolean): boolean {
  if (platform.os === 'web') return false;
  if (platform.os === 'ios' && !platform.tv) return paused;
  return true;
}

/**
 * Whether a live channel's watch goes back to the live edge and plays as the app returns to the
 * foreground (its session goes on while the app is away; the engine paused as it left), as a TV
 * channel comes back. One the viewer had paused waits where it was for their Play.
 */
export function liveReturnsToEdge(viewerPaused: boolean): boolean {
  return !viewerPaused;
}
