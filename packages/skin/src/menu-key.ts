// Back on a remote while something closable is open. Android and Android TV send Back to
// BackHandler always. tvOS sends its Menu button to the app (and so to BackHandler) only while
// the menu key is enabled; otherwise Menu leaves the screen. Each open menu, drawer or player
// menu holds the key while it is open, and the key goes back to the system when none is.
//
// A pushed screen (the watch route) is also popped by the native stack on tvOS's Menu, whatever
// JavaScript does with the press. Such a screen asks `useBackHeld()` and prevents its removal
// while Back is held, handing the removal to `backFromNavigation()`.
import { useSyncExternalStore } from 'react';
import { BackHandler, Platform, TVEventControl } from 'react-native';

/** A removal this soon after Back was handled is that same press reaching the native stack. */
const SAME_PRESS_MS = 600;

const held: (() => boolean)[] = [];
const listeners = new Set<() => void>();
let lastHandled = 0;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function changed(): void {
  for (const listener of listeners) listener();
}

function run(onBack: () => boolean): boolean {
  const handled = onBack();
  if (handled) {
    lastHandled = Date.now();
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(changed, SAME_PRESS_MS + 10);
  }
  return handled;
}

/** While held, Back (Menu on tvOS) runs `onBack` first; it answers whether it handled the press. */
export function holdBack(onBack: () => boolean): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const handler = () => run(onBack);
  const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
  held.push(handler);
  if (Platform.isTV && Platform.OS === 'ios' && held.length === 1) TVEventControl?.enableTVMenuKey();
  changed();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscription.remove();
    held.splice(held.indexOf(handler), 1);
    if (Platform.isTV && Platform.OS === 'ios' && held.length === 0) TVEventControl?.disableTVMenuKey();
    changed();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether something open holds Back now. */
export function useBackHeld(): boolean {
  return useSyncExternalStore(subscribe, () => held.length > 0 || Date.now() - lastHandled < SAME_PRESS_MS, () => false);
}

/** A screen's removal was prevented while Back was held: unless the press was already handled
 * (tvOS's Menu reaches both), it closes the innermost open thing, as Back would. */
export function backFromNavigation(): void {
  if (Date.now() - lastHandled < SAME_PRESS_MS) return;
  const innermost = held[held.length - 1];
  if (innermost) innermost();
}
