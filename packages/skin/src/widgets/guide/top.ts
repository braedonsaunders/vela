// The guide's way back up. Deep in a lineup of hundreds, the viewer reaches the top bar without
// scrolling back: Back (Menu on tvOS) or Escape hands focus to the bar's Live TV destination and
// takes the guide back to its first channel at now, as the Apple TV app and Android TV launchers do.
// Pressing the Live TV destination again while it is showing, or Back to top, does the scrolling.
import { useEffect, useRef } from 'react';
import { focusElement, focusPressDoing } from '../../escape';
import { liveDestinations } from './navigation';

/** Focus the top bar where the guide lives: its Live TV destination, else More (which holds it),
 * else Home. False when the shell draws none of them. */
export function focusShellNavigation(liveLibraries: readonly string[]): boolean {
  return focusPressDoing(liveDestinations(liveLibraries)) || focusElement('vela-more-trigger') || focusPressDoing(['home:']);
}

const listeners = new Set<() => void>();

/** The Live TV destination pressed while the guide shows: the shown guide goes to the top. */
export function requestGuideTop(): boolean {
  for (const listener of [...listeners]) listener();
  return listeners.size > 0;
}

/** While active, a request for the top runs `onTop`. */
export function useGuideTopRequest(active: boolean, onTop: () => void): void {
  const latest = useRef(onTop);
  latest.current = onTop;
  useEffect(() => {
    if (!active) return;
    const listener = () => latest.current();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [active]);
}
