import { useSyncExternalStore } from 'react';
import { canOpenVisualizer, canVisualize as platformSupports, subscribeVisualizerAvailability } from './stage';

let failed = false;
const listeners = new Set<() => void>();

/** The shell and the future document environment use the same capability. */
export function canVisualize(): boolean { return !failed && platformSupports(); }
export function reportUnavailable(): void {
  if (failed) return;
  failed = true;
  for (const update of listeners) update();
}
function subscribe(update: () => void) {
  listeners.add(update);
  const remove = subscribeVisualizerAvailability(update);
  return () => { listeners.delete(update); remove(); };
}
export function useCanVisualize(visible: boolean): boolean {
  return useSyncExternalStore(subscribe, () => visible && canVisualize(), () => false);
}

/** A capable device can prepare the visible background while Now Playing still shows artwork. */
export function useCanOpenVisualizer(mounted: boolean): boolean {
  return useSyncExternalStore(subscribe, () => mounted && !failed && canOpenVisualizer(), () => false);
}
