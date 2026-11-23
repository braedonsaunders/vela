// The now-playing bar along the bottom of the music app: what is playing (cover, title, artist,
// the heart), the transport and the seek bar, and on the right lyrics, the queue, volume and full
// screen. Space, arrows and the media keys work through the keyboard map (keys.ts).
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';
import { clock, currentInQueue, msg } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING } from '../common/controls';
import { Cover, useMediaLook } from '../media/parts';
import { MediaGlyph } from '../media/icons';
import { useMusic } from './context';
import { Heart, IconButton, transition } from './parts';
import { openNowPlaying } from './hub';

export const NOW_PLAYING_BAR_HEIGHT = 84;
const web = Platform.OS === 'web';

export function NowPlayingBar({ queueOpen, onQueue }: { queueOpen: boolean; onQueue(): void }) {
  const app = useMusic();
  const m = useMediaLook();
  const store = useVela();
  const audio = useVelaState(s => s.audio);
  const item = currentInQueue(audio.queue);
  const playing = audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading';
  const album = item?.media?.parents.find(p => p.role === 'album');
  const artist = item?.media?.parents.find(p => p.role === 'artist');
  const repeat = audio.queue?.repeat ?? 'off';
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }} testID="now-playing-bar" accessibilityRole="toolbar" accessibilityLabel={msg('media.player.nowPlaying')}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {item ? (
          <>
            <Pressable onPress={() => openNowPlaying()} accessibilityRole="button" accessibilityLabel={msg('media.player.open')} style={NO_RING}>
              <Cover uri={item.poster} shape="square" size={58} title={item.name} accent={item.accent} lift={0.5} />
            </Pressable>
            <View style={{ minWidth: 0, flexShrink: 1 }}>
              <Link label={item.name} strong onPress={() => album && app.go({ kind: 'title', id: album.id })} />
              <Link label={item.media?.byline ?? ''} onPress={() => artist && app.go({ kind: 'title', id: artist.id })} />
            </View>
            <Heart card={item} size={34} iconSize={18} />
          </>
        ) : null}
      </View>
      <View style={{ flex: 1.3, maxWidth: 720, alignItems: 'center', gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <IconButton symbol="shuffle" label={msg('media.player.shuffle')} onPress={() => store.audio.toggleShuffle()} active={!!audio.queue?.shuffle} size={34} iconSize={18} testID="bar-shuffle" />
          <Transport icon="previous" label={msg('media.player.previous')} onPress={() => store.audio.previous()} />
          <Pressable onPress={() => store.audio.toggle()} disabled={!item} accessibilityRole="button" accessibilityLabel={playing ? msg('media.player.pause') : msg('media.player.play')} testID="bar-toggle"
            style={[NO_RING, { width: 40, height: 40, borderRadius: 20, backgroundColor: m.ui.ink, alignItems: 'center', justifyContent: 'center', opacity: item ? 1 : 0.5 }]}>
            <MediaGlyph name={playing ? 'pause' : 'play'} size={18} color={m.ui.inkInverse} />
          </Pressable>
          <Transport icon="next" label={msg('media.player.next')} onPress={() => store.audio.next()} />
          <IconButton symbol={repeat === 'one' ? 'repeat-one' : 'repeat'} label={msg('media.player.repeat')} onPress={() => store.audio.cycleRepeat()} active={repeat !== 'off'} size={34} iconSize={18} testID="bar-repeat" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' }}>
          <Text style={[m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), { width: 40, textAlign: 'right' }]}>{clock(audio.positionSeconds)}</Text>
          <Slider value={audio.durationSeconds > 0 ? audio.positionSeconds / audio.durationSeconds : 0} onChange={f => store.audio.seek(f * audio.durationSeconds)} label={msg('media.player.seek')} testID="bar-seek" />
          <Text style={[m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), { width: 40 }]}>{clock(audio.durationSeconds)}</Text>
        </View>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
        <IconButton symbol="lyrics" label={msg('music.lyrics')} onPress={() => openNowPlaying('lyrics')} size={34} iconSize={18} testID="bar-lyrics" />
        <IconButton symbol="queue" label={msg('music.queue')} onPress={onQueue} active={queueOpen} size={34} iconSize={18} testID="bar-queue" />
        <IconButton symbol={audio.muted || audio.volume === 0 ? 'speaker-mute' : 'speaker'} label={msg('music.mute')} onPress={() => store.audio.toggleMute()} size={34} iconSize={18} testID="bar-mute" />
        <View style={{ width: 110 }}><Slider value={audio.muted ? 0 : audio.volume} onChange={v => store.audio.setVolume(v)} label={msg('music.volume')} testID="bar-volume" /></View>
        <IconButton symbol="expand" label={msg('media.player.open')} onPress={() => openNowPlaying()} size={34} iconSize={17} testID="bar-expand" />
      </View>
    </View>
  );
}

