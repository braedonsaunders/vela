import type { Shortcuts } from './keys';

/** Directional input is navigation, even during the render/native focus handoff. Explicit
 * transport buttons still seek, but a stale hidden flag can never turn a direction into one. */
export function remotePress(type: string, actions: Shortcuts): void {
  switch (type) {
    case 'channelUp': actions.liveKey?.('ChannelUp'); actions.wake(); return;
    case 'channelDown': actions.liveKey?.('ChannelDown'); actions.wake(); return;
    case 'playPause': actions.togglePlay(); return;
    case 'play': actions.play(); return;
    case 'pause': actions.pause(); return;
    case 'rewind': actions.seekBy(-10); return;
    case 'fastForward': actions.seekBy(10); return;
    case 'up':
    case 'down':
    case 'left':
    case 'right': actions.wake(); return;
  }
}
