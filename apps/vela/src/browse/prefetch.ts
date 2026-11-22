// Reading a library section ahead of its first visit: its first page, and the recommendations
// its first tab shows, into core's store. A section opened afterwards draws them at once
// (useLibraryPage reads the same keys). Collections are never read ahead: some servers take tens
// of seconds to answer them, so they are read only when the viewer opens them. Nothing here
// navigates or draws.
import { libraryKey, libraryTabs, type LibraryModel, type LibraryQuery, type Vela } from '@vela/core';
import { queryOf } from './library-query';

/** What a library page opened without parameters reads first: a level or Smart View tab is read
 * by its own query; a Recommended tab (or a library without tabs, which opens on its
 * recommendations) also reads the recommendations; a live tab reads neither. */
export function firstView(tabs: LibraryModel['tabs'], liveAvailable: boolean, query: LibraryQuery):
  { query: LibraryQuery; recommendations: boolean } | null {
  const first = libraryTabs(tabs)?.filter(tab => tab.kind !== 'live' || liveAvailable)[0];
  if (first?.kind === 'live') return null;
  if (first?.kind === 'view' || (first?.kind === 'library' && first.level)) {
    return { query: { ...query, tab: first.id, sort: first.sort ?? query.sort, direction: first.direction ?? query.direction }, recommendations: false };
  }
  return { query, recommendations: !first || first.kind === 'recommended' };
}

/** Read one library's first page and first tab ahead, unless already held. `recommendations`
 * false reads the first page only. */
export async function prefetchLibrary(store: Vela, id: string, recommendations = true): Promise<void> {
  const state = store.getState();
  if (state.auth.phase !== 'signed-in') return;
  const library = state.libraries.value?.find(item => item.id === id);
  if (!library || library.kind === 'live') return;
  const query = queryOf({});
  const read = async (q: LibraryQuery) => {
    const held = store.getState().library[libraryKey(id, q)];
    if (!held?.value && held?.load !== 'failed') await store.catalogue.library(id, q);
    return store.getState().library[libraryKey(id, q)]?.value;
  };
  const model = await read(query);
  if (!model) return;
  const view = firstView(model.tabs, state.home.value?.libraryLiveAvailable ?? false, query);
  if (!view) return;
  if (view.query !== query) { await read(view.query); return; }
  if (!recommendations || !view.recommendations || !store.catalogue.libraryRecommendationsAvailable) return;
  // A held answer at this progress revision is returned without a read.
  await store.catalogue.libraryRecommendations(id, model.kind, store.getState().home.progressRevision > 0);
}

/** Read ahead the first few libraries' first pages, one at a time, once the app is idle: the
 * first library's recommendations too, the others' only when pointed at (host.prefetch). Reads
 * wait while a search is open, so they never compete with what the viewer asked for. */
export function prefetchLibrariesWhenIdle(store: Vela, ids: string[], limit = 4): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = () => new Promise<void>(resolve => {
    const wait = () => {
      if (cancelled) return;
      if (store.getState().search.query) { timer = setTimeout(wait, 2000); return; }
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 4000 });
      else timer = setTimeout(resolve, 300);
    };
    timer = setTimeout(wait, 3000);
  });
  void (async () => {
    for (const [index, id] of ids.slice(0, limit).entries()) {
      await idle();
      if (cancelled) return;
      await prefetchLibrary(store, id, index === 0).catch(() => {});
    }
  })();
  return () => { cancelled = true; clearTimeout(timer); };
}
