// Auto-hide: the chrome stands while playback is paused, waiting or being worked (a menu open,
// a scrub, a drag), and fades out after a few idle seconds of playback. Any pointer movement,
// key or remote press brings it back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { fromViewer, useRemote } from './remote';

/** A television is watched from across the room and worked with a remote: it waits longer. */
const IDLE_MS = Platform.isTV ? 6000 : 3500;

export interface Idle {
  visible: boolean;
  /** Show the chrome and restart the idle clock. */
  wake(): void;
  /** Restart the idle clock while the chrome stands; a hidden chrome stays hidden. */
  stir(): void;
  hide(): void;
}

export function useIdle(hold: boolean): Idle {
  const [visible, setVisible] = useState(true);
  const held = useRef(hold);
  held.current = hold;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef(visible);
  const expire = useCallback(() => {
    if (held.current) return;
    shown.current = false;
    setVisible(false);
  }, []);

  const wake = useCallback(() => {
    shown.current = true;
    setVisible(true);
    clearTimeout(timer.current);
    if (!held.current) timer.current = setTimeout(expire, IDLE_MS);
  }, [expire]);
  const hide = useCallback(() => { shown.current = false; setVisible(false); }, []);
  // Moving focus along the chrome keeps it up. Not once it is hiding: hiding moves focus itself,
  // and taking that for the viewer would bring the chrome straight back, again and again.
  const stir = useCallback(() => {
    if (shown.current) wake();
  }, [wake]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (hold) {
      shown.current = true;
      setVisible(true);
      return;
    }
    timer.current = setTimeout(expire, IDLE_MS);
    return () => clearTimeout(timer.current);
  }, [hold, expire]);

  // The web: any pointer movement or key over the page.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 250) return;
      last = now;
      wake();
    };
    window.addEventListener('pointermove', onActivity);
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [wake]);

  // TV: any remote press or swipe the app sees. Presses that move focus along the chrome are taken
  // by the focus engine and never arrive here (nor, on the new architecture, do focus changes):
  // the chrome wakes on its bars' focus for those. A focus event that does arrive counts only while
  // the chrome stands (hiding moves focus to the stage, which would otherwise wake it at once).
  useRemote(event => {
    if (fromViewer(event) || shown.current) wake();
  });

  return { visible, wake, stir, hide };
}
