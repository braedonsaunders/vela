// The player's settings belong to this device (core store/player-settings.ts): read once, written
// back whenever the viewer changes them, and told the network in use as the device moves between
// Wi-Fi and mobile data, so the next start declares the streaming cap for that network.
import { useEffect, useRef } from 'react';
import type { Vela } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { networkMetered, onNetwork } from '@vela/player';
import { preferences } from './data/preferences';

const PLAYER_SETTINGS = 'player-settings';

export function usePlayerSettings(store: Vela): void {
  useEffect(() => {
    let stored: unknown = null;
    try { stored = JSON.parse(preferences.get(PLAYER_SETTINGS) ?? 'null'); } catch { /* Unreadable: the defaults. */ }
    store.playerSettings.load(stored);
    store.playerSettings.setMetered(networkMetered());
    return onNetwork(metered => store.playerSettings.setMetered(metered));
  }, [store]);
  const streaming = useVelaState(state => state.playerSettings.streaming);
  const saved = useRef<string | undefined>(undefined);
  useEffect(() => {
    const value = JSON.stringify({ streaming });
    // The first value is the one just read (or the defaults): nothing to write yet.
    if (saved.current === undefined) { saved.current = value; return; }
    if (saved.current === value) return;
    saved.current = value;
    try { preferences.set(PLAYER_SETTINGS, value); } catch { /* Kept for this run only. */ }
  }, [streaming]);
}
