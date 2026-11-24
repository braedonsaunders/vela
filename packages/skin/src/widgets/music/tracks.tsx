// A tracklist: number (a play control on hover, a live meter on the track playing), cover, title
// and artist, album, the heart, duration and the row's menu. Double-click or Enter plays from
// that track; right-click or long-press opens the menu at the pointer, ⋯ opens it beside the row.
import { useRef, type ComponentRef } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';
import { clock, msg, number, type Card } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { currentInQueue } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING, Glyph } from '../common/controls';
import { alpha, Cover, useMediaLook } from '../media/parts';
import { MediaGlyph } from '../media/icons';
import { useMusic } from './context';
import { FocusGroup, Heart, IconButton, Surface, transition, type MenuOpen } from './parts';
import { musicTV } from './layout';

const web = Platform.OS === 'web';

export interface TrackListOptions {
  /** Show each track's cover (a playlist, Liked Songs, Top Tracks). */
  covers?: boolean;
  /** Show the album column. */
  album?: boolean;
  /** Number by position instead of track number. */
  position?: boolean;
  /** Where these tracks are listed, for Now Playing's "Playing from". */
  source?: { id: string; name: string; kind?: 'title' | 'playlist' | 'favorites' };
  /** Playlist entries: entry ids for Remove from this playlist. */
  playlist?: { id: string; entryIds: string[] };
}

export function TrackList({ tracks, options = {} }: { tracks: Card[]; options?: TrackListOptions }) {
  const m = useMediaLook();
  const wide = m.width >= 1100;
  return (
    <View testID="music-tracklist" accessibilityRole="list">
      {m.small ? null : <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, height: 36, marginBottom: 8 }, m.box({ 'border-bottom': '1px solid $ui.glassEdge' })]}>
        <Text style={[head(m), { width: 28, textAlign: 'center' }]}>#</Text>
        <Text style={[head(m), { flex: 1 }]}>{msg('music.title')}</Text>
        {options.album && wide ? <Text style={[head(m), { flex: 0.8 }]}>{msg('media.ui.album')}</Text> : null}
        <View style={{ width: 32 }} />
        <View style={{ width: 52, alignItems: 'flex-end' }}><Glyph symbol="clock" size={16} color={m.ui.inkQuiet} /></View>
        <View style={{ width: 32 }} />
      </View>}
      <FocusGroup>{tracks.map((track, i) => <TrackRow key={`${track.id}-${i}`} track={track} index={i} tracks={tracks} options={options} wide={wide} />)}</FocusGroup>
    </View>
  );
}

