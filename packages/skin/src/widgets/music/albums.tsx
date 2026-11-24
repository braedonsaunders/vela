// Every album in the library a search matches (Search's Albums "See all" when the albums found
// are by several artists): the library's album view searched for the query, 50 a page, the next
// page read as the grid's end comes into reach. The server gives no total, so none is shown.
// Wide, phone and TV draw the same grid; on a TV focus moves through it with the D-pad.
import { Text, View } from 'react-native';
import { msg } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { useMediaLook } from '../media/parts';
import { useMusic } from './context';
import { useLibraryAlbums } from './data';
import { musicTV } from './layout';
import { pad } from './pages';
import { PageEnd } from './paging';
import { FocusGroup, FocusScope, MusicTile } from './parts';
import { albumsTab } from './search-results';

export function MusicAlbums({ query }: { query: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const tv = musicTV();
  const tab = useVelaState(state => albumsTab(state.libraries.value?.find(library => library.id === app.libraryId)?.tabs));
  const libraries = useVelaState(state => state.libraries.load);
  const albums = useLibraryAlbums(app.libraryId, tab, query);
  const size = tv ? 200 : m.small ? 132 : 168;
  const quiet = m.text({ 'font-size': tv ? '20px' : '15px', color: '$ui.inkSecondary' });
  // A library without a searchable album view has nothing to list (an address opened elsewhere).
  const unavailable = !tab && libraries !== 'loading';
  return (
    <View style={{ paddingHorizontal: pad(m), paddingTop: m.small ? 12 : 24, paddingBottom: 24 }} testID="music-albums">
      <Text style={m.text({ 'font-size': tv ? '16px' : '13px', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: '$ui.inkSecondary' })}>{msg('music.albums')}</Text>
      <Text accessibilityRole="header" numberOfLines={2} style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': tv ? '40px' : m.small ? '26px' : '34px', color: '$ui.ink', 'letter-spacing': '-0.01em' }), { marginTop: 4, marginBottom: m.small ? 12 : 18 }]}>
        {msg('music.albumsMatching', { query })}
      </Text>
      {unavailable || (!albums.loading && !albums.failed && !albums.items.length)
        ? <Text style={quiet} testID="music-albums-empty">{msg('listening.noResults', { query })}</Text>
        : albums.failed && !albums.items.length ? null
        : !albums.items.length ? <Text style={quiet} testID="music-albums-loading">{msg('listening.searching')}</Text> : null}
      <FocusScope.Provider value="albums-grid">
        <FocusGroup style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: m.small ? -8 : -12 }}>
          {albums.items.map((card, index) => (
            <MusicTile key={card.id} card={card} size={size} preferred={index === 0} testID={`music-albums-${card.id}`}
              subtitle={[card.yearLabel, card.media?.byline].filter(Boolean).join(' · ') || undefined} />
          ))}
        </FocusGroup>
      </FocusScope.Provider>
      <PageEnd more={albums.more} loading={albums.loading} failed={albums.failed} onMore={albums.loadMore} testID="music-albums-end"
        failedLabel={albums.items.length ? undefined : msg('listening.searchFailed')} />
    </View>
  );
}
