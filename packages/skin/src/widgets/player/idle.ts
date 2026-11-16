// Auto-hide: the chrome stands while playback is paused, waiting or being worked (a menu open,
// a scrub, a drag), and fades out after a few idle seconds of playback. Any pointer movement,
// key or remote press brings it back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { fromViewer, useRemote } from './remote';

const IDLE_MS = 3500;

export interface Idle {
  visible: boolean;
  /** Show the chrome and restart the idle clock. */
  wake(): void;
  hide(): void;
}

export function useIdle(hold: boolean): Idle {
  const [visible, setVisible] = useState(true);
  const [touched, setTouched] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const wake = useCallback(() => {
    setVisible(true);
    setTouched(Date.now());
  }, []);
  const hide = useCallback(() => setVisible(false), []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (hold) {
      setVisible(true);
      return;
    }
    timer.current = setTimeout(() => setVisible(false), IDLE_MS);
    return () => clearTimeout(timer.current);
  }, [hold, touched]);

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

  // TV: any remote press or swipe. Focus changes are not the viewer's: hiding the chrome moves
  // focus to the stage, which would otherwise wake it again at once.
  useRemote(event => {
    if (fromViewer(event)) wake();
  });

  return { visible, wake, hide };
}
