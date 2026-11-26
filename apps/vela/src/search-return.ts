import { useEffect, useRef, useState } from 'react';
import { useVelaState } from '@vela/core/react';
import type { Vela } from '@vela/core';
import { focusElement } from '@vela/skin';
import { viewerPressedSince } from '@vela/skin/src/route-focus';

export function useSearchReturn(store: Vela, active: boolean, query: string | undefined): void {
  const auth = useVelaState(state => state.auth);
  const covered = useRef(false);
  const [pending, setPending] = useState<{ id: string; query: string; at: number }>();
  useEffect(() => {
    if (!active) {
      covered.current = true;
      setPending(undefined);
      return;
    }
    if (!covered.current || auth.phase !== 'signed-in') return;
    const id = store.search.returnToResults();
    covered.current = false;
    if (id) setPending({ id, query: store.getState().search.query, at: Date.now() });
  }, [active, auth, store]);
  useEffect(() => {
    if (!active || !pending || query !== pending.query) return;
    let frame: number;
    const focus = () => {
      if (viewerPressedSince(pending.at) || Date.now() - pending.at > 6000 || focusElement(pending.id, true)) {
        setPending(undefined);
      } else frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [active, pending, query]);
}