function Transport({ icon, label, onPress }: { icon: string; label: string; onPress(): void }) {
  const m = useMediaLook();
  const [hover, setHover] = useState(false);
  return (
    <Pressable onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} accessibilityRole="button" accessibilityLabel={label} style={[NO_RING, { padding: 6 }]}>
      <MediaGlyph name={icon} size={18} color={hover ? m.ui.ink : m.ui.inkSecondary} />
    </Pressable>
  );
}

function Link({ label, strong = false, onPress }: { label: string; strong?: boolean; onPress(): void }) {
  const m = useMediaLook();
  const [hover, setHover] = useState(false);
  return (
    <Pressable onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} accessibilityRole="link" style={NO_RING}>
      <Text numberOfLines={1} style={m.text({ 'font-size': strong ? '15px' : '13px', 'font-weight': strong ? '650' : '450', color: strong ? '$ui.ink' : '$ui.inkQuiet', 'text-decoration-line': hover ? 'underline' : 'none' })}>{label}</Text>
    </Pressable>
  );
}

/** A thin bar that thickens on hover; press or drag to set (0..1). Arrow keys step 5%. */
export function Slider({ value, onChange, label, testID }: { value: number; onChange(fraction: number): void; label: string; testID?: string }) {
  const m = useMediaLook();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const bounds = useRef({ x: 0, width: 1 });
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const shown = Math.min(1, Math.max(0, drag ?? value));
  const at = (pageX: number) => Math.min(1, Math.max(0, (pageX - bounds.current.x) / Math.max(1, bounds.current.width)));
  const measure = (then: () => void) => ref.current?.measureInWindow((x: number, _y: number, width: number) => { bounds.current = { x, width }; then(); });
  const lit = hover || drag !== null;
  useEffect(() => undefined, []);
  return (
    <View ref={ref} testID={testID} accessible focusable accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={e => { const x = e.nativeEvent.pageX; measure(() => setDrag(at(x))); }}
      onResponderMove={e => setDrag(at(e.nativeEvent.pageX))}
      onResponderRelease={e => { const to = at(e.nativeEvent.pageX); setDrag(null); onChange(to); }}
      onResponderTerminate={() => setDrag(null)}
      {...(web ? { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), onKeyDown: (e: { key: string; preventDefault(): void }) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.min(1, Math.max(0, value + (e.key === 'ArrowLeft' ? -0.05 : 0.05)))); }
      } } as object : {})}
      style={[NO_RING, { flex: 1, height: 16, justifyContent: 'center' }, web ? ({ cursor: 'pointer' } as ViewStyle) : {}]}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: m.ui.track, overflow: 'hidden' }}>
        <View style={[{ width: `${shown * 100}%`, height: '100%', backgroundColor: lit ? m.ui.accent : m.ui.ink }, transition('background-color', 120)]} />
      </View>
      <View pointerEvents="none" style={[{ position: 'absolute', left: `${shown * 100}%`, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: m.ui.ink, opacity: lit ? 1 : 0 } as ViewStyle, transition('opacity', 120)]} />
    </View>
  );
}
