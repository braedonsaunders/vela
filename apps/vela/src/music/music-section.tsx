// A library whose experience is 'listen' opens as the audio app: the shell from the skin package,
// given the app's router, player and the card menu, worded for what the library holds (music,
// audiobooks, podcasts). The page in view lives in the address (`?m=`).
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { audioCardsOf, likedTitleIds, setTitleLiked, type Card } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import type { SkinHost } from '@vela/skin';
import { TrackedHost } from '@vela/skin/src/host';
import { CardContextMenu } from '@vela/skin/src/widgets/card-context-menu';
import { MusicContext, MusicShell, PlaylistDrawer, parsePlace, placeOf, placeParam, type PlaylistDrawerRequest, type MusicApp, type MusicMenuRequest, type MusicPlace } from '@vela/skin/src/widgets/music';
import { listenFrom, listeningOf } from '@vela/skin/src/blocks/listen/listening';
import { forgetSearch, readRecent, rememberSearch } from '@vela/skin/src/widgets/music/search-results';
import { preferences } from '../data/preferences';
import { useVela } from '../vela';
import { ListenKeys, useListenBack } from '../listen/keys';

/** Titles the audio app opens in place: its roles (and the card kinds media titles carry). */
const OPENS_IN_PLACE = ['artist', 'album', 'track', 'season', 'show', 'audiobook', 'part', 'series', 'episode', 'podcast', 'podcastEpisode'];

