// Done on Vela's TV keyboard over a search (search-field.tsx, search-input.tsx): the sheet closes
// and focus goes to what was found, the first result, once the answer to the text typed has drawn;
// to the field when nothing was found. Android hands focus back to the activity's window as the
// sheet's dialog closes, and the page redrawn under the sheet left it on the shell's first tab.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { focusPressDoing, type Focusable } from '../../escape';
import { RETURN_FOCUS_MS } from '../common/tv-keyboard';
import { searchDoneFocus } from './focus-policy';
import type { SearchView } from './model';

/** How often, and for how long, the answer is looked for before focus settles on the field. */
const STEP_MS = 100;
const GIVE_UP_MS = 8000;

/** Answers the keyboard's Done: call it as the sheet closes. */
export function useSearchDoneFocus(field: { current: Focusable | null }, query: string, search: SearchView | undefined): () => void {
  const latest = useRef({ query, search });
  latest.current = { query, search };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return () => {
    if (!Platform.isTV) return;
    clearTimeout(timer.current);
    const started = Date.now();
    const step = () => {
      const next = searchDoneFocus(latest.current.query, latest.current.search);
      if (next.to === 'result' && focusPressDoing(next.does)) return;
      if (next.to === 'field' || Date.now() - started > GIVE_UP_MS) {
        focus(field.current);
        return;
      }
      // Still answering, or the results are not drawn yet.
      timer.current = setTimeout(step, STEP_MS);
    };
    // After the sheet's own return to the field, so this one is the last word.
    timer.current = setTimeout(step, RETURN_FOCUS_MS + 50);
  };
}

function focus(target: Focusable | null): void {
  if (!target) return;
  if (target.requestTVFocus) target.requestTVFocus();
  else target.focus?.();
}
