// The now-playing bar along the bottom of the audio app: what is playing (cover, title, artist or
// chapter, the heart), the transport and the seek bar, and on the right lyrics, the queue, volume
// and full screen. Spoken word (an audiobook, a podcast episode) trades shuffle, previous, next and
// repeat for speed, 15/30 s skips and the sleep timer. Space, arrows and the media keys work
// through the keyboard map (keys.ts).
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';
import { AUDIO_RATES, clock, currentInQueue, durationLabel, msg, number } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING } from '../../widgets/common/controls';
import { Cover, useMediaLook } from '../../widgets/media/parts';
import { barVolumeSlider } from '../../widgets/media/window-layout';
import { MediaGlyph } from '../../widgets/media/icons';
import { placeOf, useMusic } from './app';
import { isSpoken, listeningWords } from './listening';
import { Heart, IconButton, menuHandlers, transition } from './parts';
import { openNowPlaying } from './hub';
import { Chip } from './parts';

export const NOW_PLAYING_BAR_HEIGHT = 84;
const web = Platform.OS === 'web';

/** Spoken word's speed and sleep choices, opened from the bar over the page above it. */
export type BarPanel = '' | 'speed' | 'sleep';

export function NowPlayingBar({ queueOpen, onQueue, soundOpen = false, onSound, panel, onPanel }: { queueOpen: boolean; onQueue(): void; soundOpen?: boolean; onSound?(): void; panel: BarPanel; onPanel(panel: BarPanel): void }) {
  const app = useMusic();
  const m = useMediaLook();
  const store = useVela();
  const audio = useVelaState(s => s.audio);
  const item = currentInQueue(audio.queue);
  const playing = audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading';
  const album = item?.media?.parents.find(p => p.role === 'album');
  const artist = item?.media?.parents.find(p => p.role === 'artist');
  const repeat = audio.queue?.repeat ?? 'off';
  // What plays decides the controls; with nothing playing, the library does.
  const spoken = item ? isSpoken(item.media?.class) : listeningWords(app.listening).transport === 'spoken';
  const chapter = spoken ? [...audio.chapters].reverse().find(c => c.startSeconds <= audio.positionSeconds) : undefined;
  const container = item?.media?.parent;
  const sleeping = audio.sleep.mode !== 'off';
  // What is playing has its card's menu too (Remove from Liked Songs, Go to album): a right-click
  // or a long press on its cover or its title.
  const menu = item ? menuHandlers(point => app.menu({ card: item, anchor: { kind: 'point', point }, mode: 'pointer' })) : {};
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }} testID="now-playing-bar" accessibilityRole="toolbar" accessibilityLabel={msg('media.player.nowPlaying')}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {item ? (
          <>
            <Pressable {...menu} onPress={() => openNowPlaying()} accessibilityRole="button" accessibilityLabel={msg('media.player.open')} style={NO_RING} testID="bar-cover">
              <Cover uri={item.poster} shape="square" size={58} title={item.name} accent={item.accent} lift={0.5} />
            </Pressable>
            <View style={{ minWidth: 0, flexShrink: 1 }}>
              {spoken ? <>
                {/* A book or episode opens its page; the line under it is the chapter, else the book or show it is from. */}
                <Link label={item.name} strong onPress={() => app.go(placeOf(item))} menu={menu} testID="bar-title" />
                <Link label={chapter?.name || container?.name || item.media?.byline || ''} onPress={() => app.go(placeOf(item))} testID="bar-subtitle" />
              </> : <>
                <Link label={item.name} strong onPress={() => album && app.go({ kind: 'title', id: album.id })} menu={menu} testID="bar-title" />
                <Link label={item.media?.byline ?? ''} onPress={() => artist && app.go({ kind: 'title', id: artist.id })} testID="bar-subtitle" />
              </>}
            </View>
            <Heart card={item} size={34} iconSize={18} />
          </>
        ) : null}
      </View>
      <View style={{ flex: 1.3, maxWidth: 720, alignItems: 'center', gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {spoken ? <>
            <RateButton rate={audio.rate} active={audio.rate !== 1 || panel === 'speed'} onPress={() => onPanel(panel === 'speed' ? '' : 'speed')} />
            <IconButton symbol="back15" label={msg('media.player.back15')} onPress={() => store.audio.skip(-15)} size={34} iconSize={20} testID="bar-back15" />
          </> : <>
            <IconButton symbol="shuffle" label={msg('media.player.shuffle')} onPress={() => store.audio.toggleShuffle()} active={!!audio.queue?.shuffle} size={34} iconSize={18} testID="bar-shuffle" />
            <Transport icon="previous" label={msg('media.player.previous')} onPress={() => store.audio.previous()} />
          </>}
          <Pressable onPress={() => store.audio.toggle()} disabled={!item} accessibilityRole="button" accessibilityLabel={playing ? msg('media.player.pause') : msg('media.player.play')} testID="bar-toggle"
            style={[NO_RING, { width: 40, height: 40, borderRadius: 20, backgroundColor: m.ui.ink, alignItems: 'center', justifyContent: 'center', opacity: item ? 1 : 0.5 }]}>
            <MediaGlyph name={playing ? 'pause' : 'play'} size={18} color={m.ui.inkInverse} />
          </Pressable>
          {spoken ? <>
            <IconButton symbol="forward30" label={msg('media.player.forward30')} onPress={() => store.audio.skip(30)} size={34} iconSize={20} testID="bar-forward30" />
            <IconButton symbol="moon" label={sleeping ? sleepLabel(audio.sleep) : msg('media.player.sleep')} onPress={() => onPanel(panel === 'sleep' ? '' : 'sleep')} active={sleeping || panel === 'sleep'} size={34} iconSize={18} testID="bar-sleep" />
          </> : <>
            <Transport icon="next" label={msg('media.player.next')} onPress={() => store.audio.next()} />
            <IconButton symbol={repeat === 'one' ? 'repeat-one' : 'repeat'} label={msg('media.player.repeat')} onPress={() => store.audio.cycleRepeat()} active={repeat !== 'off'} size={34} iconSize={18} testID="bar-repeat" />
          </>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' }}>
          <Text style={[m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), { width: 40, textAlign: 'right' }]}>{clock(audio.positionSeconds)}</Text>
          <Slider value={audio.durationSeconds > 0 ? audio.positionSeconds / audio.durationSeconds : 0} onChange={f => store.audio.seek(f * audio.durationSeconds)} label={msg('media.player.seek')} testID="bar-seek" />
          <Text style={[m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), { width: 40 }]}>{clock(audio.durationSeconds)}</Text>
        </View>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
        {spoken ? (audio.chapters.length ? <IconButton symbol="chapters" label={msg('media.player.chapters')} onPress={() => openNowPlaying()} size={34} iconSize={18} testID="bar-chapters" /> : null)
          : store.music.lyricsAvailable ? <IconButton symbol="lyrics" label={msg('music.lyrics')} onPress={() => openNowPlaying('lyrics')} size={34} iconSize={18} testID="bar-lyrics" /> : null}
        {onSound ? <IconButton symbol="sound" label={msg('music.sound')} onPress={onSound} active={soundOpen} size={34} iconSize={18} testID="bar-sound" /> : null}
        <IconButton symbol="queue" label={msg('music.queue')} onPress={onQueue} active={queueOpen} size={34} iconSize={18} testID="bar-queue" />
        <IconButton symbol={audio.muted || audio.volume === 0 ? 'speaker-mute' : 'speaker'} label={msg('music.mute')} onPress={() => store.audio.toggleMute()} size={34} iconSize={18} testID="bar-mute" />
        {barVolumeSlider(m.width) ? <View style={{ width: 110 }}><Slider value={audio.muted ? 0 : audio.volume} onChange={v => store.audio.setVolume(v)} label={msg('music.volume')} testID="bar-volume" /></View> : null}
        <IconButton symbol="expand" label={msg('media.player.open')} onPress={() => openNowPlaying()} size={34} iconSize={17} testID="bar-expand" />
      </View>
    </View>
  );
}

