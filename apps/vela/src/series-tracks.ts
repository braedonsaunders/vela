// Per-series audio and subtitle choices belong to this device (core store/series-tracks.ts):
// read once at launch and written back whenever a viewer remembers a choice or removes a server.
import { useEffect, useRef } from 'react';
import type { Vela } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { preferences } from './data/preferences';

const SERIES_TRACKS = 'series-tracks';

export function useSeriesTracks(store: Vela): void {
  const saved = useRef<string | undefined>(undefined);
  useEffect(() => {
    let stored: unknown = null;
    try { stored = JSON.parse(preferences.get(SERIES_TRACKS) ?? 'null'); } catch { /* Unreadable: start empty. */ }
    store.seriesTracks.load(stored);
    saved.current = JSON.stringify(store.getState().seriesTracks);
  }, [store]);

  const seriesTracks = useVelaState(state => state.seriesTracks);
  useEffect(() => {
    if (saved.current === undefined) return;
    const value = JSON.stringify(seriesTracks);
    if (saved.current === value) return;
    saved.current = value;
    try { preferences.set(SERIES_TRACKS, value); } catch { /* Kept for this run only. */ }
  }, [seriesTracks]);
}
