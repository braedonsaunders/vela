import { createContext } from 'react';
import { findNodeHandle, Platform } from 'react-native';
import type { Focusable } from './escape';
type Target = Focusable & { setNativeProps?(props: object): void; scrollIntoView?(options: object): void };
type Entry = { target: Target; kind: 'season' | 'episode' | 'extra'; index: number };
export const EpisodeNavigation = createContext<ReturnType<typeof episodeNavigation> | null>(null);
/** Explicit neighbours bridge a season strip and a long vertical list, including rows
 * outside the viewport. Never let a containing band's remembered child choose a row. */
export function episodeNavigation() {
  const entries = new Set<Entry>();
  let seasonIndex = 0;
  const ordered = (kind: Entry['kind']) => [...entries].filter(e => e.kind === kind).sort((a,b) => a.index-b.index);
  const next = (e: Entry, down: boolean): Entry | undefined => {
    const rows = ordered('episode'); if (!rows.length) return;
    if (e.kind === 'season') return down ? rows[0] : undefined;
    if (e.kind === 'extra') return down ? undefined : rows.at(-1);
    const i = rows.indexOf(e);
    return down ? rows[i+1] ?? ordered('extra')[0] : rows[i-1] ?? ordered('season').find(s => s.index === seasonIndex) ?? ordered('season')[0];
  };
  const wire = () => {
    if (!Platform.isTV) return;
    for (const e of entries) e.target.setNativeProps?.({
      nextFocusUp: next(e, false) ? findNodeHandle(next(e, false)!.target as never) : undefined,
      nextFocusDown: next(e, true) ? findNodeHandle(next(e, true)!.target as never) : undefined,
    });
  };
  return {
    register(target: Target, kind: Entry['kind'], index: number) {
      for (const old of entries) if (old.kind === kind && old.index === index) entries.delete(old);
      const entry = { target, kind, index }; entries.add(entry); wire();
      return () => { entries.delete(entry); wire(); };
    },
    focused(target: Target) { const e = [...entries].find(e => e.target === target); if (e?.kind === 'season') seasonIndex = e.index; },
    key(target: Target, event: { key: string; preventDefault(): void; stopPropagation(): void }) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const entry = [...entries].find(e => e.target === target); if (!entry) return;
      const destination = next(entry, event.key === 'ArrowDown'); if (!destination) return;
      event.preventDefault(); event.stopPropagation(); destination.target.focus?.();
      destination.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    },
  };
}
