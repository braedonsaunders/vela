// The `trackTable` block's engine: a tracklist. Number (a play control on hover, a live meter on the
// track playing), cover, title and artist, album, the heart, duration and the row's menu.
// Double-click or Enter plays from that track; right-click or long-press opens the menu at the
// pointer, ⋯ opens it beside the row. A document styles its parts (trackTable.*) and may replace
// a row's drawing (the trackTable.row template); the row keeps its press, menu and focus. Long
// lists draw their first rows with the page and the rest over the next frames.
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';
import { clock, isUnreleased, msg, number, releaseLabel, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { currentInQueue } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING, Glyph } from '../../widgets/common/controls';
import { alpha, Cover, useMediaLook } from '../../widgets/media/parts';
import { MediaGlyph } from '../../widgets/media/icons';
import { useMusic } from './app';
import { FocusGroup, FocusScope, Heart, IconButton, Surface, transition, type MenuOpen } from './parts';
import { musicTV } from './layout';
import { usePart, usePartStyler, useHasTemplate, useListenLook } from './look';
import { discGroups, moveItem, nextRowCount, playlistMove } from './props';

const web = Platform.OS === 'web';

export interface TrackListOptions {
  /** Show each track's cover (a playlist, Liked Songs, Top Tracks). */
  covers?: boolean;
  /** Show the album column. */
  album?: boolean;
  /** The date already shown in the album's action row. */
  albumAirDate?: string;
  /** Number by position instead of track number. */
  position?: boolean;
  /** Where these tracks are listed, for Now Playing's "Playing from". */
  source?: { id: string; name: string; kind?: 'title' | 'playlist' | 'favorites' };
  /** Playlist entries: entry ids for Remove from this playlist. */
  playlist?: { id: string; entryIds: string[] };
  /** Draw the column header (never on a phone). Default true. */
  header?: boolean;
  /** Group a multi-disc album under disc headings. */
  discs?: boolean;
  /** Drag rows to reorder the playlist (web pointer only). */
  reorder?: boolean;
}

export function TrackList({ tracks: given, options: givenOptions = {} }: { tracks: Card[]; options?: TrackListOptions }) {
  // A dragged playlist row moves at once; the list read again from the server replaces it.
  const [moved, setMoved] = useState<{ from: Card[]; tracks: Card[]; entryIds: string[] } | null>(null);
  const local = moved && moved.from === given ? moved : null;
  const tracks = local?.tracks ?? given;
  const options = local && givenOptions.playlist ? { ...givenOptions, playlist: { ...givenOptions.playlist, entryIds: local.entryIds } } : givenOptions;
  const m = useMediaLook();
  const store = useVela();
  const wide = m.width >= 1100;
  const header = usePart('trackTable.header');
  const headText = usePart('trackTable.header').text;
  const discPart = usePart('trackTable.disc');
  // Long lists: the first rows with the page, the rest over the following frames.
  const [drawn, setDrawn] = useState(() => nextRowCount(0, tracks.length));
  useEffect(() => {
    if (drawn >= tracks.length) return;
    const frame = requestAnimationFrame(() => setDrawn(n => nextRowCount(n, tracks.length)));
    return () => cancelAnimationFrame(frame);
  }, [drawn, tracks.length]);
  const shown = drawn >= tracks.length ? tracks : tracks.slice(0, drawn);
  const groups = options.discs ? discGroups(shown) : [{ disc: 0, indices: shown.map((_, i) => i) }];
  const playlist = options.playlist;
  const reorder = web && !musicTV() && !!options.reorder && !!playlist && playlist.entryIds.length === tracks.length;
  const [dragging, setDragging] = useState(-1);
  const [over, setOver] = useState(-1);
  const drop = (to: number) => {
    const move = playlist && dragging >= 0 ? playlistMove(playlist.entryIds, dragging, to) : undefined;
    setDragging(-1); setOver(-1);
    if (!move || !playlist) return;
    setMoved({ from: given, tracks: moveItem(tracks, dragging, to), entryIds: moveItem(playlist.entryIds, dragging, to) });
    void store.playlists.moveEntry(playlist.id, move.entryId, move.afterEntryId);
  };
  const drag = reorder ? { dragging, over, start: setDragging, enter: setOver, drop, end: () => { setDragging(-1); setOver(-1); } } : undefined;
  return (
    <View testID="music-tracklist" accessibilityRole="list">
      {m.small || options.header === false ? null : <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, height: 36, marginBottom: 8 }, m.box({ 'border-bottom': '1px solid $ui.glassEdge' }), header.box]}>
        <Text style={[head(m), { width: 28, textAlign: 'center' }, headText]}>#</Text>
        <Text style={[head(m), { flex: 1 }, headText]}>{msg('music.title')}</Text>
        {options.album && wide && !musicTV() ? <Text style={[head(m), { flex: 0.8 }, headText]}>{msg('media.ui.album')}</Text> : null}
        <View style={{ width: 32 }} />
        <View style={{ width: 52, alignItems: 'flex-end' }}><Glyph symbol="clock" size={16} color={m.ui.inkQuiet} /></View>
        <View style={{ width: 32 }} />
      </View>}
      <FocusScope.Provider value={`tracks:${options.source?.id ?? ''}`}><FocusGroup>{groups.map(group => [
        group.disc ? <View key={`disc-${group.disc}`} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 44, marginTop: 8 }, discPart.box]} accessibilityRole="header">
          <Glyph symbol="album" size={16} color={m.ui.inkQuiet} />
          <Text style={[m.text({ 'font-size': '14px', 'font-weight': '650', color: '$ui.inkSecondary' }), discPart.text]}>{msg('media.ui.disc', { disc: number(group.disc) })}</Text>
        </View> : null,
        ...group.indices.map(i => <TrackRow key={`${tracks[i]!.id}-${i}`} track={tracks[i]!} index={i} tracks={tracks} options={options} wide={wide} disc={group.disc} drag={drag} />),
      ])}</FocusGroup></FocusScope.Provider>
    </View>
  );
}

