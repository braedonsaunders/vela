// The app's side of a media page (docs/media-kinds.md): where its presses go. Titles open the
// title route (which draws the media page again), people the person route, books the reader and
// audio the player.
import { router } from 'expo-router';
import { useMemo } from 'react';
import type { MediaActions } from '@vela/skin/src/widgets/media';
import { noteTitleNavigation } from '../title-origin';

export function openMediaTitle(id: string, kind: string, library?: string): void {
  noteTitleNavigation(id);
  router.push({ pathname: '/title/[id]', params: { id, library: library ?? '', media: kind } });
}

export function useMediaPageActions(library: string | undefined, back: () => void, player: Pick<MediaActions, 'play' | 'nowPlaying'>, read: MediaActions['read']): MediaActions {
  return useMemo(() => ({
    openTitle: card => openMediaTitle(card.id, card.kind, library),
    openPerson: (id, name) => router.push({ pathname: '/person', params: { id, name, library: library ?? '' } }),
    play: player.play,
    nowPlaying: player.nowPlaying,
    read,
    back,
  }), [library, back, player.play, player.nowPlaying, read]);
}
