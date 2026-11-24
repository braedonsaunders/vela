// What every music view asks of the app shell: where to go, what to play, and the menu for a card.
import { createContext, useContext } from 'react';
import type { Card } from '@vela/core';
import type { CardMenuAnchor, CardMenuOpenMode } from '../card-context-menu';
import type { Focusable } from '../../escape';
import type { MusicPlace } from './place';
import type { PlaylistDrawerRequest } from './playlist-drawer';

export interface MusicMenuRequest {
  card: Card;
  anchor: CardMenuAnchor;
  /** pointer, touch, keyboard or tv: how it was asked for (a TV menu takes focus). */
  mode?: CardMenuOpenMode;
  /** Where focus returns when it closes. */
  opener?: Focusable | null;
  /** Listed as this playlist entry (Remove from this playlist). */
  entry?: { playlistId: string; entryId: string };
}

export interface MusicApp {
  libraryId: string;
  place: MusicPlace;
  go(place: MusicPlace): void;
  /** Play `items` from `index`, saying where they came from. */
  play(items: Card[], index: number, source?: { id: string; name: string; kind?: 'title' | 'playlist' | 'favorites' }, shuffle?: boolean): void;
  /** Play what a tile stands for: a track, an album's or a playlist's tracks. */
  playCard(card: Card, shuffle?: boolean): void;
  menu(request: MusicMenuRequest): void;
  /** Play or pause what is playing. */
  toggle(): void;
  /** Create a playlist or edit one's name and description. */
  drawer(request: PlaylistDrawerRequest): void;
  /** Like or unlike (follow, save) a title. */
  like(card: Card, on: boolean): void;
  liked(id: string): boolean;
}

const noop = () => undefined;
export const MusicContext = createContext<MusicApp>({ libraryId: '', place: { kind: 'home' }, go: noop, play: noop, playCard: noop, menu: noop, toggle: noop, drawer: noop, like: noop, liked: () => false });
export const useMusic = () => useContext(MusicContext);

/** Where a card opens in the music app. */
export function placeOf(card: Pick<Card, 'id' | 'kind' | 'media'>): MusicPlace {
  if (card.kind === 'playlist') return { kind: 'playlist', id: card.id };
  // A track opens its album.
  const album = card.media?.role === 'track' ? card.media.parents.find(p => p.role === 'album') : undefined;
  return { kind: 'title', id: album?.id ?? card.id };
}
