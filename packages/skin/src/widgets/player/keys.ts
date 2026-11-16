// Shortcuts. On a keyboard: Space or K plays and pauses, J/L and the side arrows step ten
// seconds, the vertical arrows set the volume, M mutes, I shows the info card, F goes
// fullscreen, Escape closes a menu. On a TV remote: play/pause always toggles, and while the
// chrome is hidden the side presses step ten seconds. In live watch, up and down (and the
// channel keys) dial channels instead.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { pressed, useRemote } from './remote';

export interface Shortcuts {
  /** The chrome stands (a hidden chrome's first press only wakes it). */
  visible: boolean;
  /** A menu or the chapter strip is open: arrows belong to it. */
  menuOpen: boolean;
  togglePlay(): void;
  seekBy(seconds: number): void;
  volumeBy(delta: number): void;
  toggleMute(): void;
  toggleInfo(): void;
  fullscreen(): void;
  closeMenu(): void;
  /** Live watch takes its own keys first (up and down dial channels); answers whether it took one. */
  liveKey?(key: string): boolean;
}

function typing(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || !!element.isContentEditable);
}

export function useShortcuts(shortcuts: Shortcuts): void {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      const s = latest.current;
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.key === 'Escape' && s.menuOpen) {
        s.closeMenu();
        return;
      }
      if (!s.menuOpen && s.liveKey?.(event.key)) {
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') return;
      const arrows = event.key.startsWith('Arrow');
      if (arrows && s.menuOpen) return;
      // A focused button takes Space and Enter as its own press.
      const onControl =
        (event.target as { tagName?: string } | null)?.tagName === 'BUTTON' ||
        (event.target as { getAttribute?(name: string): string | null } | null)?.getAttribute?.('role') === 'button';
      const act = (run: () => void) => {
        event.preventDefault();
        run();
      };
      switch (event.key) {
        case ' ':
          if (!onControl) act(s.togglePlay);
          return;
        case 'k':
        case 'K':
          act(s.togglePlay);
          return;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          act(() => s.seekBy(-10));
          return;
        case 'ArrowRight':
        case 'l':
        case 'L':
          act(() => s.seekBy(10));
          return;
        case 'ArrowUp':
          act(() => s.volumeBy(0.05));
          return;
        case 'ArrowDown':
          act(() => s.volumeBy(-0.05));
          return;
        case 'm':
        case 'M':
          act(s.toggleMute);
          return;
        case 'i':
        case 'I':
          act(s.toggleInfo);
          return;
        case 'f':
        case 'F':
          act(s.fullscreen);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useRemote(event => {
    const s = latest.current;
    if (!pressed(event)) return;
    if (event.eventType === 'playPause') s.togglePlay();
    else if (event.eventType === 'menu' && s.menuOpen) s.closeMenu();
    else if (!s.visible && event.eventType === 'up') s.liveKey?.('ArrowUp');
    else if (!s.visible && event.eventType === 'down') s.liveKey?.('ArrowDown');
    else if (!s.visible && event.eventType === 'left') s.seekBy(-10);
    else if (!s.visible && event.eventType === 'right') s.seekBy(10);
  });
}