function head(m: ReturnType<typeof useMediaLook>) {
  return m.text({ 'font-size': '12px', 'font-weight': '650', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' });
}

function TrackRow({ track, index, tracks, options, wide }: { track: Card; index: number; tracks: Card[]; options: TrackListOptions; wide: boolean }) {
  const app = useMusic();
  const m = useMediaLook();
  const nowId = useVelaState(s => currentInQueue(s.audio.queue)?.id);
  const phase = useVelaState(s => s.audio.phase);
  const current = nowId === track.id;
  const playing = current && (phase === 'playing' || phase === 'buffering' || phase === 'loading');
  const more = useRef<ComponentRef<typeof View>>(null);
  const entry = options.playlist?.entryIds[index] ? { playlistId: options.playlist.id, entryId: options.playlist.entryIds[index]! } : undefined;
  const audio = tracks.filter(t => t.media?.audio);
  const play = () => app.play(audio, audio.indexOf(track), options.source);
  const openMenu: MenuOpen = (anchor, mode, opener) => app.menu({ card: track, anchor, mode, opener, entry });
  const openFromMore = () => more.current?.measureInWindow((x: number, y: number, width: number, height: number) =>
    app.menu({ card: track, anchor: { kind: 'card', rect: { left: x, top: y, right: x + width, bottom: y + height } }, mode: 'pointer', entry }));
  const album = track.media?.parents.find(p => p.role === 'album');
  const artist = track.media?.byline;
  const numberLabel = options.position || !track.media?.index ? number(index + 1) : number(track.media.index);
  const liked = app.liked(track.id);
  // A touch layout plays on a tap and keeps ⋯ in reach; a pointer plays on a double click. On a TV
  // the row is one focus target: select plays, a long select opens its menu, nothing inside it
  // takes focus.
  const tv = musicTV();
  const touch = !tv && (!web || m.width < 980);
  return (
    <Surface onPress={touch || tv ? play : undefined} onDoubleClick={touch || tv ? undefined : play} onMenu={openMenu} focusId={track.id} testID={`music-track-${track.id}`} selected={current}
      label={[track.name, artist, track.media?.clockLabel].filter(Boolean).join(', ')}
      style={(lit, focus) => [{ height: tv ? 72 : options.covers ? 60 : 52, borderRadius: tv ? 12 : 8, backgroundColor: lit ? m.ui.control : current ? alpha(m.ui.accent, 0.1) : 'transparent',
        transform: [{ scale: tv && focus ? 1.02 : 1 }] },
        focus ? (tv ? { borderWidth: 2, borderColor: m.ui.ink } : m.box({ 'box-shadow': `inset 0px 0px 0px 1.5px ${m.ui.ink}` })) : tv ? { borderWidth: 2, borderColor: 'transparent' } : {}, transition('background-color, transform', 120)]}
      contentStyle={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: touch ? 12 : 16, paddingHorizontal: touch ? 8 : 16 }}>
      {lit => (
        <>
          <View style={{ width: 28, alignItems: 'center' }} pointerEvents="box-none">
            {lit && !tv ? (
              <Pressable onPress={() => (current ? app.toggle() : play())} accessibilityRole="button" accessibilityLabel={playing ? msg('media.player.pause') : `${msg('media.ui.play')} ${track.name}`} style={NO_RING}>
                <MediaGlyph name={playing ? 'pause' : 'play'} size={16} color={m.ui.ink} />
              </Pressable>
            ) : playing ? <Meter /> : (
              <Text style={m.text({ 'font-size': '15px', color: current ? m.ui.accent : '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{numberLabel}</Text>
            )}
          </View>
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {options.covers ? <Cover uri={track.poster} shape="square" size={42} title={track.name} accent={track.accent} lift={0.3} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={m.text({ 'font-size': tv ? '20px' : '15px', 'font-weight': '550', color: current ? m.ui.accent : '$ui.ink' })}>{track.name}</Text>
              {artist ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {track.media?.facts.some(f => f.label === 'Explicit' && f.value !== 'false') ? <Explicit /> : null}
                  <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: lit ? '$ui.inkSecondary' : '$ui.inkQuiet' })}>{artist}</Text>
                </View>
              ) : null}
            </View>
          </View>
          {options.album && wide && !tv ? (
            <View style={{ flex: 0.8, minWidth: 0 }} pointerEvents="box-none">
              <Pressable onPress={() => album && app.go({ kind: 'title', id: album.id })} accessibilityRole="link" style={[NO_RING, { alignSelf: 'flex-start', maxWidth: '100%' }]}>
                <Text numberOfLines={1} style={m.text({ 'font-size': '14px', color: lit ? '$ui.inkSecondary' : '$ui.inkQuiet' })}>{album?.name ?? ''}</Text>
              </Pressable>
            </View>
          ) : null}
          {(m.small || tv) && !liked ? null : tv ? <View style={{ width: 32, alignItems: 'center' }} pointerEvents="none"><Glyph symbol="heart-fill" size={20} color={m.ui.accent} /></View> : <View style={{ width: 32, alignItems: 'center', opacity: lit || liked ? 1 : 0 }} pointerEvents={lit || liked ? 'box-none' : 'none'}><Heart card={track} size={32} iconSize={17} /></View>}
          <View pointerEvents="none" style={{ width: m.small ? 40 : 52, alignItems: 'flex-end' }}>
            <Text style={m.text({ 'font-size': '14px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{track.media?.clockLabel || (track.durationSeconds ? clock(track.durationSeconds) : '')}</Text>
          </View>
          {tv ? null : <View ref={more} style={{ width: 32, alignItems: 'center', opacity: lit || touch ? 1 : 0 }} pointerEvents={lit || touch ? 'box-none' : 'none'}>
            <IconButton symbol="more" label={msg('cardMenu.actionsFor', { title: track.name })} onPress={openFromMore} size={32} iconSize={18} testID={`music-track-more-${track.id}`} />
          </View>}
        </>
      )}
    </Surface>
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
