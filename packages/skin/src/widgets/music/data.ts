// The music app's reads, over the store's existing loaders (titles, children, detail rows,
// library rows, playlists). Each is bounded by the server's page size.
import { useEffect, useMemo, useState } from 'react';
import { childrenKey, libraryKey, type Card, type ChildrenModel, type CollectionModel, type DetailModel, type Loadable, type PlaylistModel, type Row } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';

export function useTitle(id: string | undefined): Loadable<DetailModel> | undefined {
  const store = useVela();
  const detail = useVelaState(state => (id ? state.titles[id] : undefined));
  useEffect(() => { if (id) void store.catalogue.title(id); }, [store, id]);
  return detail;
}

export function useChildren(id: string | undefined): Loadable<ChildrenModel> | undefined {
  const store = useVela();
  const children = useVelaState(state => (id ? state.children[childrenKey(id)] : undefined));
  useEffect(() => { if (id) void store.media.children(id); }, [store, id]);
  return children;
}

/** A title's detail rows (an artist's Top Tracks, More like this). */
export function useDetailRows(id: string | undefined): Row[] {
  const store = useVela();
  const rows = useVelaState(state => (id ? state.related[id] : undefined));
  useEffect(() => { if (id) void store.catalogue.related(id); }, [store, id]);
  return rows?.value ?? [];
}

/** The library's Home shelves, as the plugin declares them: its `home` tab's, else (a library
 * without one, as an audiobook plugin's) the library's own rows. */
export function useLibraryRows(libraryId: string): { rows: Row[]; loading: boolean } {
  const store = useVela();
  const cached = store.catalogue.cachedLibraryRecommendations(libraryId, 'home')?.value ?? store.catalogue.cachedLibraryRecommendations(libraryId)?.value;
  const [rows, setRows] = useState<Row[] | undefined>(cached);
  useEffect(() => {
    let live = true;
    const read = (tab?: string) => store.catalogue.libraryRecommendations(libraryId, 'shows', false, tab);
    void read('home').catch(() => read(undefined))
      .then(value => { if (live && value) setRows(value); })
      .catch(() => { if (live) setRows(current => current ?? []); });
    return () => { live = false; };
  }, [store, libraryId]);
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
