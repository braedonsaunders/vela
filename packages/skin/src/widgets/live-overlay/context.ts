// What the live overlays need from the app: a way to open a channel full screen (an alert's
// Watch) and a small preference store (the ticker stays on across launches). The app provides
// both at its root; without them Watch is not offered and the ticker forgets on relaunch.
//
// Toasts are drawn by one host at a time: the player draws its own (above the picture and its
// chrome, which a native full-screen presentation would otherwise cover), and the app's host
// steps aside while a player is open. The standing toaster may claim the remote's play/pause key
// for its Watch: the player asks `takeAlertKey` before it toggles playback.
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

export interface LiveOverlayActions {
  /** Open a channel full screen, in place of a channel already playing. */
  openChannel?(channelId: string): void;
  preferences?: { get(key: string): string | null; set(key: string, value: string): void };
}

export const LiveOverlayContext = createContext<LiveOverlayActions>({});
export const useLiveOverlayActions = () => useContext(LiveOverlayContext);

let players = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** A player is open while the calling component is mounted: its toaster stands, not the app's. */
export function usePlayerToaster(): void {
  useEffect(() => {
    players++;
    emit();
    return () => { players--; emit(); };
  }, []);
}

/** Whether the app's toaster stands (no player has its own up). */
export function useAppToasterStands(): boolean {
  return useSyncExternalStore(subscribe, () => players === 0, () => players === 0);
}

let alertKey: (() => boolean) | null = null;

/** The standing toaster's Watch, for the remote's play/pause key, while it has one to offer. */
export function claimAlertKey(handler: (() => boolean) | null): () => void {
  alertKey = handler;
  return () => { if (alertKey === handler) alertKey = null; };
}

/** A play/pause press: a standing toast's Watch takes it (answers true), else it is the player's. */
export function takeAlertKey(): boolean {
  return alertKey?.() ?? false;
}

const TICKER_KEY = 'liveOverlay.ticker';
let tickerOn: boolean | undefined;
const tickerListeners = new Set<() => void>();

/** The live player's ticker, on or off: remembered for the session and, given a store, across launches. */
export function useTickerPreference(): [boolean, (on: boolean) => void] {
  const { preferences } = useLiveOverlayActions();
  if (tickerOn === undefined) {
    try { tickerOn = preferences?.get(TICKER_KEY) === '1'; } catch { tickerOn = false; }
  }
  const on = useSyncExternalStore(
    listener => { tickerListeners.add(listener); return () => { tickerListeners.delete(listener); }; },
    () => tickerOn === true, () => tickerOn === true);
  const set = (next: boolean) => {
    if (tickerOn === next) return;
    tickerOn = next;
    try { preferences?.set(TICKER_KEY, next ? '1' : '0'); } catch { /* Remembered for this run only. */ }
    for (const listener of tickerListeners) listener();
  };
  return [on, set];
}
