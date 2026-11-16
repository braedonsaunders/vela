// The web side of VelaPlayer.setMediaAccess. The trusted playback controller sets the current
// server's media access here; mounted views read it through the host's `access()` option and are
// told to re-apply their props when it changes, so the host retires the old request scope.
// Nothing here reaches props, snapshots, errors or logs.
import type { MediaAccess } from '@vela/player-api';

let current: MediaAccess | null = null;
const listeners = new Set<() => void>();

export function setMediaAccess(access: MediaAccess | null) {
  if (access === current) return;
  current = access;
  for (const listener of listeners) listener();
}

export function currentMediaAccess(): MediaAccess | null {
  return current;
}

/** Calls `listener` after every change; returns the unsubscribe function. */
export function onMediaAccessChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
