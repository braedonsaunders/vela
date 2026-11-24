// The audio app's Search: a field that takes focus when the page opens, results as the viewer
// types (the store's musicSearch, kept to this library), grouped by what the library holds
// (search-results.ts), and this library's recent searches while the field is empty. Wide, phone
// and TV draw the same page; on a TV the field opens Vela's keyboard (Android TV) or the system's.
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, Pressable as PlainPressable, Text, View, type TextStyle } from 'react-native';
import { msg, number, plural, searchList, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING, Glyph, useInteraction } from '../common/controls';
import { TextField } from '../common/text-field';
import { ownKeyboard, TvKeyboard } from '../common/tv-keyboard';
import { alpha, Cover, useMediaLook } from '../media/parts';
import { MusicContext, placeOf, useMusic, type MusicApp } from './context';
import { useChildren, usePlaylists } from './data';
import { listeningWords, roleLabel } from './listening';
import { musicTV } from './layout';
import { pad, playlistCard } from './pages';
import { FocusGroup, FocusScope, MusicTile, PlayFab, Shelf, Surface, transition } from './parts';
import { ItemList } from './spoken';
import { TrackList } from './tracks';
import { albumsTab, booksBy, listeningResults, seeAllAlbums, type ListeningResults, type ResultGroup, type ResultPerson } from './search-results';

const OWN_KEYBOARD = ownKeyboard(Platform.OS, Platform.isTV);
const web = Platform.OS === 'web';
/** Songs shown beside the top result before "Show all". */
const SONGS_SHOWN = 4;
/** The library the last search was kept to: another library's search opens empty. */
let searchedLibrary = '';

export function ListeningSearch() {
  const app = useMusic();
  const store = useVela();
  const m = useMediaLook();
  const words = listeningWords(app.listening);
  const libraryName = useVelaState(state => state.libraries.value?.find(library => library.id === app.libraryId)?.name ?? '');
  const search = useVelaState(state => state.musicSearch);
  const [text, setText] = useState(() => (searchedLibrary === app.libraryId ? search.query : ''));
  useEffect(() => {
    if (searchedLibrary !== app.libraryId) { searchedLibrary = app.libraryId; store.musicSearch.clear(); }
    store.musicSearch.scopeTo(app.libraryId);
  }, [store, app.libraryId]);
  const change = (next: string) => { setText(next); store.musicSearch.setQuery(next); };
  const query = text.trim();
  return (
    <View style={{ paddingHorizontal: pad(m), paddingTop: m.small ? 12 : 24, paddingBottom: 24 }} testID="music-search">
      <SearchBox value={text} onChange={change} placeholder={msg(words.searchPlaceholder)} onSubmit={() => app.noteSearch(text)} />
      <View style={{ marginTop: m.small ? 18 : 26 }}>
        {query ? <Results query={query} /> : <Recent onPick={change} intro={msg(words.searchIntro, { library: libraryName || msg('music.yourLibrary') })} />}
      </View>
    </View>
  );
}

// ——— The field ———————————————————————————————————————————————————————————————————————

