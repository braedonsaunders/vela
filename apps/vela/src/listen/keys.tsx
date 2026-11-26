// The audio app's keyboard and remote behaviour, whatever draws its pages (today's music widgets or
// the listen experience's documents): the shortcuts (web and desktop) with their `?` sheet, and the
// TV Menu/Back hold. What a key does is core's (audioKey, runAudioKey); this module only listens
// while the app is on screen and no text field, video or open menu has the key, and does the app's
// part (the queue, search, like, the list).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { audioKey, isLiked, playingItem, runAudioKey, setTitleLiked, type Vela as Store } from '@vela/core';
import { holdBack } from '@vela/skin/src/menu-key';
import { listeningWords, type Listening } from '@vela/skin/src/blocks/listen/listening';
import { MusicKeysSheet } from './keys-sheet';

export interface ListenKeysApp {
  listening: Listening;
  /** The search page is in view (⌘K then returns to its field). */
  searching: boolean;
  /** Open the search page. */
  search(): void;
  /** Open or close the queue. */
  toggleQueue(): void;
  /** Like or unlike (default: the server's favourite through core, reading the lists again). */
  like?(card: import('@vela/core').Card, on: boolean): void;
  /** Whether a title is liked (default: core's lists and the card's own favourite). */
  liked?(id: string): boolean;
}

/** The search field a page draws (the music widgets' and the listen search document's). */
export const SEARCH_FIELD = '[data-testid="music-search-input"]';
/** What on screen owns the keys while it shows: a menu, a sheet, Now Playing. */
const KEY_OWNERS = '[role="menu"], [aria-modal="true"], [data-testid="now-playing"]';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** The shortcuts while the audio app is on screen (web; desktop hosts draw the web app). */
export function useListenKeys(store: Store, app: ListenKeysApp, help: () => void): void {
  // The latest app without re-adding the listener on every draw.
  const latest = useRef(app);
  latest.current = app;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event.target)) return;
      if (document.querySelector(KEY_OWNERS)) return;
      const app = latest.current;
      const item = playingItem(store.getState());
      const command = audioKey({
        key: event.key, meta: event.metaKey || event.ctrlKey, alt: event.altKey, shift: event.shiftKey,
        role: (event.target as HTMLElement | null)?.getAttribute?.('role'),
        spoken: listeningWords(app.listening).transport === 'spoken', playing: !!item,
      });
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      if (runAudioKey(store, command)) return;
      switch (command.kind) {
        case 'search':
          // Already searching: back to the field (its page opens with it focused).
          if (app.searching) document.querySelector<HTMLElement>(SEARCH_FIELD)?.focus();
          else app.search();
          return;
        case 'help': help(); return;
        case 'queue': app.toggleQueue(); return;
        case 'like': {
          if (!item) return;
          const on = !(app.liked ? app.liked(item.id) : isLiked(store.getState(), item));
          if (app.like) app.like(item, on);
          else void setTitleLiked(store, item, on).catch(() => undefined);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, help]);
}

/** The shortcuts and their `?` sheet: mount once while the audio app is on screen. */
export function ListenKeys({ store, app }: { store: Store; app: ListenKeysApp }) {
  const [open, setOpen] = useState(false);
  const help = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  useListenKeys(store, app, help);
  return <MusicKeysSheet open={open} close={close} listening={app.listening} />;
}

/**
 * The TV remote's Menu/Back inside the audio app. tvOS gives Menu to the app only while something
 * holds it (menu-key.ts); an audio page is not a screen of its own, so Menu on an album would leave
 * Vela for the system's Home. Held on every page but the app's home, Menu goes back a page, as Back
 * does on Android TV; on the app's home the sections' fallback hold takes it to Vela's Home. Search
 * is one of the app's roots: Back from it goes to the app's home on both TVs.
 */
export function useListenBack({ home, searching, back, toHome }: { home: boolean; searching: boolean; back(): boolean; toHome(): void }): void {
  const latest = useRef({ back, toHome });
  latest.current = { back, toHome };
  useEffect(() => {
    if (!Platform.isTV || home || (Platform.OS !== 'ios' && !searching)) return;
    return holdBack(() => {
      if (searching || !latest.current.back()) latest.current.toHome();
      return true;
    });
  }, [home, searching]);
}
