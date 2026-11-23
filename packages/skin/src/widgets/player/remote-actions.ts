import type { Shortcuts } from './keys';

/** The picture's focus target (chrome.tsx): focused only while the chrome is hidden. */
export const PICTURE_TEST_ID = 'player-stage-input';

/** Whether a press reached the picture rather than a control. Android TV reports the native
 * focus with each press (android-tv-keys.js): the picture's target, or nothing at all while the
 * chrome is hidden. No control can take such a press, so the player acts on it without trusting a
 * visibility flag that may be a render behind native focus. Other hosts report no focus. */
export function onPicture(focus: string | undefined, visible: boolean): boolean {
  return focus === PICTURE_TEST_ID || (focus === 'none' && !visible);
}

/** Directional input is navigation, even during the render/native focus handoff. Explicit
 * transport buttons still seek, but a stale hidden flag can never turn a direction into one.
 * A press on the picture itself (the chrome hidden) works playback: select plays or pauses and
 * the side presses step ten seconds, each bringing the chrome up (on the timeline after a step,
 * so that further side presses keep stepping). */
export function remotePress(type: string, actions: Shortcuts, focus?: string): void {
  switch (type) {
    case 'channelUp': actions.liveKey?.('ChannelUp'); actions.wake(); return;
    case 'channelDown': actions.liveKey?.('ChannelDown'); actions.wake(); return;
    case 'playPause': if (!actions.alertKey?.()) actions.togglePlay(); return;
    case 'play': actions.play(); return;
    case 'pause': actions.pause(); return;
    case 'rewind': actions.seekBy(-10); return;
    case 'fastForward': actions.seekBy(10); return;
  }
  const picture = onPicture(focus, actions.visible);
  switch (type) {
    case 'select':
      if (picture) {
        actions.togglePlay();
        actions.wake('toggle');
      }
      return;
    case 'left':
    case 'right':
      // A channel plays at the live edge: nothing to step through, unless it has a rewind window.
      if (picture && (!actions.liveKey || actions.liveSteps)) {
        actions.seekBy(type === 'right' ? 10 : -10);
        actions.wake('timeline');
        return;
      }
      actions.wake();
      return;
    case 'up':
    case 'down': actions.wake(); return;
  }
}
