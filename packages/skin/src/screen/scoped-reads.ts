// A screen node's own record reader (docs/plugin-screens.md: Data, records and live updates): the
// node component drawing a hole reads records through a reader that remembers the keys it read
// while that node rendered, and subscribes to exactly those keys in the shared pool. A pushed record
// then redraws only the nodes that read it; the page root's reader subscribes to nothing.
import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { RecordEntry } from '../../../protocol/screen';
import type { Ctx } from '../vocabulary';

/** The context a screen node draws with: its own tracked reader (the context as given elsewhere). */
export function useScopedReads(ctx: Ctx): Ctx {
  const source = ctx.screen?.source;
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const seen = useRef<Map<string, RecordEntry | undefined>>(new Map()).current;
  // Each render records afresh what it (and the parts it draws inline) reads.
  seen.clear();
  const read = useMemo(() => (source ? (key: string) => {
    const entry = source.get(key);
    seen.set(key, entry);
    return entry;
  } : undefined),
  // A new reader after a change, so whatever was computed from the old one is computed again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [source, version]);
  useEffect(() => {
    if (!source || !seen.size) return;
    const keys = [...seen.keys()];
    // A change between this render and the subscription is not missed.
    if (keys.some(key => source.get(key) !== seen.get(key))) { bump(); return; }
    return source.subscribeKeys(keys, bump);
  });
  return useMemo(() => (read && ctx.screen ? { ...ctx, screen: { ...ctx.screen, record: read } } : ctx), [ctx, read]);
}
