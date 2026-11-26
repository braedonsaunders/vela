import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useLiveContext } from './live';
import { androidGuidePress, remoteDirection } from './navigation';
import type { Focusable } from '../../escape';
import { useRemote, pressed } from '../player/remote';
import { holdBack } from '../../menu-key';

type Key = (key: string, prevent: () => void) => void;
interface Entry { target: Focusable; key?: Key; toolbar?: boolean; nativeGrid?: boolean }
interface Navigation {
  register(id: string, entry: Entry | null): void;
  focused(id: string): void;
  blurred(id: string): void;
  request(id: string): void;
  toolbar(): void;
  enter(): void;
  inGrid(): boolean;
  /** Back, Menu or Escape in the grid: focus the top bar and take the guide back to the top. */
  escape(): void;
  /** Up from the first channel on a TV: focus the top bar. */
  top(): void;
  /** Back to top: the guide goes back to its first channel at now; focus stays where it is. */
  rewind(): void;
}
export const GuideRegion = createContext<'header' | 'toolbar'>('header');
export function GuideToolbar({ children }: { children: ReactNode }) { return <GuideRegion.Provider value="toolbar">{children}</GuideRegion.Provider>; }
export const GuideNavigation = createContext<Navigation | null>(null);
export const useGuideNavigation = () => useContext(GuideNavigation);

/** Native and DOM targets share one pending destination. Mounting it fulfils the request. */
export function GuideFocusScope({ children, enter, onHold, leave, escape, top, rewind, active = true }: { children: ReactNode; enter(): void; leave(): void; onHold(holding: boolean): void; escape(): void; top(): void; rewind(): void; active?: boolean }) {
  const nativeGuide = useLiveContext()?.GuideSurface !== undefined;
  const enabled = useRef(active); enabled.current = active;
  const latest = useRef(enter); latest.current = enter;
  const holding = useRef(onHold); holding.current = onHold;
  const leaving = useRef(leave); leaving.current = leave;
  const escaping = useRef({ escape, top, rewind }); escaping.current = { escape, top, rewind };
  // On a TV, Back (Menu) is the guide's while the grid has focus: the first press goes to the top
  // bar; once focus is there the key is the system's again, so a second press backs out as usual.
  const releaseBack = useRef<(() => void) | undefined>(undefined);
  const holdGridBack = (on: boolean) => {
    if (on && !releaseBack.current && Platform.isTV) {
      releaseBack.current = holdBack(() => {
        holdGridBack(false);
        escaping.current.escape();
        return true;
      });
    } else if (!on && releaseBack.current) {
      const release = releaseBack.current;
      releaseBack.current = undefined;
      release();
    }
  };
  useEffect(() => () => holdGridBack(false), []);
  const repeating = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stopRepeat = () => { clearInterval(repeating.current); repeating.current = undefined; holding.current(false); };
  useEffect(() => stopRepeat, []);
  const state = useMemo(() => {
    const entries = new Map<string, Entry>();
    let current = '', blurredFrom = '', pending = '', toolbar = '', gridOwned = false;
    const move = (entry: Entry) => {
      if (entry.target.requestTVFocus) entry.target.requestTVFocus();
      else (entry.target as { focus?(options: { preventScroll: boolean }): void }).focus?.({ preventScroll: true });
    };
    const navigation: Navigation = {
      register(id, entry) {
        if (!entry) { entries.delete(id); return; }
        entries.set(id, entry);
        if (pending === id) requestAnimationFrame(() => {
          if (pending === id && entries.get(id) === entry) { pending = ''; move(entry); }
        });
      },
      focused(id) {
        if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS === '1') (globalThis as typeof globalThis & { __velaGuideFocus?: string }).__velaGuideFocus = id;
        const previous = gridOwned, previousId = current || blurredFrom;
        blurredFrom = '';
        current = id; gridOwned = Boolean(entries.get(id)?.key || entries.get(id)?.nativeGrid);
        holdGridBack(gridOwned);
        if (!gridOwned) { if (entries.get(id)?.toolbar) toolbar = id; if (previous || previousId && previousId !== id) { pending = ''; leaving.current(); } } },
      blurred(id) { if (current === id) { blurredFrom = id; current = ''; stopRepeat(); if (Platform.OS !== 'web') { gridOwned = false; holdGridBack(false); pending = ''; leaving.current(); } } },
      request(id) {
        pending = '';
        // The TV anchor already owns native focus while logical programme focus moves.
        // Re-requesting UIKit focus on every remote repeat scans the whole mounted grid.
        if (current === id) return;
        pending = id;
        const entry = entries.get(id);
        if (entry) { pending = ''; move(entry); }
      },
      toolbar() { navigation.request(entries.has(toolbar) ? toolbar : 'guide-toolbar-now'); },
      enter() { latest.current(); },
      inGrid() { return gridOwned; },
      escape() { stopRepeat(); escaping.current.escape(); },
      top() { stopRepeat(); escaping.current.top(); },
      rewind() { stopRepeat(); escaping.current.rewind(); },
    };
    return { navigation, deactivate() { current = ''; blurredFrom = ''; pending = ''; gridOwned = false; holdGridBack(false); leaving.current(); }, externalFocus(target: EventTarget | null) {
      if (target === document.body || [...entries.values()].some(entry => entry.target === target)) return;
      if (gridOwned || current || blurredFrom) { pending = ''; leaving.current(); } current = ''; blurredFrom = ''; gridOwned = false;
    }, key(key: string) {
      const entry = entries.get(current);
      if (!entry) return;
      if (entry.key) entry.key(key, () => {});
      else if (entry.toolbar && key === 'ArrowDown') latest.current();
    } };
  }, []);
  useEffect(() => { if (!active) { stopRepeat(); state.deactivate(); } }, [active, state]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const focus = (event: FocusEvent) => state.externalFocus(event.target);
    document.addEventListener('focusin', focus);
    return () => document.removeEventListener('focusin', focus);
  }, [state]);
  useRemote(event => {
    if (!enabled.current || nativeGuide) return;
    const key = remoteDirection(event.eventType);
    if (!key) return;
    if (Platform.OS === 'android') {
      const press = androidGuidePress(event);
      if (press === 'release') stopRepeat();
      if (press === 'repeat') holding.current(true);
      if (press === 'start' || press === 'repeat') state.key(key);
      return;
    }
    if (/^long/i.test(event.eventType)) {
      if (Number(event.eventKeyAction) === 0) {
        if (!repeating.current) {
          holding.current(true);
          state.key(key);
          repeating.current = setInterval(() => state.key(key), 150);
        }
      } else stopRepeat();
      return;
    }
    if (pressed(event)) state.key(key);
  });
  return <GuideNavigation.Provider value={state.navigation}>{children}</GuideNavigation.Provider>;
}
