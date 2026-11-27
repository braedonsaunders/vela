// The viewer's order and hidden libraries belong to this device (core store/library-orders.ts):
// read once at launch and written back whenever the viewer changes them or removes a server.
import { useEffect, useRef } from 'react';
import type { Vela } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { preferences } from './data/preferences';

const LIBRARY_ORDER = 'library-order';

export function useLibraryOrders(store: Vela): void {
  const saved = useRef<string | undefined>(undefined);
  useEffect(() => {
    let stored: unknown = null;
    try { stored = JSON.parse(preferences.get(LIBRARY_ORDER) ?? 'null'); } catch { /* Unreadable: start empty. */ }
    store.libraryOrders.load(stored);
    saved.current = JSON.stringify(store.getState().libraryOrders);
  }, [store]);

  const libraryOrders = useVelaState(state => state.libraryOrders);
  useEffect(() => {
    if (saved.current === undefined) return;
    const value = JSON.stringify(libraryOrders);
    if (saved.current === value) return;
    saved.current = value;
    try { preferences.set(LIBRARY_ORDER, value); } catch { /* Kept for this run only. */ }
  }, [libraryOrders]);
}
