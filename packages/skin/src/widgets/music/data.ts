// The music app's reads, over the store's existing loaders (titles, children, detail rows,
// library rows, playlists, listening recap, playlist import, duplicates). A title's children and
// the albums a search matches read page after page; the rest are bounded by the server's page size.
import { useEffect, useMemo, useState } from 'react';
import { childrenKey, libraryHomeTab, libraryKey, type Card, type ChildrenModel, type CollectionModel, type DetailModel, type Loadable, type PlaylistModel, type Row } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';

export { useHistoryRecap } from '../../blocks/recap';
export { usePlaylistImport } from '../../blocks/import';
export { useLibraryDuplicates, useTitleRecording } from '../../blocks/duplicates';

export function useTitle(id: string | undefined): Loadable<DetailModel> | undefined {
  const store = useVela();
  const detail = useVelaState(state => (id ? state.titles[id] : undefined));
  useEffect(() => { if (id) void store.catalogue.title(id); }, [store, id]);
  return detail;
}

/** A title's children, appended page by page as they land. `all`: every one there is (an
 * artist's discography), not just the store's usual first thousand. */
export function useChildren(id: string | undefined, all = false): Loadable<ChildrenModel> | undefined {
  const store = useVela();
  const children = useVelaState(state => (id ? state.children[childrenKey(id)] : undefined));
  useEffect(() => { if (id) void store.media.children(id, false, undefined, all ? Infinity : undefined); }, [store, id, all]);
  return children;
}

/** A title's detail rows (an artist's Top Tracks, More like this). */
export function useDetailRows(id: string | undefined): Row[] {
  const store = useVela();
  const rows = useVelaState(state => (id ? state.related[id] : undefined));
  useEffect(() => { if (id) void store.catalogue.related(id); }, [store, id]);
  return rows?.value ?? [];
}

/** The library's Home shelves, as the plugin declares them: its `home` tab's when it declares one,
 * else (an audiobook plugin's library without it) the library's own rows. */
export function useLibraryRows(libraryId: string): { rows: Row[]; loading: boolean } {
  const store = useVela();
  const tab = useVelaState(state => libraryHomeTab(state.libraries.value?.find(library => library.id === libraryId)?.tabs));
  const cached = store.catalogue.cachedLibraryRecommendations(libraryId, tab)?.value;
  const [rows, setRows] = useState<Row[] | undefined>(cached);
  useEffect(() => {
    let live = true;
    void store.catalogue.libraryRecommendations(libraryId, 'shows', false, tab)
      .then(value => { if (live && value) setRows(value); })
      .catch(() => { if (live) setRows(current => current ?? []); });
    return () => { live = false; };
  }, [store, libraryId, tab]);
  return { rows: rows ?? [], loading: !rows };
}

/** The viewer's playlists, with the marked Favorites list (Liked Songs) apart. */
export function usePlaylists(): { playlists: PlaylistModel[]; liked: PlaylistModel | undefined; loading: boolean } {
  const store = useVela();
  const list = useVelaState(state => state.playlists.list);
  const available = useVelaState(state => state.home.value?.playlistsAvailable === true);
  useEffect(() => { if (available && list.load === 'idle') void store.playlists.load(); }, [store, available, list.load]);
  return useMemo(() => {
    const all = list.value ?? [];
    // S0: Ether's marked favourites playlist; S1 serves liked items by role (plan §2.1).
    const liked = all.find(p => p.name === 'Favorites');
    return { playlists: all.filter(p => p !== liked), liked, loading: list.load === 'loading' && !list.value };
  }, [list]);
}

export function usePlaylist(id: string | undefined): Loadable<CollectionModel> | undefined {
  const store = useVela();
  const value = useVelaState(state => (id ? state.collections[id] : undefined));
  const available = useVelaState(state => state.home.value?.playlistsAvailable === true);
  useEffect(() => { if (id && available) void store.playlists.open(id); }, [store, id, available]);
  return value;
}

