import type { LibraryPage } from './model';
import { libraryTabs } from '@vela/core';

/** An explicit server list, including an empty list, always wins over legacy views. */
export function toolbarTabs(page: LibraryPage | undefined) {
  return libraryTabs(page?.model?.tabs) ?? [
    ...(page?.canRecommend ? [{ id: 'recommended', label: 'Recommended' }] : []),
    { id: 'library', label: 'Library' },
    ...(page?.extras?.collectionsAvailable ? [{ id: 'collections', label: 'Collections' }] : []),
    ...(page?.extras?.genres.length ? [{ id: 'genres', label: 'Genres' }] : []),
  ];
}

export function tabSearchEnabled(tab: { kind: string; search?: boolean } | undefined) {
  return !!tab && (tab.search ?? (tab.kind === 'collections' || tab.kind === 'people'));
}