export function MusicSection({ libraryId, at }: { libraryId: string; at: string | undefined }) {
  const vela = useVela();
  const store = vela.store;
  const base = vela.host('library', libraryId);
  // The place is read from the address on every draw; the same address must give the same place,
  // or every tile of the page draws again whenever the app's shell does.
  const place = useMemo(() => parsePlace(at), [at]);
  const listening = listeningOf(useVelaState(state => state.libraries.value?.find(library => library.id === libraryId)?.media));
  const [menu, setMenu] = useState<MusicMenuRequest | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [drawer, setDrawer] = useState<PlaylistDrawerRequest | null>(null);
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  // Recent searches are this library's on this server for this viewer, kept on this device.
  const searchesKey = useVelaState(state => `music.recentSearches.${state.servers.selectedId}.${state.auth.viewerId || state.auth.viewer}.${libraryId}`);
  const [searches, setSearches] = useState<string[]>(() => readRecent(preferences.get(searchesKey)));
  useEffect(() => { setSearches(readRecent(preferences.get(searchesKey))); }, [searchesKey]);
  const keepSearches = useCallback((change: (list: string[]) => string[]) => setSearches(list => {
    const next = change(list);
    preferences.set(searchesKey, JSON.stringify(next));
    return next;
  }), [searchesKey]);
  const favorites = useVelaState(state => state.collections);
  const roleLists = useVelaState(state => state.music.liked);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const likedIds = useMemo(() => likedTitleIds(store.getState()), [store, favorites, roleLists]);

  // One like or unlike, from a heart, Follow or a card's menu: the hearts change at once, the
  // title leaves Liked Songs and Your Library at once (the store's optimistic watch change), and
  // the lists that show it read again. A refusal puts the heart back and rejects.
  const setLike = useCallback((card: Card, on: boolean): Promise<void> => {
    setLikes(current => ({ ...current, [card.id]: on }));
    return setTitleLiked(store, card, on)
      .then(() => undefined, (error: unknown) => {
        setLikes(current => ({ ...current, [card.id]: !on }));
        throw error;
      });
  }, [store]);

  const go = useCallback((next: MusicPlace) => {
    router.push({ pathname: '/library/[id]', params: { id: libraryId, m: placeParam(next) } });
  }, [libraryId]);
  // tvOS gives Menu to the app only while something holds it (menu-key.ts); a music page is not a
  // screen of its own, so Menu on an album left Vela for the system's Home. Held on every page but
  // music Home, Menu goes back a page, as Back does on Android TV; on music Home the sections'
  // fallback hold takes it to Vela's Home, as from any other section's root.
  // Search is one of the rail's roots: Back from it goes to music Home on both TVs, whatever page
  // it was opened from (then, from music Home, to Vela's Home).
  const home = place.kind === 'home';
  const searching = place.kind === 'search';
  useListenBack({
    home, searching,
    back: () => { if (!router.canGoBack()) return false; router.back(); return true; },
    toHome: () => router.replace({ pathname: '/library/[id]', params: { id: libraryId } }),
  });
  const app = useMemo<MusicApp>(() => ({
    libraryId,
    listening,
    place,
    go,
    play: (items: Card[], index: number, source, shuffle, positionSeconds) => store.audio.play({ items, index: Math.max(0, index), source, shuffle, positionSeconds }),
    playCard: (card: Card, shuffle?: boolean) => {
      const role = card.media?.role;
      const leaf = role === 'track' || role === 'episode' || role === 'part';
      const source = leaf ? undefined : { id: card.id, name: card.name, kind: card.kind === 'playlist' ? 'playlist' as const : 'title' as const };
      // A book resumes where the viewer left it (in the part under way), a show at its episode
      // under way, else its newest.
      void audioCardsOf(store, card).then(items => store.audio.play({ ...(role === 'show' || role === 'audiobook' ? listenFrom(card, items) : { items, index: 0 }), shuffle, source }));
    },
    menu: setMenu,
    toggle: () => store.audio.toggle(),
    drawer: setDrawer,
    like: (card: Card, on: boolean) => { void setLike(card, on).catch(() => undefined); },
    liked: (id: string) => likes[id] ?? likedIds.has(id),
    searches,
    noteSearch: (query: string) => keepSearches(list => rememberSearch(list, query)),
    dropSearch: (query?: string) => keepSearches(list => (query === undefined ? [] : forgetSearch(list, query))),
  }), [libraryId, listening, place, go, store, setLike, likes, likedIds, searches, keepSearches]);

  const keysApp = useMemo(() => ({
    listening, searching, search: () => go({ kind: 'search' }), toggleQueue: () => setQueueOpen(open => !open), like: app.like, liked: app.liked,
  }), [listening, searching, go, app]);

  // In the music app a title opens in place, not as the title page above it.
  const host = useMemo<SkinHost | null>(() => base ? {
    ...base,
    dispatch: (action: string, arg: string) => {
      if (action === 'select') {
        const [id = '', kind = ''] = arg.split('|');
        if (id && OPENS_IN_PLACE.includes(kind)) { go({ kind: 'title', id }); return; }
      }
      base.dispatch(action as never, arg);
    },
  } : null, [base, go]);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  if (!host) return null;
  // A tracked host: the music app's parts draw again only for the host and env keys they read,
  // not whenever any of Vela's view state changes (a flag elsewhere, the home hero).
  return (
    <TrackedHost host={host}>
      <MusicContext.Provider value={app}>
        <View pointerEvents="box-none" style={{ flex: 1 }}>
          <MusicShell queueOpen={queueOpen} onQueue={setQueueOpen} />
          <PlaylistDrawer request={drawer} close={closeDrawer} />
          <ListenKeys store={store} app={keysApp} />
          {menu ? (
            <CardContextMenu card={menu.card} primary={{ action: 'select', arg: `${menu.card.id}|${menu.card.media?.role ?? menu.card.kind}|` }}
              anchor={menu.anchor} mode={menu.mode ?? 'pointer'} opener={menu.opener ?? null} playlistEntry={menu.entry} close={() => setMenu(null)}
              favorite={{ on: app.liked(menu.card.id), set: on => setLike(menu.card, on) }}
              href={`/library/${libraryId}?m=${encodeURIComponent(placeParam(placeOf(menu.card)))}`} />
          ) : null}
        </View>
      </MusicContext.Provider>
    </TrackedHost>
  );
}