function SearchBox({ value, onChange, placeholder, onSubmit }: { value: string; onChange(text: string): void; placeholder: string; onSubmit(): void }) {
  const m = useMediaLook();
  const tv = musicTV();
  const input = useRef<ComponentRef<typeof TextField>>(null);
  const frame = useRef<ComponentRef<typeof PlainPressable>>(null);
  const [focused, setFocused] = useState(false);
  const [typing, setTyping] = useState(false);
  const { state: clear, handlers: clearHandlers } = useInteraction();
  const height = tv ? 68 : m.small ? 46 : 52;
  const lit = focused;
  // The page opens with the field focused: typing starts at once (a TV focuses the field's entry,
  // and selecting it opens the keyboard).
  useEffect(() => {
    if (Platform.isTV) return;
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  const escape = web ? { onKeyPress: (event: { nativeEvent: { key: string }; preventDefault?(): void }) => {
    if (event.nativeEvent.key !== 'Escape' || value === '') return;
    event.preventDefault?.();
    onChange('');
  } } : {};
  const typed = m.text({ 'font-size': tv ? '22px' : '16px', 'font-weight': '550', color: '$ui.ink' });
  const quiet = m.text({ 'font-size': tv ? '22px' : '16px', color: '$ui.inkQuiet' });
  const field = (
    <TextField ref={input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={m.ui.inkQuiet}
      accessibilityLabel={placeholder} autoCorrect={false} autoCapitalize="none" returnKeyType="search" testID="music-search-input"
      focusable={!OWN_KEYBOARD} onSubmitEditing={onSubmit} {...escape}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[value === '' ? quiet : typed, { flex: 1, minWidth: 0, height: '100%', padding: 0, backgroundColor: 'transparent' },
        web ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {}] as TextStyle[]} />
  );
  const box = [{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, height, paddingLeft: tv ? 24 : 16, paddingRight: 6, borderRadius: height / 2, maxWidth: 720,
    backgroundColor: m.ui.control, borderWidth: tv ? 2 : 1, borderColor: lit ? m.ui.ink : m.ui.glassEdge }, transition('border-color', 120)];
  return (
    <View style={box}>
      {tv ? (
        // On a TV the field is one focus destination: the remote lands on it as the page opens, and
        // selecting it opens the keyboard. The clear button sits beside it, reachable on its own.
        <PlainPressable ref={frame} hasTVPreferredFocus accessibilityRole="search" accessibilityLabel={placeholder} testID="music-search-field"
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onPress={() => (OWN_KEYBOARD ? setTyping(true) : input.current?.focus())}
          style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Glyph symbol="search" size={26} color={lit ? m.ui.ink : m.ui.inkSecondary} />
          {field}
        </PlainPressable>
      ) : <>
        <Glyph symbol="search" size={22} color={lit ? m.ui.ink : m.ui.inkSecondary} />
        {field}
      </>}
      {value !== '' ? (
        <Pressable {...clearHandlers} onPress={() => { onChange(''); if (tv) requestAnimationFrame(() => (frame.current as unknown as { requestTVFocus?(): void } | null)?.requestTVFocus?.()); else input.current?.focus(); }}
          accessibilityRole="button" accessibilityLabel={msg('ui.clearSearch')} testID="music-search-clear"
          style={[NO_RING, { width: height - 12, height: height - 12, borderRadius: (height - 12) / 2, alignItems: 'center', justifyContent: 'center',
            backgroundColor: tv && clear.focus ? m.ui.ink : clear.hover || clear.focus ? m.ui.controlHover : 'transparent' }]}>
          <Glyph symbol="close" size={tv ? 22 : 18} color={tv && clear.focus ? m.ui.inkInverse : m.ui.inkSecondary} />
        </Pressable>
      ) : null}
      {typing ? (
        <TvKeyboard kind="search" label={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} doneLabel={msg('music.search')}
          onDone={() => { setTyping(false); onSubmit(); }} onClose={() => setTyping(false)} testID="music-search-keyboard" />
      ) : null}
    </View>
  );
}

// ——— Recent searches (the field empty) ——————————————————————————————————————————————

function Recent({ onPick, intro }: { onPick(text: string): void; intro: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const tv = musicTV();
  if (!app.searches.length) {
    return (
      <View style={{ alignItems: 'flex-start', gap: 10, paddingTop: 8 }} testID="music-search-intro">
        <Text style={m.text({ 'font-size': tv ? '22px' : '15px', color: '$ui.inkSecondary' })}>{intro}</Text>
      </View>
    );
  }
  return (
    <View testID="music-search-recent" style={{ maxWidth: 720 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <Heading>{msg('listening.recentSearches')}</Heading>
        <TextButton label={msg('listening.clearRecent')} onPress={() => app.dropSearch()} testID="music-search-recent-clear" />
      </View>
      <FocusScope.Provider value="recent-searches"><FocusGroup>
        {app.searches.map(item => <RecentRow key={item} text={item} onPick={() => onPick(item)} onForget={() => app.dropSearch(item)} />)}
      </FocusGroup></FocusScope.Provider>
    </View>
  );
}

function RecentRow({ text, onPick, onForget }: { text: string; onPick(): void; onForget(): void }) {
  const m = useMediaLook();
  const tv = musicTV();
  const { state, handlers } = useInteraction();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Surface onPress={onPick} focusId={`recent:${text}`} label={text} testID={`music-search-recent-${text}`}
        style={(lit, focus) => [{ flex: 1, borderRadius: 8, backgroundColor: lit ? m.ui.control : 'transparent' }, tv ? { borderWidth: 2, borderColor: focus ? m.ui.ink : 'transparent' } : {}, transition('background-color', 120)]}
        contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, height: tv ? 60 : 46 }}>
        {() => <>
          <View pointerEvents="none"><Glyph symbol="clock" size={tv ? 22 : 18} color={m.ui.inkQuiet} /></View>
          <Text pointerEvents="none" numberOfLines={1} style={[m.text({ 'font-size': tv ? '20px' : '15px', color: '$ui.ink' }), { flex: 1 }]}>{text}</Text>
        </>}
      </Surface>
      <Pressable {...handlers} onPress={onForget} accessibilityRole="button" accessibilityLabel={msg('listening.forgetSearch', { query: text })}
        style={[NO_RING, { width: tv ? 52 : 36, height: tv ? 52 : 36, borderRadius: tv ? 26 : 18, alignItems: 'center', justifyContent: 'center',
          backgroundColor: tv && state.focus ? m.ui.ink : state.hover || state.focus ? m.ui.control : 'transparent' }]}>
        <Glyph symbol="close" size={tv ? 20 : 16} color={tv && state.focus ? m.ui.inkInverse : m.ui.inkQuiet} />
      </Pressable>
    </View>
  );
}

// ——— Results ————————————————————————————————————————————————————————————————————————

function Results({ query }: { query: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const store = useVela();
  const search = useVelaState(state => state.musicSearch);
  const list = searchList(search);
  const scoped = !!search.library && search.library === app.libraryId;
  const { playlists } = usePlaylists();
  const own = useMemo(() => (app.listening === 'music' ? playlists.map(playlistCard) : []), [app.listening, playlists]);
  // While the next answer is on its way the last one stays, so the page does not blink per keystroke.
  const last = useRef<{ items: Card[]; query: string } | null>(null);
  if (list.state === 'ready' && search.query.trim() === query && (last.current?.items !== list.items || last.current.query !== query)) last.current = { items: list.items, query };
  const shown = last.current;
  const first = useMemo(() => (shown ? listeningResults(shown.items, shown.query, app.listening, scoped, { playlists: own }) : undefined), [shown, app.listening, scoped, own]);
  // The top artist's own albums join Albums: a name search finds the artist, not each record.
  const artist = first?.top?.media?.role === 'artist' ? first.top : undefined;
  const albums = useChildren(artist?.id)?.value?.items;
  const results = useMemo(() => (shown && albums?.length ? listeningResults(shown.items, shown.query, app.listening, scoped, { playlists: own, artistAlbums: albums }) : first),
    [first, shown, albums, app.listening, scoped, own]);
  // Acting on a result remembers the search, as the viewer found what they looked for.
  const noting = useMemo<MusicApp>(() => ({
    ...app,
    go: place => { app.noteSearch(query); app.go(place); },
    play: (...args) => { app.noteSearch(query); app.play(...args); },
    playCard: (card, shuffle) => { app.noteSearch(query); app.playCard(card, shuffle); },
  }), [app, query]);
  if (list.state === 'failed' && !shown) {
    return (
      <View style={{ gap: 12, alignItems: 'flex-start' }} testID="music-search-failed">
        <Text style={m.text({ 'font-size': '16px', 'font-weight': '650', color: '$ui.ink' })}>{msg('listening.searchFailed')}</Text>
        <Chipish label={msg('ui.tryAgain')} onPress={() => store.musicSearch.setQuery(query, true)} />
      </View>
    );
  }
  if (!results) return <Text style={m.text({ 'font-size': '14px', color: '$ui.inkQuiet' })} testID="music-search-loading">{msg('listening.searching')}</Text>;
  if (results.empty && list.state === 'ready') {
    return (
      <View style={{ gap: 8 }} testID="music-search-empty">
        <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '22px' : '26px', color: '$ui.ink' })}>{msg('listening.noResults', { query })}</Text>
        <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>{msg('listening.noResultsHint')}</Text>
      </View>
    );
  }
  return (
    <MusicContext.Provider value={noting}>
      <View testID="music-search-results" style={{ opacity: list.state === 'loading' ? 0.72 : 1 }}>
        <ResultGroups results={results} query={query} />
      </View>
    </MusicContext.Provider>
  );
}

