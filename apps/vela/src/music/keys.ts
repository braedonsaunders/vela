// The music app's keyboard (web and desktop): play/pause, seek, previous/next, volume, mute,
// shuffle, repeat, like, queue, search and this list. Only while the music app is on screen and
// no text field, video or open menu has the key; arrow keys leave sliders and menus alone.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { currentInQueue, type Vela as VelaStore } from '@vela/core';
import type { MusicApp } from '@vela/skin/src/widgets/music';

export interface MusicKey { keys: string; label: string }

/** The list the `?` sheet shows, in the order it shows them. */
export const MUSIC_KEYS: MusicKey[] = [
  { keys: 'Space', label: 'music.key.toggle' },
  { keys: '← / →', label: 'music.key.seek' },
  { keys: 'Shift ← / Shift →', label: 'music.key.skip' },
  { keys: '↑ / ↓', label: 'music.key.volume' },
  { keys: 'M', label: 'music.key.mute' },
  { keys: 'S', label: 'music.key.shuffle' },
  { keys: 'R', label: 'music.key.repeat' },
  { keys: 'L', label: 'music.key.like' },
  { keys: 'Q', label: 'music.key.queue' },
  { keys: '⌘K / Ctrl K', label: 'music.key.search' },
  { keys: '?', label: 'music.key.help' },
];

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function useMusicKeys(store: VelaStore, app: MusicApp, actions: { toggleQueue(): void; help(): void }): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event.target)) return;
      // A menu, sheet or Now Playing on top owns its keys.
      if (document.querySelector('[role="menu"], [aria-modal="true"], [data-testid="now-playing"]')) return;
      const target = event.target as HTMLElement | null;
      const role = target?.getAttribute?.('role');
      const audio = store.getState().audio;
      const item = currentInQueue(audio.queue);
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key;
      const handled = (): void => { event.preventDefault(); event.stopPropagation(); };
      if (meta && key.toLowerCase() === 'k') { handled(); app.go({ kind: 'search' }); return; }
      if (meta || event.altKey) return;
      if (key === '?') { handled(); actions.help(); return; }
      if (!item && key !== 'q' && key !== 'Q') return;
      switch (key) {
        case ' ':
          if (role === 'button' || role === 'link' || role === 'menuitem') return;
          handled(); store.audio.toggle(); return;
        case 'ArrowLeft': case 'ArrowRight':
          if (role === 'adjustable' || role === 'slider') return;
          handled();
          if (event.shiftKey) { if (key === 'ArrowLeft') store.audio.previous(); else store.audio.next(); }
          else store.audio.skip(key === 'ArrowLeft' ? -5 : 5);
          return;
        case 'ArrowUp': case 'ArrowDown':
          if (role === 'adjustable' || role === 'slider') return;
          handled(); store.audio.setVolume(audio.volume + (key === 'ArrowUp' ? 0.1 : -0.1)); return;
        case 'm': case 'M': handled(); store.audio.toggleMute(); return;
        case 's': case 'S': handled(); store.audio.toggleShuffle(); return;
        case 'r': case 'R': handled(); store.audio.cycleRepeat(); return;
        case 'l': case 'L': if (item) { handled(); app.like(item, !app.liked(item.id)); } return;
        case 'q': case 'Q': handled(); actions.toggleQueue(); return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, app, actions]);
}
