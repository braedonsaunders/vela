// The audio app: Your Library down the left, the page in the middle, the queue on the right when
// asked for, and the now-playing bar along the bottom. Wide layouts only; phones and TVs draw the
// same pages full width with the floating mini player. Music, audiobooks and podcasts share it;
// listening.ts words each, and spoken.tsx draws spoken word's pages.
import { memo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useVelaState } from '@vela/core/react';
import { useHost } from '../../host';
import { headerInsetOf } from '../../resolve/inherit';
import { useMediaLook } from '../media/parts';
import { useMusic } from '../../blocks/listen/app';
import { MusicLiked, MusicPlaylist } from './pages';
import { MusicRewind } from './rewind';
import { MusicImport } from './import';
import { MusicDuplicates } from './duplicates';
import { ListeningHome, ListeningTitle } from './spoken';
import { MINI_PLAYER_HEIGHT } from '../media/player';
import { compactMusic, musicTV } from '../../blocks/listen/layout';
import type { MusicPlace } from '../../blocks/listen/place';
import { BarPanelView, NowPlayingBar, NOW_PLAYING_BAR_HEIGHT, type BarPanel } from '../../blocks/listen/bar';
import { QueuePanel } from '../../blocks/listen/queue';
import { RailChips, RailIcons, Sidebar } from '../../blocks/listen/rail';
import { ListeningSearch } from './search';
import { MusicAlbums } from './albums';
import { PageScrollContext, usePageScroll } from './paging';

function renderMusicPage(page: MusicPlace, music: boolean): ReactNode {
  if (page.kind === 'liked' && music) return <MusicLiked />;
  if (page.kind === 'rewind') return <MusicRewind />;
  if (page.kind === 'import' && music) return <MusicImport />;
  if (page.kind === 'duplicates' && music) return <MusicDuplicates />;
  if (page.kind === 'playlist') return <MusicPlaylist id={page.id} />;
  if (page.kind === 'title') return <ListeningTitle id={page.id} />;
  if (page.kind === 'search') return <ListeningSearch />;
  if (page.kind === 'albums' && music) return <MusicAlbums query={page.query} />;
  return <ListeningHome />;
}
import { SoundBlock } from '../../blocks/sound';

/** Drawn again only when its own props or what it reads change: the section around it draws for
 * every change of the app's state, and the page below is hundreds of tiles. */
export const MusicShell = memo(function MusicShell({ queueOpen, onQueue }: { queueOpen: boolean; onQueue(open: boolean): void }) {
  const app = useMusic();
  const m = useMediaLook();
  const host = useHost();
  // Below the shell's navigation, wherever this document draws it (overlay or in flow).
  const inset = host.doc.document.traits?.headerInset ?? headerInsetOf(host.doc.document.slots?.shell);
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<BarPanel>('');
  // The side beside the page holds the queue or Sound, one at a time.
  const [soundOpen, setSoundOpen] = useState(false);
  const sideSound = soundOpen;
  const sideQueue = queueOpen && !soundOpen;
  const music = app.listening === 'music';
  const narrow = m.width < 1180;
  const rail = collapsed || narrow;
  const page = app.place;
  const scroll = usePageScroll(pageKey(page));
  const top = `calc(${m.small ? inset.small : inset.wide} + 6px)`;
  if (musicTV()) return <TVShell top={top} />;
  if (compactMusic(m)) return <CompactShell top={top} />;
  // Flush to the window: no rounded inset panels and no gaps. The sidebar and the queue sit on
  // the raised tone and a hairline divides each from the page; the bar has a hairline above it.
  const hairline = m.box({ 'background-color': '$ui.glassEdge' });
  const side = (children: ReactNode, width: number, edge: 'left' | 'right') => (
    <View style={[{ width, backgroundColor: m.ui.raised, flexDirection: 'row' }]}>
      {edge === 'left' ? <View style={[{ width: 1 }, hairline]} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      {edge === 'right' ? <View style={[{ width: 1 }, hairline]} /> : null}
    </View>
  );
  return (
    <View pointerEvents="box-none" style={[{ flex: 1 }, m.box({ 'padding-top': top })]} testID="music-shell">
      <View style={[{ height: 1 }, hairline]} />
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        {side(<Sidebar rail={rail} onToggle={() => setCollapsed(!collapsed)} />, rail ? 84 : 316, 'right')}
        {flush(
          <ScrollView key={pageKey(page)} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} testID="music-main" {...scroll.handlers}>
            <PageScrollContext.Provider value={scroll}>{renderMusicPage(page, music)}</PageScrollContext.Provider>
          </ScrollView>)}
        {sideSound ? side(<SoundBlock onClose={() => setSoundOpen(false)} />, 360, 'left')
          : sideQueue ? side(<QueuePanel onClose={() => onQueue(false)} />, 340, 'left') : null}
      </View>
      <View style={[{ height: 1 }, hairline]} />
      <View style={{ height: NOW_PLAYING_BAR_HEIGHT, backgroundColor: m.ui.raised }}><NowPlayingBar queueOpen={sideQueue} onQueue={() => { setSoundOpen(false); onQueue(!sideQueue); }} soundOpen={sideSound} onSound={() => setSoundOpen(!sideSound)} panel={panel} onPanel={setPanel} /></View>
      <BarPanelView panel={panel} onClose={() => setPanel('')} />
    </View>
  );
});