function ResultGroups({ results, query }: { results: ListeningResults; query: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const tv = musicTV();
  const [person, setPerson] = useState<ResultPerson | null>(null);
  const [allSongs, setAllSongs] = useState(false);
  // Albums' "See all": the artist's whole discography, or every album the library matches.
  const albumView = useVelaState(state => !!albumsTab(state.libraries.value?.find(library => library.id === app.libraryId)?.tabs));
  const allAlbums = app.listening === 'music' ? seeAllAlbums(results, query, albumView) : undefined;
  useEffect(() => { setPerson(null); setAllSongs(false); }, [query]);
  const lead = results.groups.find(g => g.layout === 'rows');
  // Wide (and a TV): the top result beside the first songs (or episodes), as one band.
  const side = m.width >= (tv ? 960 : 1100);
  const rest = results.groups.filter(g => g !== lead);
  if (person) {
    const books = booksBy(results.groups.find(g => g.id === 'books')?.items ?? [], person);
    return (
      <View testID="music-search-person">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <Heading>{msg(person.role === 'author' ? 'listening.by' : 'media.ui.narratedBy', { name: person.name })}</Heading>
          <Chipish label={msg('listening.showAllPeople')} onPress={() => setPerson(null)} />
        </View>
        <TileGrid items={books} />
      </View>
    );
  }
  const leadRows = lead ? <GroupRows group={lead} all={allSongs || !results.top} onAll={() => setAllSongs(!allSongs)} /> : null;
  return (
    <View style={{ gap: 8 }}>
      {results.top ? (
        <View style={side ? { flexDirection: 'row', gap: 28, alignItems: 'flex-start', marginBottom: 20 } : { gap: 20, marginBottom: 12 }}>
          <View style={side ? { width: tv ? 440 : 420 } : { maxWidth: 560 }}>
            <Heading>{msg('listening.topResult')}</Heading>
            <TopResult card={results.top} />
          </View>
          {lead ? <View style={side ? { flex: 1, minWidth: 0 } : undefined}>{leadRows}</View> : null}
        </View>
      ) : leadRows}
      {rest.map(group => group.layout === 'people'
        ? <PeopleShelf key={group.id} group={group} onPick={setPerson} />
        : <View key={group.id} style={{ marginHorizontal: -12 }}><Shelf title={msg(group.title)}
          {...(group.id === 'albums' && allAlbums ? { onMore: () => app.go(allAlbums), moreLabel: msg('music.seeAll'), moreTestID: 'music-search-albums-all' } : {})}>{group.items.map(card => <MusicTile key={card.id} card={card} size={tv ? 200 : m.small ? 132 : 168} subtitle={tileLine(card, app.listening)} testID={`music-search-${group.id}-${card.id}`} />)}</Shelf></View>)}
    </View>
  );
}

function tileLine(card: Card, listening: MusicApp['listening']): string | undefined {
  if (card.kind === 'playlist') return msg('music.playlist');
  if (card.media?.role === 'album') return [card.yearLabel, card.media.byline].filter(Boolean).join(' · ');
  if (listening === 'audiobook') return card.media?.byline || undefined;
  return undefined;
}

/** Songs (the usual tracklist: plays on a click, ⋯ / right-click / long-press for the menu) or episodes. */
function GroupRows({ group, all, onAll }: { group: ResultGroup; all: boolean; onAll(): void }) {
  const m = useMediaLook();
  const items = all ? group.items : group.items.slice(0, SONGS_SHOWN);
  return (
    <View testID={`music-search-${group.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Heading>{msg(group.title)}</Heading>
        {group.items.length > SONGS_SHOWN ? (
          <TextButton label={all ? msg('music.showLess') : msg('music.showAll')} onPress={onAll} testID={`music-search-${group.id}-all`} />
        ) : null}
      </View>
      {group.id === 'episodes'
        ? <ItemList role="episode" items={items} />
        : <TrackList tracks={items} options={{ covers: true, position: true, album: true, source: { id: 'search', name: msg('music.search') } }} />}
    </View>
  );
}

/** The best match, large: its art, name and what it is; a leaf plays, a container opens. */
function TopResult({ card }: { card: Card }) {
  const app = useMusic();
  const m = useMediaLook();
  const tv = musicTV();
  const role = card.media?.role;
  const leaf = role === 'track' || role === 'episode' || role === 'part';
  const round = role === 'artist';
  const size = tv ? 128 : m.small ? 88 : 104;
  const what = card.kind === 'playlist' ? msg('music.playlist') : msg(roleLabel(card));
  const line = [what, round ? '' : card.media?.byline].filter(Boolean).join(' · ');
  const open = () => (leaf ? app.playCard(card) : app.go(placeOf(card)));
  // Touch keeps the play button in reach; a pointer raises it on hover, as a tile's does.
  const touch = !tv && (!web || m.width < 980);
  return (
    <Surface onPress={open} onMenu={(anchor, mode, opener) => app.menu({ card, anchor, mode, opener })} focusId={`top:${card.id}`} testID={`music-search-top-${card.id}`} label={[card.name, line].filter(Boolean).join(', ')}
      style={(lit, focus) => [{ borderRadius: Number(m.ui.radiusCard) || 12, backgroundColor: lit ? m.ui.controlHover : m.ui.control, marginTop: 10 },
        tv ? { borderWidth: 2, borderColor: focus ? m.ui.ink : 'transparent', transform: [{ scale: focus ? 1.02 : 1 }] } : {}, transition('background-color, transform', 160)]}
      contentStyle={{ padding: m.small ? 16 : 20, gap: 16, minHeight: tv ? 260 : m.small ? 180 : 220 }}>
      {lit => <>
        <View pointerEvents="none"><Cover uri={card.poster} shape={round ? 'round' : 'square'} size={size} title={card.name} accent={card.accent} lift={0.6} /></View>
        <View pointerEvents="none" style={{ gap: 6, paddingRight: 64 }}>
          <Text numberOfLines={2} style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': tv ? '34px' : m.small ? '24px' : '30px', 'line-height': '1.1', color: '$ui.ink', 'letter-spacing': '-0.01em' })}>{card.name}</Text>
          <Text numberOfLines={1} style={m.text({ 'font-size': tv ? '18px' : '14px', color: '$ui.inkSecondary' })}>{line}</Text>
        </View>
        {tv ? null : (
          <View pointerEvents={lit || touch ? 'auto' : 'none'} style={[{ position: 'absolute', right: 20, bottom: 20, opacity: lit || touch ? 1 : 0, transform: [{ translateY: lit || touch ? 0 : 8 }] }, transition('opacity, transform', 220)]}>
            <PlayFab playing={false} size={52} onPress={() => app.playCard(card)} label={`${msg('media.ui.play')} ${card.name}`} testID="music-search-top-play" />
          </View>
        )}
      </>}
    </Surface>
  );
}

/** Authors or narrators the books credit: picking one shows their books found. */
function PeopleShelf({ group, onPick }: { group: ResultGroup; onPick(person: ResultPerson): void }) {
  const m = useMediaLook();
  const tv = musicTV();
  const size = tv ? 140 : m.small ? 104 : 128;
  return (
    <View style={{ marginHorizontal: -12 }} testID={`music-search-${group.id}`}>
      <Shelf title={msg(group.title)}>
        {group.people.map(person => (
          <Surface key={person.name} onPress={() => onPick(person)} focusId={`${person.role}:${person.name}`} testID={`music-search-person-${person.name}`}
            label={[person.name, msg(person.role === 'author' ? 'listening.author' : 'listening.narrator'), msg(`media.count.audiobooks.${plural(person.count)}`, { count: number(person.count) })].join(', ')}
            style={(lit, focus) => [{ width: size + 24, borderRadius: Number(m.ui.radiusCard) || 12, backgroundColor: lit ? m.ui.control : 'transparent' },
              tv ? { borderWidth: 2, borderColor: focus ? m.ui.ink : 'transparent', transform: [{ scale: focus ? 1.04 : 1 }] } : {}, transition('background-color, transform', 160)]}
            contentStyle={{ padding: 12, gap: 10, alignItems: 'center' }}>
            {() => <>
              <View pointerEvents="none" style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(m.ui.accent, 0.22) }}>
                <Text style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': `${Math.round(size / 2.8)}px`, color: '$ui.ink' })}>{initials(person.name)}</Text>
              </View>
              <View pointerEvents="none" style={{ alignItems: 'center', gap: 2 }}>
                <Text numberOfLines={1} style={m.text({ 'font-size': tv ? '18px' : '15px', 'font-weight': '650', color: '$ui.ink' })}>{person.name}</Text>
                <Text numberOfLines={1} style={m.text({ 'font-size': tv ? '15px' : '13px', color: '$ui.inkQuiet' })}>{msg(`media.count.audiobooks.${plural(person.count)}`, { count: number(person.count) })}</Text>
              </View>
            </>}
          </Surface>
        ))}
      </Shelf>
    </View>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(part => part[0]!.toUpperCase()).filter(c => /\p{L}/u.test(c)).slice(0, 2).join('') || '·';
}

function TileGrid({ items }: { items: Card[] }) {
  const m = useMediaLook();
  const tv = musicTV();
  return (
    <FocusScope.Provider value="search-grid"><FocusGroup style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -12 }}>
      {items.map(card => <MusicTile key={card.id} card={card} size={tv ? 200 : m.small ? 132 : 168} subtitle={card.media?.byline || undefined} />)}
    </FocusGroup></FocusScope.Provider>
  );
}

function Heading({ children }: { children: ReactNode }) {
  const m = useMediaLook();
  return <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': musicTV() ? '30px' : m.small ? '22px' : '26px', color: '$ui.ink', 'letter-spacing': '-0.01em' })}>{children}</Text>;
}

/** A quiet text action ("Show all", "Clear all"); on a TV its focus fills it with the ink. */
function TextButton({ label, onPress, testID }: { label: string; onPress(): void; testID?: string }) {
  const m = useMediaLook();
  const tv = musicTV();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="button" testID={testID}
      style={[NO_RING, { paddingHorizontal: tv ? 14 : 6, paddingVertical: tv ? 6 : 4, borderRadius: 999, backgroundColor: tv && state.focus ? m.ui.ink : 'transparent' }]}>
      <Text style={m.text({ 'font-size': tv ? '18px' : '13px', 'font-weight': '650', color: tv && state.focus ? m.ui.inkInverse : lit ? '$ui.ink' : '$ui.inkQuiet' })}>{label}</Text>
    </Pressable>
  );
}

function Chipish({ label, onPress }: { label: string; onPress(): void }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="button" style={[NO_RING, { height: musicTV() ? 48 : 34, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center',
      backgroundColor: lit ? m.ui.controlHover : m.ui.control, borderWidth: musicTV() ? 2 : 1, borderColor: musicTV() && state.focus ? m.ui.ink : m.ui.glassEdge }]}>
      <Text style={m.text({ 'font-size': musicTV() ? '18px' : '13px', 'font-weight': '650', color: '$ui.ink' })}>{label}</Text>
    </Pressable>
  );
}
