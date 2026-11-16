// The host a library or collection page draws with: the app's host, with the page in the
// environment (its model, load state and section) and the page's own actions. Sorting and
// filtering set the route's parameters; paging and retrying read through core's store.
import { router } from 'expo-router';
import type { LibraryQuery } from '@vela/core';
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
      case 'librarySort':
        return view(sortedBy(query, model, arg));
      case 'librarySortFlip':
        return view(flipped(query, model));
      case 'libraryFilter':
        return view(filteredBy(query, arg));
      case 'libraryMore':
        return library.more();
      case 'retry':
        return library.retry();
      default:
        return host.dispatch(action, arg);
    }
  };
  return {
    ...host,
    // The shell marks this library's destination as the section on show.
    env: { ...host.env, section: id, load: library.load, library: library.page },
    dispatch,
    loadMore: (on, entry) => (on === 'library' ? library.more() : host.loadMore(on, entry)),
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
