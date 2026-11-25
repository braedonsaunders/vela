// The Listen blocks lab (development tooling, like the player spike): a built-in-style page
// document drawing the Listen rich blocks through the real resolver, the core screens store and
// the local vela.* sources, against whatever server the app is signed in to (the mock in
// development). /listen-blocks?album=<id>&playlist=<id>&style=1 picks the album, a playlist and
// whether the document styles the blocks' parts. Not bundled in release builds.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { audioCardsOf, type Card } from '@vela/core';
import { labDocument, LAB_HREF as HREF } from './listen-blocks-lab';
import { HostContext } from '@vela/skin/src/host';
import { ScreenView } from '@vela/skin/src/screen/host';
import { builtinDocument } from '@vela/skin/src/resolve/builtin';
import { MusicContext, type MusicApp } from '@vela/skin/src/blocks/listen/app';
import { useVela } from '../vela';
import { useAppScreenActions } from '../screen-actions';

export default function ListenBlocksLab() {
  const vela = useVela();
  const store = vela.store;
  const params = useLocalSearchParams<{ album?: string; playlist?: string; style?: string; mini?: string }>();
  const styled = params.style === '1';
  const host = vela.host('screen', 'vela.listen');
  const doc = useMemo(() => labDocument(styled), [styled]);
  useEffect(() => {
    store.screens.provideDocuments(href => (href === HREF ? doc : builtinDocument(href)));
  }, [store, doc]);
  const pageParams = useMemo(() => ({ album: params.album || 'album-paper-boats', ...(params.playlist ? { playlist: params.playlist } : {}), ...(params.mini ? { mini: params.mini } : {}) }), [params.album, params.playlist, params.mini]);
  const back = useCallback(() => router.back(), []);
  const setParams = useCallback((next: Record<string, string>) => router.setParams(next), []);
  const actions = useAppScreenActions({ host, back, setParams });
  const app = useMemo<MusicApp>(() => ({
    libraryId: '', listening: 'music', place: { kind: 'home' }, go: () => undefined,
    play: (items: Card[], index: number, source, shuffle, positionSeconds) => store.audio.play({ items, index: Math.max(0, index), source, shuffle, positionSeconds }),
    playCard: (card: Card) => { void audioCardsOf(store, card).then(items => store.audio.play({ items, index: 0 })); },
    menu: () => undefined, toggle: () => store.audio.toggle(), drawer: () => undefined,
    like: () => undefined, liked: () => false, searches: [], noteSearch: () => undefined, dropSearch: () => undefined,
  }), [store]);
  if (!host) return <View style={{ flex: 1 }} />;
  return (
    <HostContext.Provider value={host}>
      <MusicContext.Provider value={app}>
        <ScreenView key={styled ? 'styled' : 'plain'} target={{ kind: 'screen', id: 'vela.listen', page: 'blocks-lab' }} href={HREF} params={pageParams} host={host} active actions={actions} />
      </MusicContext.Provider>
    </HostContext.Provider>
  );
}
