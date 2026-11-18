// What a document's presses do. Navigation goes through expo-router; data goes through the core
// store; view state through the view-state hook. An action this app does not carry out yet is
// logged, never silently swallowed.
import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import type { Vela as Store } from '@vela/core';
import { focusElement, page, type SkinHost } from '@vela/skin';
import { liveAction, type LiveController } from '@vela/skin/src/widgets/guide';
import type { Action } from '../../../packages/protocol/skin';
import { COLLECTION_KINDS, openCollection, openHit, openLibrary, playExtra } from './browse/open';
import type { ViewState } from './view-state';

const TITLE_KINDS = ['', 'movie', 'show', 'season', 'episode'];

/** Where a press came from: the route and its entry (a title's ID). */
export interface Place {
  route: string;
  entry: string;
  library?: string;
}

export interface Dispatcher {
  dispatch(place: Place, action: Action, arg: string): void;
  loadMore: SkinHost['loadMore'];
}

interface Context {
  store: Store;
  view: ViewState;
  live: LiveController | null;
  /** Open the appearance picker. */
  openPicker(): void;
}

function notYet(action: string, arg: string): void {
  console.info(`Vela: ${action} ${arg} is not carried out yet`);
}

export function useDispatcher({ store, view, live, openPicker }: Context): Dispatcher {
  const { setSeason, setHeroIndex, setFlag, toggleFlag, onlyFlag, resetFlags } = view;
  const actions = useMemo(() => ({ setSeason, setHeroIndex, setFlag, toggleFlag, onlyFlag, resetFlags }), [setSeason, setHeroIndex, setFlag, toggleFlag, onlyFlag, resetFlags]);
  const loadMore = useCallback<SkinHost['loadMore']>((on, id) => {
    if (on === 'row') void store.home.rowItems(id);
    else if (on === 'home') void store.home.moreRows();
    else if (on === 'collection' && id) void store.catalogue.collection(id, true);
    // A library page reads its own next page (browse/page-host.ts); elsewhere there is none.
  }, [store]);

  const select = useCallback((place: Place, arg: string) => {
    const [id = '', kind = '', receipt = '', showId = ''] = arg.split('|');
    if (receipt) void store.receipts.record(receipt, 'selected');
    if (kind === 'season') {
      actions.setSeason(id);
      if (showId) router.push({ pathname: '/title/[id]', params: { id: showId, library: place.route === 'library' ? place.entry : place.library ?? '' } });
    }
    else if (kind === 'channel') router.push({ pathname: '/live', params: { ch: id } });
    else if (id && COLLECTION_KINDS.includes(kind)) openCollection(id);
    else if (id && TITLE_KINDS.includes(kind)) router.push({ pathname: '/title/[id]', params: { id, library: place.route === 'library' ? place.entry : place.library ?? '' } });
    else notYet('select', arg);
  }, [store, actions]);

  const retry = useCallback((place: Place) => {
    if (place.route === 'title') void store.catalogue.title(place.entry, true);
    else void store.home.load();
  }, [store]);

  const dispatch = useCallback((place: Place, action: Action, arg: string) => {
    if (liveAction(live, action, arg, () => router.push('/live'))) return;
    switch (action) {
      case 'select':
        return select(place, arg);
      case 'person':
        if (place.entry && arg) return router.push({ pathname: '/person', params: { title: place.entry, name: arg, library: place.library ?? '' } });
        return;
      case 'play':
        if (arg) {
          const [id, mediaSourceId, audioTrackId] = arg.split('|');
          router.navigate({ pathname: '/watch/[id]', params: { id, ...(mediaSourceId ? { mediaSourceId } : {}), ...(audioTrackId ? { audioTrackId } : {}) } });
        }
        return;
      case 'pickHero':
        return actions.setHeroIndex(Number(arg) || 0);
      case 'home':
        store.search.clear();
        return router.dismissTo('/');
      case 'back':
      case 'close':
        if (action === 'close' && arg) return actions.setFlag(arg, false);
        if (router.canGoBack()) router.back();
        else router.replace('/');
        return;
      case 'toggle':
        return actions.toggleFlag(arg);
      case 'open':
        return actions.setFlag(arg, true);
      case 'only':
        return actions.onlyFlag(arg);
      case 'reset':
        return actions.resetFlags();
      case 'clearSearch':
        return store.search.clear();
      case 'search':
      case 'focusSearch':
        // The search field belongs to home; a library or guide has no field to focus.
        if (place.route !== 'home') {
          actions.setFlag('focus-search-on-home', true);
          return router.dismissTo('/');
        }
        // The field's own focus sets search-focused; on a TV it opens the keyboard.
        if (focusElement('vela-search')) return;
        return actions.setFlag('search-focused', true);
      case 'searchSort': return store.search.setOptions({ sort: (arg || undefined) as import('../../../packages/protocol/types').SearchSort | undefined });
      case 'searchDirection': return store.search.setOptions({ direction: arg as import('../../../packages/protocol/types').SearchDirection });
      case 'searchKind': return store.search.setOptions({ kind: (arg || undefined) as import('../../../packages/protocol/types').SearchKind | undefined });
      case 'searchMore': return store.search.more(arg === 'descriptive' ? 'descriptive' : 'fast');
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
        return openPicker();
      case 'signOut':
        void store.auth.signOut();
        return;
      case 'retry':
        return retry(place);
      default:
        notYet(action, arg);
    }
  }, [store, actions, live, select, retry, loadMore, openPicker]);

  return { dispatch, loadMore };
}
