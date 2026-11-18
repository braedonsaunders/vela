// The host a library or collection page draws with: the app's host, with the page in the
// environment (its model, load state and section) and the page's own actions. Sorting and
// filtering set the route's parameters; paging and retrying read through core's store.
import { router } from 'expo-router';
import { facetCollectionQuery, type LibraryQuery } from '@vela/core';
import type { SkinHost } from '@vela/skin';
import type { CollectionState } from './collection-page';
import type { LibraryState } from './library-page';
import { filteredBy, flipped, paramsOf, sortedBy } from './library-query';

function view(query: LibraryQuery): void {
  router.setParams(paramsOf(query));
}

export function libraryHost(host: SkinHost, id: string, query: LibraryQuery, library: LibraryState): SkinHost {
  const model = library.page.model;
  const dispatch: SkinHost['dispatch'] = (action, arg) => {
    switch (action) {
      case 'select': {
        const [target, kind] = arg.split('|');
        const tab = model?.tabs?.find(tab => tab.id === library.page.tabId);
        const facetQuery = kind === 'collection' && target && tab ? facetCollectionQuery(target, tab) : undefined;
        if (facetQuery) {
          const name = library.page.extras?.collections.find(card => card.id === target)?.name ?? target;
          return router.push({ pathname: '/library/[id]', params: { id, ...paramsOf(facetQuery), view: tab!.id, facetTitle: name } });
        }
        if (kind === 'collection' && target && model?.canCollectionId) return router.setParams({ collectionId: target, view: 'library' });
        if (kind === 'directory' && target?.startsWith('vela-library-genre:')) {
          const genre = decodeURIComponent(target.slice('vela-library-genre:'.length));
          return router.setParams({ ...paramsOf(filteredBy(query, `genre|${genre}`)), view: 'library' });
        }
        return host.dispatch(action, arg);
      }
      case 'librarySort':
        return view(sortedBy(query, model, arg));
      case 'librarySortFlip':
        return view(flipped(query, model));
      case 'libraryFilter':
        if (library.page.view === 'genres') return router.setParams({ ...paramsOf(filteredBy(query, arg)), view: 'library' });
        return view(filteredBy(query, arg));
      case 'libraryView':
        if (model?.tabs ? model.tabs.some(tab => tab.id === arg && ['recommended', 'library', 'collections'].includes(tab.kind)) : ['recommended', 'library', 'collections', 'genres'].includes(arg)) router.setParams({ ...(library.page.facetTitle ? paramsOf({}) : {}), view: arg, collectionId: undefined, facetTitle: undefined });
        return;
      case 'libraryMore':
        return library.more();
      case 'moreRow':
        return library.moreRow(arg);
      case 'retry':
        return library.retry();
      default:
        return host.dispatch(action, arg);
    }
  };
  return {
    ...host,
    // The shell marks this library's destination as the section on show.
    env: { ...host.env, section: id, load: library.load, library: library.page, rowLoading: library.rowLoading },
    dispatch,
    loadMore: (on, entry) => (on === 'library' ? library.more() : on === 'row' ? library.moreRow(entry) : host.loadMore(on, entry)),
  };
}

export function collectionHost(host: SkinHost, collection: CollectionState): SkinHost {
  const dispatch: SkinHost['dispatch'] = (action, arg) => {
    if (action === 'collectionMore') return collection.more();
    if (action === 'retry') return collection.retry();
    return host.dispatch(action, arg);
  };
  return {
    ...host,
    env: { ...host.env, load: collection.load, collection: collection.page },
    dispatch,
    loadMore: (on, entry) => (on === 'collection' ? collection.more() : host.loadMore(on, entry)),
  };
}
