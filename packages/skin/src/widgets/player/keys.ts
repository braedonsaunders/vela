// Shortcuts. On a keyboard: Space or K plays and pauses, J/L and the side arrows step ten
// seconds, the vertical arrows set the volume, M mutes, I shows the info card, F goes
// fullscreen, Escape closes a menu. On a TV remote: play/pause always toggles (Android's
// separate play, pause, rewind and fast-forward keys do what they say), Back (Menu on tvOS)
// closes an open menu; directional input wakes hidden controls and otherwise belongs to focus.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { holdBack } from '../../menu-key';
import { pressed, useRemote } from './remote';
import { remotePress } from './remote-actions';

export interface Shortcuts {
  /** The chrome stands (a hidden chrome's first press only wakes it). */
  visible: boolean;
  wake(): void;
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

function onTVControl(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.('[data-testid="player-chrome"] [role="button"], [data-testid="player-chrome"] button');
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
        event.preventDefault();
        event.stopImmediatePropagation();
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
      if (arrows && onTVControl(event.target)) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const current = event.target as HTMLElement;
          const box = current.getBoundingClientRect();
          const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="player-chrome"] button, [data-testid="player-chrome"] [role="button"]'))
            .filter(el => { const rect = el.getBoundingClientRect(); return !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true' && rect.width > 0 && Math.abs(rect.top - box.top) < 20; })
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
          const index = controls.indexOf(current);
          if (index >= 0) {
            event.preventDefault(); event.stopPropagation();
            controls[index + (event.key === 'ArrowRight' ? 1 : -1)]?.focus();
          }
        }
        return;
      }
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
    if (pressed(event)) remotePress(event.eventType, latest.current);
  });
}
