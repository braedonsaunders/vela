// What a document's presses do. Navigation goes through expo-router; data goes through the core
// store; view state through the view-state hook. An action this app does not carry out yet is
// logged, never silently swallowed.
import { router } from 'expo-router';
import { useCallback } from 'react';
import type { Vela as Store } from '@vela/core';
import { page, type SkinHost } from '@vela/skin';
import { liveAction, type LiveController } from '@vela/skin/src/widgets/guide';
import type { Action } from '../../../protocol/v0/skin';
import { COLLECTION_KINDS, openCollection, openHit, openLibrary, playExtra } from './browse/open';
import type { ViewState } from './view-state';

const TITLE_KINDS = ['', 'movie', 'show', 'season', 'episode'];

/** Where a press came from: the route and its entry (a title's ID). */
export interface Place {
  route: string;
  entry: string;
}

export interface Dispatcher {
  dispatch(place: Place, action: Action, arg: string): void;
  loadMore: SkinHost['loadMore'];
}

interface Context {
  store: Store;
  view: ViewState;
  live: LiveController | null;
  nextDocument(): void;
}

function notYet(action: string, arg: string): void {
  console.info(`Vela: ${action} ${arg} is not carried out yet`);
}

export function useDispatcher({ store, view, live, nextDocument }: Context): Dispatcher {
  const loadMore = useCallback<SkinHost['loadMore']>((on, id) => {
    if (on === 'row') void store.home.rowItems(id);
    else if (on === 'home') void store.home.moreRows();
    else if (on === 'collection' && id) void store.catalogue.collection(id, true);
    // A library page reads its own next page (browse/page-host.ts); elsewhere there is none.
  }, [store]);

  const select = useCallback((arg: string) => {
    const [id = '', kind = '', receipt = ''] = arg.split('|');
    if (receipt) void store.receipts.record(receipt, 'selected');
    if (kind === 'season') view.setSeason(id);
    else if (kind === 'channel') router.push({ pathname: '/live', params: { ch: id } });
    else if (id && COLLECTION_KINDS.includes(kind)) openCollection(id);
    else if (id && TITLE_KINDS.includes(kind)) router.push({ pathname: '/title/[id]', params: { id } });
    else notYet('select', arg);
  }, [store, view]);

  const retry = useCallback((place: Place) => {
    if (place.route === 'title') void store.catalogue.title(place.entry, true);
    else void store.home.load();
  }, [store]);

  const dispatch = useCallback((place: Place, action: Action, arg: string) => {
    if (liveAction(live, action, arg, () => router.push('/live'))) return;
    switch (action) {
      case 'select':
        return select(arg);
      case 'play':
        if (arg) router.push({ pathname: '/watch/[id]', params: { id: arg } });
        return;
      case 'pickHero':
        return view.setHeroIndex(Number(arg) || 0);
      case 'home':
        store.search.clear();
        return router.dismissTo('/');
      case 'back':
      case 'close':
        if (action === 'close' && arg) return view.setFlag(arg, false);
        if (router.canGoBack()) router.back();
        return;
      case 'toggle':
        return view.toggleFlag(arg);
      case 'open':
        return view.setFlag(arg, true);
      case 'only':
        return view.onlyFlag(arg);
      case 'reset':
        return view.resetFlags();
      case 'clearSearch':
        return store.search.clear();
      case 'search':
      case 'focusSearch':
        return view.setFlag('search-focused', true);
      case 'retryDescriptive':
        return store.search.retryDescriptive();
      case 'pageNext':
        return page(arg, 1);
      case 'pagePrev':
        return page(arg, -1);
      case 'moreRow':
        return arg ? loadMore('row', arg) : loadMore('home', '');
      case 'collectionMore':
        return loadMore('collection', arg);
      case 'libraryMore':
        return loadMore('library', arg);
      case 'live':
        return router.push('/live');
      case 'library':
        return openLibrary(store, arg, place.route);
      case 'playExtra':
        return playExtra(arg);
      case 'openHit':
        return openHit(store, arg);
      case 'openPicker':
        return nextDocument();
      case 'signOut':
        void store.auth.signOut();
        return;
      case 'retry':
        return retry(place);
      default:
        notYet(action, arg);
    }
  }, [store, view, live, select, retry, loadMore, nextDocument]);

  return { dispatch, loadMore };
}
