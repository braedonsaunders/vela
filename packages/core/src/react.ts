// React bindings for the store: a provider, the store itself, and a selector hook over
// useSyncExternalStore. Only `react` is imported here (no DOM, no React Native), so every host
// shares it. A selector must return state the store holds (a slice, a keyed value), not a new
// object, or it re-renders on every change.
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Vela, VelaState } from './store';

const VelaContext = createContext<Vela | null>(null);

export function VelaProvider({ vela, children }: { vela: Vela; children?: ReactNode }) {
  return createElement(VelaContext.Provider, { value: vela }, children);
}

/** The store, for its actions. */
export function useVela(): Vela {
  const vela = useContext(VelaContext);
  if (!vela) throw new Error('useVela outside <VelaProvider>');
  return vela;
}

/** Part of the state; the component re-renders when that part changes. */
export function useVelaState<T>(select: (state: VelaState) => T): T {
  const vela = useVela();
  return useSyncExternalStore(vela.subscribe, () => select(vela.getState()), () => select(vela.getState()));
}
