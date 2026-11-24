// React bindings for the store: a provider, the store itself, and a selector hook over
// useSyncExternalStore. Only `react` is imported here (no DOM, no React Native), so every host
// shares it. A selector must return state the store holds (a slice, a keyed value), not a new
// object, or it re-renders on every change.
import { createContext, createElement, useContext, useEffect, useMemo, useReducer, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { Vela, VelaState } from './store';
import type { AlertFrame, RecordEntry, ScreenDocument } from './wire';
import type { Loadable } from './store/state';
import { busyKey } from './store/screens';
import { cleanParams, pageKey, type PageRequest } from './screens/keys';
import type { ScreenPageState } from './screens/types';

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

// Plugin screens and surfaces

const IDLE: Loadable<ScreenDocument> = { load: 'idle', error: '' };

/** A screen or surface document by href, read once. */
export function useScreenDocument(href: string | undefined): Loadable<ScreenDocument> {
  const vela = useVela();
  useEffect(() => { if (href) void vela.screens.loadDocument(href); }, [vela, href]);
  return useVelaState(state => (href ? state.screens.documents[href] : undefined) ?? IDLE);
}

/**
 * Show a page or surface while mounted: its data is read and followed live. When the params (or
 * the surface's context) change, the next page is opened from this one, so only the sources whose
 * deps name a changed param are read again and the rest keep drawing.
 */
export function useScreenPage(request: PageRequest | undefined): { key: string; page: ScreenPageState | undefined } {
  const vela = useVela();
  const key = request ? pageKey(request.target, cleanParams(request.params), request.context) : '';
  const previous = useRef<string | undefined>(undefined);
  const latest = useRef(request);
  latest.current = request;
  useEffect(() => {
    const current = latest.current;
    if (!current || !key) return;
    const handle = vela.screens.open(current, previous.current);
    previous.current = handle.key;
    return handle.release;
  }, [vela, key, request?.href]);
  const page = useVelaState(state => key ? state.screens.pages[key] : undefined);
  return { key, page };
}

/** One record of the shared pool; re-renders only when that record changes. */
export function useScreenRecord(key: string | undefined): RecordEntry | undefined {
  const records = useVela().screens.records;
  const subscribe = useMemo(() => (listener: () => void) => key ? records.subscribe(key, listener) : () => {}, [records, key]);
  return useSyncExternalStore(subscribe, () => key ? records.get(key) : undefined, () => key ? records.get(key) : undefined);
}

/**
 * A tracked reader of the record pool for a resolver: every `$record` the component reads through
 * it during render is followed, and the component re-renders (with a new reader, so memoised
 * work recomputes) only when one of those records changes. Use one per repeated item so a pushed
 * record redraws only the items that read it.
 */
export function useRecordReader(): (key: string) => RecordEntry | undefined {
  const records = useVela().screens.records;
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const seen = useRef(new Map<string, RecordEntry | undefined>()).current;
  // Each render records afresh what it reads.
  seen.clear();
  const read = useMemo(() => (key: string) => {
    const entry = records.get(key);
    seen.set(key, entry);
    return entry;
  }, [records, version, seen]);
  useEffect(() => {
    const keys = [...seen.keys()];
    if (!keys.length) return;
    // A change between this render and the subscription is not missed.
    if (keys.some(key => records.get(key) !== seen.get(key))) { bump(); return; }
    return records.subscribeKeys(keys, bump);
  });
  return read;
}

/** Whether a control's plugin action is in flight on a page. */
export function useScreenBusy(page: string, control: string | undefined): boolean {
  return useVelaState(state => !!control && state.screens.busy[busyKey(page, control)] === true);
}

/** The viewer's alerts (toasts), followed on the stream while mounted. */
export function useScreenAlerts(): AlertFrame[] {
  const vela = useVela();
  useEffect(() => vela.screens.followAlerts(), [vela]);
  return useVelaState(state => state.screens.alerts);
}