function rateLabel(rate: number): string { return `${number(rate, { minimumFractionDigits: rate % 1 ? 1 : 0, maximumFractionDigits: 2 })}×`; }

function sleepLabel(sleep: { mode: string; endsAt: number }): string {
  return sleep.mode === 'timer' ? msg('media.player.sleepIn', { time: durationLabel(Math.max(0, (sleep.endsAt - Date.now()) / 1000)) })
    : sleep.mode === 'chapter' ? msg('media.player.sleepChapter') : msg('media.player.sleep');
}

/** The speed, as its value ("1.25×"): a pill that opens the choices. */
function RateButton({ rate, active, onPress }: { rate: number; active: boolean; onPress(): void }) {
  const m = useMediaLook();
  const [hover, setHover] = useState(false);
  return (
    <Pressable onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} accessibilityRole="button" accessibilityLabel={`${msg('media.player.speed')}: ${rateLabel(rate)}`} testID="bar-speed"
      style={[NO_RING, { minWidth: 44, height: 26, paddingHorizontal: 8, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: hover ? m.ui.control : 'transparent', borderWidth: 1, borderColor: active ? m.ui.accent : m.ui.glassEdge }]}>
      <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', color: active ? m.ui.accent : hover ? '$ui.ink' : '$ui.inkSecondary', 'font-variant-numeric': 'tabular-nums' })}>{rateLabel(rate)}</Text>
    </Pressable>
  );
}

