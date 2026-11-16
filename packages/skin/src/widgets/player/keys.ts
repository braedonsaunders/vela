// Shortcuts. On a keyboard: Space or K plays and pauses, J/L and the side arrows step ten
// seconds, the vertical arrows set the volume, M mutes, I shows the info card, F goes
// fullscreen, Escape closes a menu. On a TV remote: play/pause always toggles (Android's
// separate play, pause, rewind and fast-forward keys do what they say), Back (Menu on tvOS)
// closes an open menu, and while the chrome is hidden the side presses step ten seconds. In
// live watch, up and down (and the channel keys) dial channels instead.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { holdBack } from '../../menu-key';
import { pressed, useRemote, type RemoteEvent } from './remote';

export interface Shortcuts {
  /** The chrome stands (a hidden chrome's first press only wakes it). */
  visible: boolean;
  /** A menu or the chapter strip is open: arrows belong to it. */
  menuOpen: boolean;
  togglePlay(): void;
  play(): void;
  pause(): void;
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

  // Back closes the open menu rather than leaving the player.
  const menuOpen = shortcuts.menuOpen;
  useEffect(() => {
    if (!menuOpen) return;
    return holdBack(() => {
      latest.current.closeMenu();
      return true;
    });
  }, [menuOpen]);

  useRemote(event => {
    if (pressed(event)) remotePress(event, latest.current);
  });
}

function remotePress(event: RemoteEvent, s: Shortcuts): void {
  switch (event.eventType) {
    case 'playPause':
      s.togglePlay();
      return;
    case 'play':
      s.play();
      return;
    case 'pause':
      s.pause();
      return;
    case 'rewind':
      s.seekBy(-10);
      return;
    case 'fastForward':
      s.seekBy(10);
      return;
  }
  // The arrows move focus while the chrome stands; hidden, they act on playback.
  if (s.visible) return;
  switch (event.eventType) {
    case 'up':
      s.liveKey?.('ArrowUp');
      return;
    case 'down':
      s.liveKey?.('ArrowDown');
      return;
    case 'left':
      s.seekBy(-10);
      return;
    case 'right':
      s.seekBy(10);
      return;
  }
}