/** Phones and upright tablets: Home, Search and Your Library (plus Rewind when available) as chips
 * under the app's navigation, the page full width, and the floating mini player over it. */
function CompactShell({ top }: { top: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const page = app.place;
  const scroll = usePageScroll(pageKey(page));
  const music = app.listening === 'music';
  const queued = useVelaState(state => !!state.audio.queue);
  return (
    <View pointerEvents="box-none" style={[{ flex: 1 }, m.box({ 'padding-top': top })]} testID="music-shell">
      <RailChips />
      <ScrollView key={pageKey(page)} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: queued ? MINI_PLAYER_HEIGHT + 48 : 32 }} testID="music-main" {...scroll.handlers}>
        <PageScrollContext.Provider value={scroll}>{page.kind === 'library' ? <Sidebar rail={false} onToggle={() => undefined} embedded />
          : renderMusicPage(page, music)}</PageScrollContext.Provider>
      </ScrollView>
    </View>
  );
}

/** A TV: an icon rail (Home, Search, Your Library, Rewind and, for music, Liked Songs) beside a
 * full-width page; the focusable mini player floats over it and opens Now Playing. Everything is
 * one focus target at a time; Back walks Now Playing → page → music Home → the app. */
function TVShell({ top }: { top: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const host = useHost();
  const page = app.place;
  const scroll = usePageScroll(pageKey(page));
  const music = app.listening === 'music';
  const queued = useVelaState(state => !!state.audio.queue);
  // The page ends where the mini player begins, which the dock lifts above the bottom safe inset
  // (media/audio.tsx): Apple TV's inset is 60pt, and a fixed margin left the last rows under the bar.
  const dock = MINI_PLAYER_HEIGHT + Math.max(14, host.viewport.insets.bottom + 10) + 14;
  return (
    <View pointerEvents="box-none" style={[{ flex: 1, flexDirection: 'row' }, m.box({ 'padding-top': top })]} testID="music-shell">
      <RailIcons />
      {/* The page ends above the floating mini player, so a focused row is never under it. */}
      <ScrollView key={pageKey(page)} style={{ flex: 1, marginBottom: queued ? dock : 0 }} contentContainerStyle={{ paddingBottom: 48, paddingRight: 32 }} testID="music-main" {...scroll.handlers}>
        <PageScrollContext.Provider value={scroll}>{page.kind === 'library' ? <Sidebar rail={false} onToggle={() => undefined} embedded />
          : renderMusicPage(page, music)}</PageScrollContext.Provider>
      </ScrollView>
    </View>
  );
}

/** The page column: the rest of the width, straight to the edges. */
function flush(children: ReactNode): ReactNode {
  return <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>{children}</View>;
}

function pageKey(place: MusicPlace): string {
  return place.kind === 'title' || place.kind === 'playlist' ? `${place.kind}:${place.id}` : place.kind === 'albums' ? `albums:${place.query}` : place.kind;
}