/** Speed or sleep choices, floating above the bar's transport. Chosen, it closes. */
export function BarPanelView({ panel, onClose }: { panel: BarPanel; onClose(): void }) {
  const m = useMediaLook();
  const store = useVela();
  const audio = useVelaState(s => s.audio);
  if (!panel) return null;
  const sleeping = audio.sleep.mode !== 'off';
  const pick = (then: () => void) => () => { then(); onClose(); };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: NOW_PLAYING_BAR_HEIGHT + 10, alignItems: 'center' }}>
      <View testID={`bar-panel-${panel}`} accessibilityRole="radiogroup" accessibilityLabel={panel === 'speed' ? msg('media.player.speed') : msg('media.player.sleep')}
        style={[{ maxWidth: 560, padding: 14, borderRadius: 16, gap: 10 }, m.box({ 'background-color': '$ui.popover', border: '1px solid $ui.glassEdge', 'box-shadow': '0px 18px 48px -12px rgba(0,0,0,0.6)' })]}>
        <Text style={m.text({ 'font-size': '13px', 'font-weight': '700', color: '$ui.inkSecondary' })}>{panel === 'speed' ? msg('media.player.speed') : msg('media.player.sleep')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {panel === 'speed'
            ? AUDIO_RATES.map(rate => <Chip key={rate} label={rateLabel(rate)} on={audio.rate === rate} onPress={pick(() => store.audio.setRate(rate))} />)
            : <>
              <Chip label={msg('media.player.sleepOff')} on={!sleeping} onPress={pick(() => store.audio.setSleep('off'))} />
              {[15, 30, 45, 60].map(minutes => <Chip key={minutes} label={msg('media.player.sleepMinutes', { count: number(minutes) })} on={false} onPress={pick(() => store.audio.setSleep('timer', minutes))} />)}
              {audio.chapters.length ? <Chip label={msg('media.player.sleepChapter')} on={audio.sleep.mode === 'chapter'} onPress={pick(() => store.audio.setSleep('chapter'))} /> : null}
            </>}
        </View>
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

function Link({ label, strong = false, onPress, menu, testID }: { label: string; strong?: boolean; onPress(): void; menu?: object; testID?: string }) {
  const m = useMediaLook();
  const [hover, setHover] = useState(false);
  return (
    <Pressable {...menu} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} accessibilityRole="link" style={NO_RING} testID={testID}>
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
  const pressed = useRef(false);
  const [hover, setHover] = useState(false);
  const shown = Math.min(1, Math.max(0, drag ?? value));
  const at = (pageX: number) => Math.min(1, Math.max(0, (pageX - bounds.current.x) / Math.max(1, bounds.current.width)));
  const measure = (then: () => void) => ref.current?.measureInWindow((x: number, _y: number, width: number) => { bounds.current = { x, width }; then(); });
  const lit = hover || drag !== null;
  useEffect(() => undefined, []);
  return (
    <View ref={ref} testID={testID} accessible focusable accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      // The measure answers later: a quick click has already been released by then. It must not leave
      // a drag behind (the thumb stuck where it was clicked, whatever plays), and it seeks by the
      // measured bounds, not ones from before the first measure.
      onResponderGrant={e => { const x = e.nativeEvent.pageX; pressed.current = true; measure(() => { if (pressed.current) setDrag(at(x)); }); }}
      onResponderMove={e => { if (pressed.current) setDrag(at(e.nativeEvent.pageX)); }}
      onResponderRelease={e => { const x = e.nativeEvent.pageX; pressed.current = false; setDrag(null); measure(() => onChange(at(x))); }}
      onResponderTerminate={() => { pressed.current = false; setDrag(null); }}
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
