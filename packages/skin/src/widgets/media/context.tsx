// What media pages ask the app to do (docs/media-kinds.md): open another title or a person, play
// a queue of audio, read a book, go back. The app provides it with its router and players; the
// pages stay free of navigation and playback machinery.
import { createContext, useContext } from 'react';
import type { Card } from '@vela/core';

export interface MediaQueueRequest {
  /** The titles to play in order (tracks, an audiobook, its parts). */
  items: Card[];
  /** Where to start in items. */
  index: number;
  /** Start position in the first item, seconds (a chapter, a resume point). */
  positionSeconds?: number;
  shuffle?: boolean;
  /** What the queue came from, for Now Playing's "Playing from". */
  source?: { id: string; name: string };
}

export interface MediaActions {
  openTitle(card: Pick<Card, 'id' | 'kind'>): void;
  openPerson(id: string, name: string): void;
  play(request: MediaQueueRequest): void;
  read(card: Card): void;
  back(): void;
  /** The title now playing and whether it is playing, for a tracklist's live row. */
  nowPlaying?: { id: string; playing: boolean };
}

const noop = () => undefined;
export const MediaActionsContext = createContext<MediaActions>({ openTitle: noop, openPerson: noop, play: noop, read: noop, back: noop });
export const useMediaActions = () => useContext(MediaActionsContext);
