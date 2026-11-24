// Back on a remote while something closable is open. Android and Android TV send Back to
// BackHandler always. tvOS sends its Menu button to the app (and so to BackHandler) only while
// the menu key is enabled; otherwise Menu leaves the screen. Each open menu, drawer or player
// menu holds the key while it is open, and the key goes back to the system when none is.
//
// A pushed screen (the watch route) is also popped by the native stack on tvOS's Menu, whatever
// JavaScript does with the press. Such a screen asks `useBackHeld()` and prevents its removal
// while Back is held, handing the removal to `backFromNavigation()`.
//
// A fallback hold (a section's root on tvOS, which goes to Vela's Home as Android TV's Back does)
// takes the press only when nothing else open holds it, whatever order the holds were made in, and
// is not "held" for the pushed screens above it.
import { useSyncExternalStore } from 'react';
import { BackHandler, Platform, TVEventControl } from 'react-native';
import { backHolds } from './back-holds';

const holds = backHolds({
  listen(handler) {
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => subscription.remove();
  },
  menuKey: Platform.isTV && Platform.OS === 'ios'
    ? enabled => { if (enabled) TVEventControl?.enableTVMenuKey(); else TVEventControl?.disableTVMenuKey(); }
    : undefined,
  now: () => Date.now(),
  later: (fire, ms) => setTimeout(fire, ms),
  cancel: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
});

/**
 * While held, Back (Menu on tvOS) runs `onBack` first; it answers whether it handled the press. A
 * `fallback` hold runs only when no other hold is open.
 */
export function holdBack(onBack: () => boolean, options: { fallback?: boolean } = {}): () => void {
  if (Platform.OS === 'web') return () => undefined;
  return holds.hold(onBack, options);
}

/** Whether something open holds Back now. */
export function useBackHeld(): boolean {
  return useSyncExternalStore(holds.subscribe, holds.held, () => false);
}

/** A screen's removal was prevented while Back was held: unless the press was already handled
 * (tvOS's Menu reaches both), it closes the innermost open thing, as Back would. */
export function backFromNavigation(): void {
  holds.fromNavigation();
}
