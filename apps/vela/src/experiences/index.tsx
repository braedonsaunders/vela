// A library opens in its experience (core's libraryExperience: the server's name for it, else what
// it holds). Each experience is its own seam: listen is the audio app; read, gallery and live draw
// today's pages (the standard library with the book pages and reader, the photo viewer, the guide)
// until their own designs replace them here, without touching the contract.
import type { ComponentType } from 'react';
import type { VelaExperience } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import type { LibraryParams } from '../browse/library-query';
import { ListenSection } from '../listen/section';
import { WatchLibrary } from './watch';
import { ReadLibrary } from './read';
import { config } from '../data/config';

export type LibrarySectionProps = { id: string; params: LibraryParams & { m?: string } };

/** Photos and home videos: today the standard library, whose photos open the photo viewer. */
function GalleryLibrary(props: LibrarySectionProps) { return <WatchLibrary {...props} />; }
/** Live TV: today the standard library's live tabs, whose channels open the guide and the player. */
function LiveLibrary(props: LibrarySectionProps) { return <WatchLibrary {...props} />; }
/** Music, audiobooks and podcasts: the listen experience's documents. */
function ListenLibrary({ id, params }: LibrarySectionProps) { return <ListenSection libraryId={id} at={params.m} />; }

export const EXPERIENCE_SECTIONS: Record<VelaExperience, ComponentType<LibrarySectionProps>> = {
  watch: WatchLibrary,
  listen: ListenLibrary,
  read: config.readDocuments ? ReadLibrary : WatchLibrary,
  gallery: GalleryLibrary,
  live: LiveLibrary,
};

/** How a library opens; 'watch' until the library list is known (a library can only be listed once it is). */
export function useLibraryExperience(libraryId: string): VelaExperience {
  return useVelaState(state => state.libraries.value?.find(library => library.id === libraryId)?.experience) ?? 'watch';
}
