// The multiview's hook (spec D), for anything that offers "Add to multiview" (plugin screens'
// `multiview` action): while the multiview is
// available it registers how to add a Live TV channel as a tile and show it.
import { useSyncExternalStore } from 'react';

type AddChannel = (channelId: string) => void;
let current: AddChannel | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => { for (const listener of [...listeners]) listener(); };

/** Register the multiview's add; the returned function unregisters it (only if still current). */
export function registerMultiview(add: AddChannel): () => void {
  current = add;
  notify();
  return () => {
    if (current !== add) return;
    current = undefined;
    notify();
  };
}

/** Adding a channel to the multiview, while it is available (else undefined). */
export function useMultiview(): AddChannel | undefined {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