interface RowDrag { dragging: number; over: number; start(index: number): void; enter(index: number): void; drop(index: number): void; end(): void }

/** Web pointer reordering: the row's own element is draggable (HTML drag and drop), so the row's
 * layout is unchanged; a line marks where it lands. */
function useRowDrag(drag: RowDrag | undefined, index: number) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const live = useRef(drag);
  live.current = drag;
  const on = !!drag;
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!on || !node?.addEventListener) return;
    node.setAttribute('draggable', 'true');
    const start = (e: DragEvent) => { e.dataTransfer?.setData('text/plain', String(index)); live.current?.start(index); };
    const over = (e: DragEvent) => { e.preventDefault(); if (live.current && live.current.over !== index) live.current.enter(index); };
    const dropped = (e: DragEvent) => { e.preventDefault(); live.current?.drop(index); };
    const end = () => live.current?.end();
    node.addEventListener('dragstart', start);
    node.addEventListener('dragover', over);
    node.addEventListener('drop', dropped);
    node.addEventListener('dragend', end);
    return () => {
      node.removeAttribute('draggable');
      node.removeEventListener('dragstart', start);
      node.removeEventListener('dragover', over);
      node.removeEventListener('drop', dropped);
      node.removeEventListener('dragend', end);
    };
  }, [on, index]);
  return ref;
}

