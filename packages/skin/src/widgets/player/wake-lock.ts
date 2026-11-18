// The screen stays awake while a film plays on the web and in the desktop apps (Electron on macOS
// and Linux, WebView2 on Windows): no screensaver, display sleep or lock over playback. Native
// players hold it themselves (the Apple player's idle timer, Android's keepScreenOn). The lock is
// released while paused or closed, and taken again when the page returns to the foreground (the
// browser drops it whenever the page is hidden).
import { useEffect } from 'react';
import { Platform } from 'react-native';

interface Sentinel { release(): Promise<void> }
interface WakeLock { request(type: 'screen'): Promise<Sentinel> }

export function useScreenAwake(on: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !on || typeof navigator === 'undefined') return;
    const lock = (navigator as unknown as { wakeLock?: WakeLock }).wakeLock;
    if (!lock) return;
    let sentinel: Sentinel | undefined;
    let ended = false;
    const take = () => {
      if (ended || document.visibilityState !== 'visible') return;
      lock.request('screen').then(s => {
        if (ended) void s.release().catch(() => undefined);
        else sentinel = s;
      }).catch(() => undefined);
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      ended = true;
      document.removeEventListener('visibilitychange', take);
      void sentinel?.release().catch(() => undefined);
    };
  }, [on]);
}
