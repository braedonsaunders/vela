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
