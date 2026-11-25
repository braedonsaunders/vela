// The remote, for whichever controls hold focus on a TV: one subscription for the whole app
// (tv-key-relay.ts), instead of one per card that subscribed again on every redraw.
import { useEffect, useRef } from 'react';
import { Platform, TVEventHandler } from 'react-native';
import { tvKeyRelay, type TVKeyHandler } from './tv-key-relay';

export type { TVKey, TVKeyHandler } from './tv-key-relay';

const relay = tvKeyRelay();
let subscribed = false;

function subscribe(): void {
  if (subscribed || typeof TVEventHandler?.addListener !== 'function') return;
  subscribed = true;
  TVEventHandler.addListener(event => relay.dispatch(event));
}

/** The remote's presses while `active` (the control holds focus); `handler` may change every draw. */
export function useFocusedTVKeys(active: boolean, handler: TVKeyHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  const listening = Platform.isTV && active;
  useEffect(() => {
    if (!listening) return;
    subscribe();
    return relay.add(latest);
  }, [listening]);
}
