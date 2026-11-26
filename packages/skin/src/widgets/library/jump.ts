// Letter-jump focus handoff for the library toolbar: moves focus straight to the jumped window's
// first poster once it has loaded and drawn.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { focusPressDoing } from '../../escape';
import { RETURN_FOCUS_MS } from '../common/tv-keyboard';
import { firstPosterTarget } from './jump-model';
import type { LibraryPage } from './model';

export { activeJumpBucket, firstPosterTarget } from './jump-model';

const STEP_MS = 100;
const GIVE_UP_MS = 8000;

/** Moves focus straight to the first poster after the viewer picks a letter and the panel closes. */
export function useJumpFocus(page: LibraryPage | undefined): { focusAfterJump(targetStart: number): void; cancel(): void } {
  const latest = useRef(page);
  latest.current = page;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => cancel, []);
  const focusAfterJump = (targetStart: number) => {
    cancel();
    const started = Date.now();
    const step = () => {
      const target = firstPosterTarget(latest.current, targetStart);
      if (target) {
        if (target.length === 0 || focusPressDoing(target)) {
          timer.current = undefined;
          return;
        }
      }
      if (Date.now() - started > GIVE_UP_MS) {
        timer.current = undefined;
        return;
      }
      timer.current = setTimeout(step, STEP_MS);
    };
    timer.current = setTimeout(step, Platform.isTV ? RETURN_FOCUS_MS + 50 : 50);
  };
  return { focusAfterJump, cancel };
}
