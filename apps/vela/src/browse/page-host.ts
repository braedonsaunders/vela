// The host a library or collection page draws with: the app's host, with the page in the
// environment (its model, load state and section) and the page's own actions. Sorting and
// filtering set the route's parameters; paging and retrying read through core's store.
import { router } from 'expo-router';
import { facetCollectionQuery, type LibraryQuery } from '@vela/core';
import type { SkinHost } from '@vela/skin';
import type { CollectionState } from './collection-page';
import type { LibraryState } from './library-page';
import { collectionHref, collectionRoute, filteredBy, flipped, paramsOf, sortedBy } from './library-query';
import { webHref } from '../action-href';

function view(query: LibraryQuery): void {
  router.setParams(paramsOf(query));
}

export function libraryHost(host: SkinHost, id: string, query: LibraryQuery, library: LibraryState): SkinHost {
  const model = library.page.model;
  const collectionDestination = (arg: string) => {
    const [target, kind] = arg.split('|');
    if (kind !== 'collection' || !target) return undefined;
    const tab = model?.tabs?.find(candidate => candidate.id === library.page.tabId);
    const facetQuery = tab ? facetCollectionQuery(target, tab) : undefined;
    if (!model?.canCollectionId && !facetQuery) return undefined;
    const card = library.page.extras?.collections.find(candidate => candidate.id === target);
    return { target, tab, query: facetQuery ?? { ...query, collectionId: target }, card };
  };
  const dispatch: SkinHost['dispatch'] = (action, arg) => {
    switch (action) {
      case 'select': {
        const [target, kind] = arg.split('|');
        if (kind === 'library-live' && target) return router.push({ pathname: '/watch/[id]', params: { id: target, kind, libraryId: id, tab: library.page.tabId } });
        // A person opened from a library's people tab keeps the library's scope and card shape.
        if (kind === 'person' && target) return router.push({ pathname: '/person', params: { id: target, name: library.page.extras?.collections.find(card => card.id === target)?.name ?? '', library: id } });
        const collection = collectionDestination(arg);
        if (collection) return router.push(collectionRoute(id, collection.query, collection.target, collection.tab?.id ?? library.page.tabId ?? 'collections', collection.card));
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
        if (arg.startsWith('tabQuery|')) return library.setSearch(arg.slice('tabQuery|'.length));
        if (arg.startsWith('liveFilter|')) return library.setLiveFilter(arg.slice('liveFilter|'.length));
        if (library.page.view === 'genres') return router.setParams({ ...paramsOf(filteredBy(query, arg)), view: 'library' });
        return view(filteredBy(query, arg));
      case 'libraryView':
        if (model?.tabs ? model.tabs.some(tab => tab.id === arg && ['recommended', 'library', 'collections', 'people', 'live', 'view'].includes(tab.kind)) : ['recommended', 'library', 'collections', 'genres'].includes(arg)) router.setParams({ ...(library.page.facetTitle ? paramsOf({}) : {}), view: arg, collectionId: undefined, facetTitle: undefined });
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
    ...(library.page.view === 'live' ? { refresh: library.retry, refreshing: library.page.viewLoad === 'loading' } : {}),
    dispatch,
    href: host.href ? (action, arg) => {
      const collection = action === 'select' ? collectionDestination(arg) : undefined;
      return collection
        ? webHref(collectionHref(id, collection.query, collection.target, collection.tab?.id ?? library.page.tabId ?? 'collections', collection.card))
        : host.href?.(action, arg);
    } : undefined,
    loadMore: (on, entry) => (on === 'library' ? library.more() : on === 'row' ? library.moreRow(entry) : host.loadMore(on, entry)),
  };
}

/** libraryHost for one retained library section, with the same dispatch, href and loadMore for
 * its life: they read the latest page when called. New functions on each update made the whole
 * page redraw (its tree compares host functions) whenever any store value changed. */
export function libraryHostBuilder(): (host: SkinHost, id: string, query: LibraryQuery, library: LibraryState) => SkinHost {
  let latest: SkinHost;
  const dispatch: SkinHost['dispatch'] = (action, arg) => latest.dispatch(action, arg);
  const href: NonNullable<SkinHost['href']> = (action, arg) => latest.href?.(action, arg);
  const loadMore: SkinHost['loadMore'] = (on, entry) => latest.loadMore(on, entry);
  return (host, id, query, library) => {
    latest = libraryHost(host, id, query, library);
    return { ...latest, dispatch, href: latest.href ? href : undefined, loadMore };
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
