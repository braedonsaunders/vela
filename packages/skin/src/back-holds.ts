// The bookkeeping behind menu-key.ts, free of React Native so it can be tested: which holds are open,
// which one takes a Back press, and when tvOS's menu key must be enabled. A fallback hold takes the
// press only when no other hold is open, whatever order the holds were made in.

/** A removal this soon after Back was handled is that same press reaching the native stack. */
export const SAME_PRESS_MS = 600;

export interface BackPlatform {
  /** Adds a Back listener (BackHandler's `hardwareBackPress`); returns its removal. */
  listen(handler: () => boolean): () => void;
  /** tvOS: Menu reaches the app only while enabled. */
  menuKey?(enabled: boolean): void;
  now(): number;
  later(fire: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
}

export function backHolds(platform: BackPlatform) {
  const held: (() => boolean)[] = [];
  const fallbacks: (() => boolean)[] = [];
  const listeners = new Set<() => void>();
  let lastHandled = Number.NEGATIVE_INFINITY;
  let releaseTimer: unknown;
  const changed = () => { for (const listener of listeners) listener(); };
  const run = (onBack: () => boolean) => {
    const handled = onBack();
    if (handled) {
      lastHandled = platform.now();
      platform.cancel(releaseTimer);
      releaseTimer = platform.later(changed, SAME_PRESS_MS + 10);
    }
    return handled;
  };
  const samePress = () => platform.now() - lastHandled < SAME_PRESS_MS;
  return {
    hold(onBack: () => boolean, options: { fallback?: boolean } = {}): () => void {
      const list = options.fallback ? fallbacks : held;
      const handler = options.fallback ? () => held.length === 0 && run(onBack) : () => run(onBack);
      const remove = platform.listen(handler);
      list.push(handler);
      if (held.length + fallbacks.length === 1) platform.menuKey?.(true);
      changed();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        remove();
        list.splice(list.indexOf(handler), 1);
        if (held.length + fallbacks.length === 0) platform.menuKey?.(false);
        changed();
      };
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Something open (not a fallback) holds Back, or a press was just handled. */
    held: () => held.length > 0 || samePress(),
    /** A pushed screen's removal: unless the press was already handled, the innermost real hold takes it. */
    fromNavigation(): void {
      if (samePress()) return;
      held[held.length - 1]?.();
    },
  };
}
