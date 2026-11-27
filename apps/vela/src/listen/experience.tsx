// The listen experience's non-visual behaviour beside its documents (ExperienceView draws the pages):
// the keyboard with its `?` sheet, and the TV Menu/Back hold. Mount it once with the library route
// that shows the experience; it is the same module the music widgets use (./keys.tsx).
import { router } from '../router';
import { useMemo } from 'react';
import type { Vela as Store } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { listeningOf } from '@vela/skin/src/blocks/listen/listening';
import type { ExperiencePlace } from '@vela/skin/src/screen/experience-route';
import { ListenKeys, useListenBack, type ListenKeysApp } from './keys';

export interface ListenBehaviourProps {
  store: Store;
  libraryId: string;
  /** The page drawn (ExperienceView's drawnPlace). */
  place: ExperiencePlace;
  /** ExperienceView's `go`. */
  go(place: ExperiencePlace, options?: { replace?: boolean }): void;
  /** Q: the shell's queue panel where the wide shell has one (ExperienceView's shell handle:
   *  `shell.current?.toggle('queue', { clear: ['sound'] })`), else Now Playing on its queue tab. */
  toggleQueue(): void;
}

/** The keys app for a listen experience page: search is its `search` page. */
export function listenKeysApp(listening: ListenKeysApp['listening'], place: ExperiencePlace, go: ListenBehaviourProps['go'], toggleQueue: () => void): ListenKeysApp {
  return { listening, searching: place.page === 'search', search: () => go({ page: 'search', params: {} }), toggleQueue };
}

export function ListenBehaviour({ store, libraryId, place, go, toggleQueue }: ListenBehaviourProps) {
  const listening = listeningOf(useVelaState(state => state.libraries.value?.find(library => library.id === libraryId)?.media));
  const app = useMemo(() => listenKeysApp(listening, place, go, toggleQueue), [listening, place, go, toggleQueue]);
  useListenBack({
    home: place.page === 'home', searching: place.page === 'search',
    back: () => { if (!router.canGoBack()) return false; router.back(); return true; },
    toHome: () => go({ page: 'home', params: {} }, { replace: true }),
  });
  return <ListenKeys store={store} app={app} />;
}