function head(m: ReturnType<typeof useMediaLook>) {
  return m.text({ 'font-size': '12px', 'font-weight': '650', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' });
}

function TrackRow({ track, index, tracks, options, wide, disc, drag }: { track: Card; index: number; tracks: Card[]; options: TrackListOptions; wide: boolean; disc: number; drag?: RowDrag }) {
  const app = useMusic();
  const look = useListenLook();
  const templated = useHasTemplate('trackTable.row');
  const dragRef = useRowDrag(drag, index);
  const store = useVela();
  const m = useMediaLook();
  const nowId = useVelaState(s => currentInQueue(s.audio.queue)?.id);
  const phase = useVelaState(s => s.audio.phase);
  const duplicatesAvailable = store.music.duplicatesAvailable;
  const current = nowId === track.id;
  const playing = current && (phase === 'playing' || phase === 'buffering' || phase === 'loading');
  const more = useRef<ComponentRef<typeof View>>(null);
  const entry = options.playlist?.entryIds[index] ? { playlistId: options.playlist.id, entryId: options.playlist.entryIds[index]! } : undefined;
  const airDate = track.airDate || options.albumAirDate;
  const unreleased = isUnreleased(airDate);
  const release = airDate === options.albumAirDate ? '' : releaseLabel(airDate);
  const menuCard = airDate && airDate !== track.airDate ? { ...track, airDate } : track;
  const play = () => {
    const audio = tracks.filter(t => t.media?.audio && !isUnreleased(t.airDate || options.albumAirDate));
    const at = audio.indexOf(track);
    if (at >= 0) app.play(audio, at, options.source, false, undefined, true);
  };
  const openMenu: MenuOpen = (anchor, mode, opener) => app.menu({ card: menuCard, anchor, mode, opener, entry });
  const openFromMore = () => more.current?.measureInWindow((x: number, y: number, width: number, height: number) =>
    app.menu({ card: menuCard, anchor: { kind: 'card', rect: { left: x, top: y, right: x + width, bottom: y + height } }, mode: 'pointer', entry }));
  const album = track.media?.parents.find(p => p.role === 'album');
  const artist = track.media?.byline;
  const recordingId = track.media?.recordingId;
  const numberLabel = options.position || !track.media?.index ? number(index + 1) : number(track.media.index);
  const liked = app.liked(track.id);
  // A touch layout plays on a tap and keeps ⋯ in reach; a pointer plays on a double click. On a TV
  // the row is one focus target: select plays, a long select opens its menu, nothing inside it
  // takes focus.
  const tv = musicTV();
  const touch = !tv && (!web || m.width < 980);
  const rowStyle = usePartStyler(['trackTable.row', current && 'trackTable.activeRow']);
  const rowText = usePart(['trackTable.row', current && 'trackTable.activeRow']).text;
  const numberPart = usePart('trackTable.number').text;
  const titlePart = usePart('trackTable.title').text;
  const artistPart = usePart('trackTable.artist').text;
  const albumPart = usePart('trackTable.album').text;
  const durationPart = usePart('trackTable.duration').text;
  const marker = drag && drag.dragging >= 0 && drag.over === index && drag.dragging !== index ? (drag.dragging < index ? 'bottom' : 'top') : '';
  const row = (
    <Surface onPress={!unreleased && (touch || tv) ? play : undefined} onDoubleClick={!unreleased && !touch && !tv ? play : undefined} onMenu={openMenu} focusId={track.id} testID={`music-track-${track.id}`} selected={current}
      label={[track.name, artist, release || (unreleased ? msg('release.notOutYet') : track.media?.clockLabel)].filter(Boolean).join(', ')}
      style={(lit, focus) => [{ height: tv ? 72 : release || options.covers ? 60 : 52, borderRadius: tv ? 12 : 8, backgroundColor: lit ? m.ui.control : current ? alpha(m.ui.accent, 0.1) : 'transparent',
        transform: [{ scale: tv && focus ? 1.02 : 1 }] },
        focus ? (tv ? { borderWidth: 2, borderColor: m.ui.ink } : m.box({ 'box-shadow': `inset 0px 0px 0px 1.5px ${m.ui.ink}` })) : tv ? { borderWidth: 2, borderColor: 'transparent' } : {}, transition('background-color, transform', 120),
        rowStyle?.({ hover: lit, focus }), drag?.dragging === index ? { opacity: 0.5 } : null]}
      contentStyle={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: touch ? 12 : 16, paddingHorizontal: touch ? 8 : 16 }}>
      {lit => templated && !unreleased ? look.template!('trackTable.row', track, { index, number: numberLabel, active: current, playing, disc, lit }, index) : (
        <>
          <View style={{ width: 28, alignItems: 'center' }} pointerEvents="box-none">
            {lit && !tv && !unreleased ? (
              <Pressable onPress={() => (current ? app.toggle() : play())} accessibilityRole="button" accessibilityLabel={playing ? msg('media.player.pause') : `${msg('media.ui.play')} ${track.name}`} style={NO_RING}>
                <MediaGlyph name={playing ? 'pause' : 'play'} size={16} color={m.ui.ink} />
              </Pressable>
            ) : playing && !unreleased ? <Meter /> : (
              <Text style={[m.text({ 'font-size': '15px', color: current ? m.ui.accent : '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), numberPart]}>{numberLabel}</Text>
            )}
          </View>
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {options.covers ? <Cover uri={track.poster} shape="square" size={42} title={track.name} accent={track.accent} lift={0.3} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[m.text({ 'font-size': tv ? '20px' : '15px', 'font-weight': '550', color: current ? m.ui.accent : '$ui.ink' }), titlePart, rowText, unreleased && m.text({ color: '$ui.inkQuiet' })]}>{track.name}</Text>
              {release ? <Text style={m.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>{release}</Text> : null}
              {artist || (duplicatesAvailable && recordingId && !m.small) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {track.media?.facts.some(f => f.label === 'Explicit' && f.value !== 'false') ? <Explicit /> : null}
                  {artist ? <Text numberOfLines={1} style={[m.text({ 'font-size': '13px', color: lit ? '$ui.inkSecondary' : '$ui.inkQuiet' }), artistPart]}>{artist}</Text> : null}
                  {duplicatesAvailable && recordingId && lit && !m.small ? (
                    <Text numberOfLines={1} style={m.text({ 'font-size': '11px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>· {recordingId}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
          {options.album && wide && !tv ? (
            <View style={{ flex: 0.8, minWidth: 0 }} pointerEvents="box-none">
              <Pressable onPress={() => album && app.go({ kind: 'title', id: album.id })} accessibilityRole="link" style={[NO_RING, { alignSelf: 'flex-start', maxWidth: '100%' }]}>
                <Text numberOfLines={1} style={[m.text({ 'font-size': '14px', color: lit ? '$ui.inkSecondary' : '$ui.inkQuiet' }), albumPart]}>{album?.name ?? ''}</Text>
              </Pressable>
            </View>
          ) : null}
          {(m.small || tv) && !liked ? null : tv ? <View style={{ width: 32, alignItems: 'center' }} pointerEvents="none"><Glyph symbol="heart-fill" size={20} color={m.ui.accent} /></View> : <View style={{ width: 32, alignItems: 'center', opacity: lit || liked ? 1 : 0 }} pointerEvents={lit || liked ? 'box-none' : 'none'}><Heart card={track} size={32} iconSize={17} /></View>}
          <View pointerEvents="none" style={{ width: m.small ? 40 : 52, alignItems: 'flex-end' }}>
            <Text style={[m.text({ 'font-size': '14px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), durationPart]}>{track.media?.clockLabel || (track.durationSeconds ? clock(track.durationSeconds) : '')}</Text>
          </View>
          {tv ? null : <View ref={more} style={{ width: 32, alignItems: 'center', opacity: lit || touch ? 1 : 0 }} pointerEvents={lit || touch ? 'box-none' : 'none'}>
            <IconButton symbol="more" label={msg('cardMenu.actionsFor', { title: track.name })} onPress={openFromMore} size={32} iconSize={18} testID={`music-track-more-${track.id}`} />
          </View>}
        </>
      )}
    </Surface>
  );
  // Only a drag wraps the row: the music app as drawn today keeps its tree.
  if (!drag) return row;
  return (
    <View ref={dragRef}>
      {row}
      {marker ? <View pointerEvents="none" style={{ position: 'absolute', left: 8, right: 8, height: 2, borderRadius: 1, backgroundColor: m.ui.accent, [marker]: -1 }} /> : null}
    </View>
  );
}

function Explicit() {
  const m = useMediaLook();
  return (
    <View style={{ width: 16, height: 16, borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: m.ui.inkQuiet }} accessibilityLabel={msg('music.explicit')}>
      <Text style={m.text({ 'font-size': '10px', 'font-weight': '800', color: m.ui.page })}>E</Text>
    </View>
  );
}

/** Three bars that rise and fall while a track plays (still under reduced motion). */
export function Meter({ color }: { color?: string }) {
  const m = useMediaLook();
  const ink = color ?? m.ui.accent;
  const bar = (delay: number): ViewStyle => (web && !m.look.still
    ? ({ animationName: [{ '0%': { height: 4 }, '50%': { height: 14 }, '100%': { height: 4 } }], animationDuration: '900ms', animationIterationCount: 'infinite', animationDelay: `${delay}ms`, animationTimingFunction: 'ease-in-out' } as unknown as ViewStyle)
    : { height: 10 });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 }} accessibilityLabel={msg('media.player.nowPlaying')}>
      {[0, 240, 480].map(d => <View key={d} style={[{ width: 3, borderRadius: 1.5, backgroundColor: ink, height: 8 }, bar(d)]} />)}
    </View>
  );
}
