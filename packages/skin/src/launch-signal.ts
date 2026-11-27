// Whether the app's launch ident still covers the screen. A host with an ident holds the launch
// while it plays and settles it as the ident dissolves; the sign-in stage waits for that, so its
// own entrance (the sail drawing, the wordmark written) is seen rather than played underneath.
// A host without an ident never holds it: everything waiting on it starts at once.
import { useSyncExternalStore } from 'react';

let held = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/** The ident is up: entrances wait. Call while rendering the cover, before its children mount. */
export function holdLaunch(): void {
  if (held) return;
  held = true;
  notify();
}

/** The ident is dissolving: entrances may play. */
export function settleLaunch(): void {
  if (!held) return;
  held = false;
  notify();
}

export function launchSettled(): boolean {
  return !held;
}

export function useLaunchSettled(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    launchSettled,
    launchSettled,
  );
}
