// A music library opens as the music app (wide layouts): the shell from the skin package, given the
// app's router, player and the card menu. The page in view lives in the address (`?m=`).
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { audioCardsOf, type Card } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import type { SkinHost } from '@vela/skin';
import { HostContext } from '@vela/skin/src/host';
import { CardContextMenu } from '@vela/skin/src/widgets/card-context-menu';
import { MusicContext, MusicShell, parsePlace, placeOf, placeParam, type MusicApp, type MusicMenuRequest, type MusicPlace } from '@vela/skin/src/widgets/music';
import { useVela } from '../vela';

/** Whether this library draws as the music app: a music library on a wide screen (not a TV yet). */
export function useMusicShell(libraryId: string): boolean {
  const vela = useVela();
  const media = useVelaState(state => state.libraries.value?.find(library => library.id === libraryId)?.media);
  const host = vela.host('library', libraryId);
  return media === 'music' && !Platform.isTV && (host?.viewport.width ?? 0) >= 980;
}

export function MusicSection({ libraryId, at }: { libraryId: string; at: string | undefined }) {
  const vela = useVela();
  const store = vela.store;
  const base = vela.host('library', libraryId);
  const place = parsePlace(at);
  const [menu, setMenu] = useState<MusicMenuRequest | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
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
          {menu ? (
            <CardContextMenu card={menu.card} primary={{ action: 'select', arg: `${menu.card.id}|${menu.card.media?.role ?? menu.card.kind}|` }}
              anchor={menu.anchor} mode="pointer" opener={null} playlistEntry={menu.entry} close={() => setMenu(null)}
              href={`/library/${libraryId}?m=${encodeURIComponent(placeParam(placeOf(menu.card)))}`} />
          ) : null}
        </View>
      </MusicContext.Provider>
    </HostContext.Provider>
  );
}
