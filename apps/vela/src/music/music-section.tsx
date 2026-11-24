// A music library opens as the music app (wide layouts): the shell from the skin package, given the
// app's router, player and the card menu. The page in view lives in the address (`?m=`).
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { audioCardsOf, type Card } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import type { SkinHost } from '@vela/skin';
import { HostContext } from '@vela/skin/src/host';
import { CardContextMenu } from '@vela/skin/src/widgets/card-context-menu';
import { holdBack } from '@vela/skin/src/menu-key';
import { MusicContext, MusicShell, PlaylistDrawer, parsePlace, placeOf, placeParam, type PlaylistDrawerRequest, type MusicApp, type MusicMenuRequest, type MusicPlace } from '@vela/skin/src/widgets/music';
import { useVela } from '../vela';
import { useMusicKeys } from './keys';
import { MusicKeysSheet } from './keys-sheet';

/** Whether this library draws as the music app: every music library, in the shell's wide,
 * compact (below 980px) or TV form. */
export function useMusicShell(libraryId: string): boolean {
  const media = useVelaState(state => state.libraries.value?.find(library => library.id === libraryId)?.media);
  return media === 'music';
}

export function MusicSection({ libraryId, at }: { libraryId: string; at: string | undefined }) {
  const vela = useVela();
  const store = vela.store;
  const base = vela.host('library', libraryId);
  const place = parsePlace(at);
  const [menu, setMenu] = useState<MusicMenuRequest | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [drawer, setDrawer] = useState<PlaylistDrawerRequest | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const favorites = useVelaState(state => state.collections);
  const roleLists = useVelaState(state => state.music.liked);
  const likedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Object.values(roleLists)) for (const item of list?.value?.items ?? []) ids.add(item.id);
    for (const value of Object.values(favorites)) {
      if (value?.value?.name !== 'Favorites') continue;
      for (const item of value.value.items) ids.add(item.id);
    }
    return ids;
  }, [favorites, roleLists]);

  const go = useCallback((next: MusicPlace) => {
    router.push({ pathname: '/library/[id]', params: { id: libraryId, m: placeParam(next) } });
  }, [libraryId]);
  // tvOS gives Menu to the app only while something holds it (menu-key.ts); a music page is not a
  // screen of its own, so Menu on an album left Vela for the system's Home. Held on every page but
  // music Home, Menu goes back a page, as Back does on Android TV; on music Home it leaves the
  // section as it does from any other.
  const home = place.kind === 'home';
  useEffect(() => {
    if (!Platform.isTV || Platform.OS !== 'ios' || home) return;
    return holdBack(() => {
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/library/[id]', params: { id: libraryId } });
      return true;
    });
  }, [home, libraryId]);
  const app = useMemo<MusicApp>(() => ({
    libraryId,
    place,
    go,
    play: (items: Card[], index: number, source, shuffle) => store.audio.play({ items, index: Math.max(0, index), source, shuffle }),
    playCard: (card: Card, shuffle?: boolean) => {
      const source = card.media?.role === 'track' ? undefined : { id: card.id, name: card.name, kind: card.kind === 'playlist' ? 'playlist' as const : 'title' as const };
      void audioCardsOf(store, card).then(items => store.audio.play({ items, index: 0, shuffle, source }));
    },
    menu: setMenu,
    toggle: () => store.audio.toggle(),
    drawer: setDrawer,
    like: (card: Card, on: boolean) => {
      setLikes(current => ({ ...current, [card.id]: on }));
      void store.catalogue.setTitleWatch(card.id, { favorite: on })
        .then(() => {
          // A row heart, a menu or Follow anywhere: the lists that show it read again.
          const role = card.media?.role;
          if (store.music.likedAvailable && role) { void store.music.liked(role, false, true); return; }
          const liked = store.getState().playlists.list.value?.find(p => p.name === 'Favorites');
          if (liked) void store.playlists.open(liked.id, false, true);
        })
        .catch(() => setLikes(current => ({ ...current, [card.id]: !on })));
    },
    liked: (id: string) => likes[id] ?? likedIds.has(id),
  }), [libraryId, place, go, store, likes, likedIds]);

  const keyActions = useMemo(() => ({ toggleQueue: () => setQueueOpen(open => !open), help: () => setKeysOpen(true) }), []);
  useMusicKeys(store, app, keyActions);

  // In the music app a title opens in place, not as the title page above it.
  const host = useMemo<SkinHost | null>(() => base ? {
    ...base,
    dispatch: (action: string, arg: string) => {
      if (action === 'select') {
        const [id = '', kind = ''] = arg.split('|');
        if (id && ['artist', 'album', 'track', 'season', 'show'].includes(kind)) { go({ kind: 'title', id }); return; }
      }
      base.dispatch(action as never, arg);
    },
  } : null, [base, go]);
  if (!host) return null;
  return (
    <HostContext.Provider value={host}>
      <MusicContext.Provider value={app}>
        <View pointerEvents="box-none" style={{ flex: 1 }}>
          <MusicShell queueOpen={queueOpen} onQueue={setQueueOpen} />
          <PlaylistDrawer request={drawer} close={() => setDrawer(null)} />
          <MusicKeysSheet open={keysOpen} close={() => setKeysOpen(false)} />
          {menu ? (
            <CardContextMenu card={menu.card} primary={{ action: 'select', arg: `${menu.card.id}|${menu.card.media?.role ?? menu.card.kind}|` }}
              anchor={menu.anchor} mode={menu.mode ?? 'pointer'} opener={menu.opener ?? null} playlistEntry={menu.entry} close={() => setMenu(null)}
              href={`/library/${libraryId}?m=${encodeURIComponent(placeParam(placeOf(menu.card)))}`} />
          ) : null}
        </View>
      </MusicContext.Provider>
    </HostContext.Provider>
  );
}