export type Liked = { tracks: Card[]; albums: Card[]; artists: Card[]; loading: boolean; trackTotal: number; moreTracks: boolean; loadMoreTracks(): void };

/** What the viewer liked, split by role: the server's role lists where it has them
 * (features.favoritesList), else the Favorites playlist (servers before it). */
export function useLiked(): Liked {
  const store = useVela();
  const listed = useVelaState(state => state.music.liked);
  const byRole = store.music.likedAvailable;
  const features = useVelaState(state => state.home.value?.playlistsAvailable);
  useEffect(() => {
    if (!byRole) return;
    for (const role of ['track', 'album', 'artist']) void store.music.liked(role);
  }, [store, byRole, features]);
  const { liked } = usePlaylists();
  const list = usePlaylist(byRole ? undefined : liked?.id);
  return useMemo(() => {
    if (byRole) {
      const tracks = listed.track?.value;
      return {
        tracks: tracks?.items ?? [], albums: listed.album?.value?.items ?? [], artists: listed.artist?.value?.items ?? [],
        loading: !tracks, trackTotal: tracks?.total ?? 0, moreTracks: !!tracks?.more, loadMoreTracks: () => void store.music.liked('track', true),
      };
    }
    const items = list?.value?.items ?? [];
    const music = items.filter(item => item.media?.class === 'music');
    const tracks = music.filter(item => item.media?.role === 'track');
    return {
      tracks, albums: music.filter(item => item.media?.role === 'album'), artists: music.filter(item => item.media?.role === 'artist'),
      loading: !list?.value, trackTotal: tracks.length, moreTracks: false, loadMoreTracks: () => undefined,
    };
  }, [byRole, listed, list, store]);
}

/** What the viewer last played from (features.playContexts); empty on servers without it. */
export function useRecent(): { items: import('@vela/core').RecentContext[]; available: boolean } {
  const store = useVela();
  const recent = useVelaState(state => state.music.recent);
  const phase = useVelaState(state => state.audio.queue?.source?.id);
  const available = store.music.recentAvailable;
  // Read on open and whenever a new source starts playing, so Home reflects it.
  useEffect(() => { if (available) void store.music.recent(true); }, [store, available, phase]);
  return { items: recent.value ?? [], available };
}

/** The library's own titles (its root level: books, shows), the first page in the server's order. */
export function useLibraryItems(libraryId: string): { items: Card[]; loading: boolean } {
  const store = useVela();
  const library = useVelaState(state => state.library[libraryKey(libraryId, {})]);
  useEffect(() => { void store.catalogue.library(libraryId, {}).catch(() => undefined); }, [store, libraryId]);
  return { items: library?.value?.items ?? [], loading: !library?.value };
}

/** Albums per page in the albums a search matches. */
export const ALBUMS_PAGE = 50;

export type AlbumPages = { items: Card[]; loading: boolean; failed: boolean; more: boolean; loadMore(): void };

/** Every album in the library matching `query`, from its album view (`tab`), 50 a page: the
 * first page on open, the next when the page asks (scrolled to its end). The server gives no
 * total, so none is shown; the end is its exhausted continuation. */
export function useLibraryAlbums(libraryId: string, tab: string | undefined, query: string): AlbumPages {
  const store = useVela();
  const browse = useMemo(() => ({ tab, query, limit: ALBUMS_PAGE }), [tab, query]);
  const key = libraryKey(libraryId, browse);
  const view = useVelaState(state => (tab ? state.library[key] : undefined));
  useEffect(() => { if (tab && query) void store.catalogue.library(libraryId, browse).catch(() => undefined); }, [store, libraryId, tab, query, browse]);
  const value = view?.value;
  const loading = view?.load === 'loading';
  return {
    items: value?.items ?? [],
    loading: !!tab && (loading || !view),
    failed: view?.load === 'failed',
    more: !!value?.more,
    loadMore: () => {
      if (!tab || loading) return;
      void store.catalogue.library(libraryId, browse, value?.more ? value.pages + 1 : value?.pages ?? 1).catch(() => undefined);
    },
  };
}
