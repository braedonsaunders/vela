// The audio player's faces (docs/media-kinds.md): a mini player that floats over every page
// while a queue is loaded, and Now Playing: the cover, a scrubber, transport, shuffle and repeat
// for music, speed, 15/30-second skips, chapters and a sleep timer for audiobooks, and the queue.
// Both take the active document's `ui` look.
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { AUDIO_RATES, chapterEnd, clock, currentInQueue, durationLabel, msg, number, upNext, type AudioState, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { useHost } from '../../host';
import { NO_RING, useInteraction } from '../common/controls';
import { useMediaActions } from './context';
import { MediaGlyph } from './icons';
import { alpha, Cover, ListRow, RoundButton, TextLink, useMediaLook } from './parts';
import { Arrive, MOTION, Presence, useLast } from '../../presence';

const web = Platform.OS === 'web';

function spoken(item: Card | undefined): boolean {
  const cls = item?.media?.class;
  return cls === 'audiobook' || cls === 'podcast';
}

function useAudio(): AudioState { return useVelaState(state => state.audio); }

/** The mini player's height, px: where Now Playing rises from. */
export const MINI_PLAYER_HEIGHT = 62;

/** The floating bar over every page while something is queued. While it leaves (the queue
 * stopped) it keeps showing what was playing. */
export function MiniPlayer({ onOpen, bottom }: { onOpen(): void; bottom: number }) {
  const m = useMediaLook();
  const store = useVela();
  const audio = useAudio();
  const item = useLast(currentInQueue(audio.queue));
  const open = useInteraction();
  if (!item) return null;
  const playing = audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading';
  const fraction = audio.durationSeconds > 0 ? Math.min(1, audio.positionSeconds / audio.durationSeconds) : 0;
  const book = spoken(item);
  const width = Math.min(m.width - m.gutter * 2 + 16, 820);
  const shell = m.look.layer({ 'background-color': '$ui.popover', 'backdrop-filter': 'blur(24px) saturate(1.3)', 'box-shadow': '0px 18px 48px -12px rgba(0, 0, 0, 0.6), 0px 0px 0px 1px $ui.glassEdge' });
  return (
    <View style={[shell.style, { position: 'absolute', bottom, left: (m.width - width) / 2, width, borderRadius: Math.min(22, Number(m.ui.radiusPanel) || 18), overflow: 'hidden' }]}
      testID="mini-player" accessibilityRole="toolbar" accessibilityLabel={msg('media.player.nowPlaying')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, paddingRight: 10 }}>
        <Pressable {...open.handlers} onPress={onOpen} testID="mini-player-open" accessibilityRole="button" accessibilityLabel={`${msg('media.player.open')}: ${item.name}`}
          style={[NO_RING, { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 4,
            backgroundColor: open.state.hover || open.state.focus ? m.ui.control : 'transparent' }]}>
          <Cover uri={item.poster} shape={item.shape === 'book' ? 'book' : 'square'} size={item.shape === 'book' ? 34 : 46} title={item.name} accent={item.accent} lift={0.4} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={m.text({ 'font-size': '15px', 'font-weight': '650' })}>{item.name}</Text>
            <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>
              {audio.phase === 'failed' ? msg('media.player.failed') : audio.unsupported ? msg('media.player.unsupported') : [item.media?.byline, item.media?.parent?.name].filter(Boolean).join(' — ')}
            </Text>
          </View>
        </Pressable>
        {book && !m.small ? <RoundButton icon="back15" label={msg('media.player.back15')} onPress={() => store.audio.skip(-15)} size={40} testID="mini-back15" /> : null}
        {!book && !m.small ? <RoundButton icon="previous" label={msg('media.player.previous')} onPress={() => store.audio.previous()} size={40} testID="mini-previous" iconSize={16} /> : null}
        <PlayButton playing={playing} size={46} onPress={() => store.audio.toggle()} testID="mini-toggle" />
        {book ? <RoundButton icon="forward30" label={msg('media.player.forward30')} onPress={() => store.audio.skip(30)} size={40} testID="mini-forward30" />
          : <RoundButton icon="next" label={msg('media.player.next')} onPress={() => store.audio.next()} size={40} testID="mini-next" iconSize={16} />}
        {!m.small ? <RoundButton icon="close" label={msg('media.player.stop')} onPress={() => void store.audio.stop()} size={36} testID="mini-stop" iconSize={14} /> : null}
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: m.ui.track }}>
        <View style={{ width: `${fraction * 100}%`, height: 3, backgroundColor: m.ui.accent }} />
      </View>
    </View>
  );
}

function PlayButton({ playing, size, onPress, testID, nativeID }: { playing: boolean; size: number; onPress(): void; testID?: string; nativeID?: string }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} nativeID={nativeID} accessibilityRole="button" accessibilityLabel={playing ? msg('media.player.pause') : msg('media.player.play')}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: lit ? m.ui.inkHover : m.ui.accent, transform: [{ scale: state.pressed ? 0.94 : lit ? 1.04 : 1 }] },
        state.focus ? m.box({ 'box-shadow': `0px 0px 0px 4px ${m.ui.focusHalo}` }) : {},
        web ? ({ transitionProperty: 'transform, background-color', transitionDuration: '160ms' } as ViewStyle) : {}]}>
      <MediaGlyph name={playing ? 'pause' : 'play'} size={Math.round(size * 0.42)} color={lit ? m.ui.inkInverse : m.ui.onAccent} />
    </Pressable>
  );
}

/** A seek bar: drag or press anywhere; arrow keys step ten seconds. */
function Scrubber({ position, duration, onSeek, chapters }: { position: number; duration: number; onSeek(seconds: number): void; chapters: AudioState['chapters'] }) {
  const m = useMediaLook();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const bounds = useRef({ x: 0, width: 1 });
  const [drag, setDrag] = useState<number | null>(null);
  const [focus, setFocus] = useState(false);
  const shown = drag ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const at = (pageX: number) => Math.min(1, Math.max(0, (pageX - bounds.current.x) / Math.max(1, bounds.current.width))) * duration;
  const measure = (then: () => void) => ref.current?.measureInWindow((x: number, _y: number, width: number) => { bounds.current = { x, width }; then(); });
  const keys = web ? { onKeyDown: (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); onSeek(position + (event.key === 'ArrowLeft' ? -10 : 10)); }
  } } : {};
  return (
    <View style={{ gap: 8 }}>
      <View ref={ref} testID="now-playing-scrubber" focusable accessible accessibilityRole="adjustable" accessibilityLabel={msg('media.player.seek')}
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown), text: `${clock(shown)} / ${clock(duration)}` }}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onAccessibilityAction={event => onSeek(position + (event.nativeEvent.actionName === 'increment' ? 10 : -10))}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderGrant={event => { const x = event.nativeEvent.pageX; measure(() => setDrag(at(x))); }}
        onResponderMove={event => setDrag(at(event.nativeEvent.pageX))}
        onResponderRelease={event => { const to = at(event.nativeEvent.pageX); setDrag(null); onSeek(to); }}
        onResponderTerminate={() => setDrag(null)}
        {...(keys as object)}
        style={[NO_RING, { height: 22, justifyContent: 'center', borderRadius: 6 }, web ? ({ cursor: 'pointer' } as ViewStyle) : {},
          focus ? m.box({ 'box-shadow': `0px 0px 0px 2px ${m.ui.focusHalo}` }) : {}]}>
        <View style={{ height: drag !== null || focus ? 6 : 4, borderRadius: 3, backgroundColor: m.ui.track, overflow: 'hidden' }}>
          <View style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: m.ui.ink }} />
        </View>
        {duration > 0 ? chapters.filter(c => c.startSeconds > 0 && c.startSeconds < duration).map(c => (
          <View key={c.id} pointerEvents="none" style={{ position: 'absolute', left: `${(c.startSeconds / duration) * 100}%`, top: 7, width: 2, height: 8, backgroundColor: alpha(m.ui.page, 0.8) } as ViewStyle} />
        )) : null}
        <View pointerEvents="none" style={{ position: 'absolute', left: `${fraction * 100}%`, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: m.ui.ink,
          opacity: drag !== null || focus ? 1 : 0.9, transform: [{ scale: drag !== null ? 1.25 : 1 }] } as ViewStyle} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{clock(shown)}</Text>
        <Text style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>-{clock(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  );
}

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress(): void; testID?: string }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="radio" accessibilityState={{ checked: selected }}
      {...(Platform.OS === 'web' ? { 'aria-checked': selected } : {})}
      style={[NO_RING, { paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center',
        backgroundColor: selected ? m.ui.ink : lit ? m.ui.controlHover : m.ui.control },
        state.focus ? m.box({ 'box-shadow': `0px 0px 0px 3px ${m.ui.focusHalo}` }) : {}]}>
      <Text style={m.text({ 'font-size': '13px', 'font-weight': '600', color: selected ? m.ui.inkInverse : m.ui.ink })}>{label}</Text>
    </Pressable>
  );
}

function rateLabel(rate: number): string { return `${number(rate, { maximumFractionDigits: 2, minimumFractionDigits: rate % 1 ? 1 : 1 })}×`; }

/** Now Playing: the whole-screen player. */
export function NowPlaying({ onClose }: { onClose(): void }) {
  const host = useHost();
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  const live = useAudio();
  // While it leaves (closed, or the queue stopped) it keeps showing what was playing.
  const queue = useLast(live.queue);
  const audio = { ...live, queue: live.queue ?? queue ?? null };
  const item = currentInQueue(audio.queue);
  const [panel, setPanel] = useState<'' | 'speed' | 'sleep'>('');
  const shownPanel = useLast(panel || undefined);
  const [list, setList] = useState<'queue' | 'chapters'>('queue');
  const book = spoken(item);
  useEffect(() => { setList(book && audio.chapters.length ? 'chapters' : 'queue'); }, [book, audio.chapters.length, item?.id]);
  // Space plays and pauses; Escape closes (web).
  useEffect(() => {
    if (!web || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      else if (event.key === ' ' && target?.getAttribute('role') !== 'button') { event.preventDefault(); store.audio.toggle(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, store]);
  if (!item || !audio.queue) return null;
  const playing = audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading';
  const sideBySide = m.width >= 900;
  const coverSize = sideBySide ? Math.min(480, m.height - 360, (m.width - m.gutter * 2) * 0.42) : Math.min(m.width - m.gutter * 2 - 24, m.height * 0.42, 420);
  const tint = item.accent || m.ui.accent;
  const parentId = item.media?.parent?.id;
  const chapterIndex = [...audio.chapters].reverse().find(c => c.startSeconds <= audio.positionSeconds);
  const chapterAt = chapterIndex ? audio.chapters.indexOf(chapterIndex) : -1;
  const sleeping = audio.sleep.mode !== 'off';
  const sleepLeft = audio.sleep.mode === 'timer' ? Math.max(0, (audio.sleep.endsAt - Date.now()) / 1000) : 0;
  const after = upNext(audio.queue);
  const controls = (
    <View style={{ gap: 22, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
      <View style={{ gap: 6 }}>
        <Text numberOfLines={2} accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '28px' : '36px', 'line-height': '1.08' })} testID="now-playing-title">{item.name}</Text>
        {item.media?.byline ? <TextLink label={item.media.byline} testID="now-playing-byline"
          onPress={item.media.bylineTarget ? () => { onClose(); const t = item.media!.bylineTarget; if (t.startsWith('title:')) actions.openTitle({ id: t.slice(6), kind: 'artist' }); else actions.openPerson(t.slice(7), item.media!.byline); } : undefined}
          style={m.text({ 'font-size': '17px', color: '$ui.inkSecondary' })} /> : null}
        {book && chapterIndex ? <Text style={m.text({ 'font-size': '14px', color: '$ui.inkQuiet' })}>{chapterIndex.name} · {msg('media.player.chapterOf', { index: number(chapterAt + 1), count: number(audio.chapters.length) })}</Text> : null}
      </View>
      <Scrubber position={audio.positionSeconds} duration={audio.durationSeconds} onSeek={s => store.audio.seek(s)} chapters={book ? audio.chapters : []} />
      {audio.phase === 'failed' || audio.unsupported ? <Text accessibilityRole="alert" style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>{audio.unsupported ? msg('media.player.unsupported') : msg('media.player.failed')}</Text> : null}
      <View style={{ zIndex: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {book
            ? <RoundButton icon="speed" label={`${msg('media.player.speed')}: ${rateLabel(audio.rate)}`} onPress={() => setPanel(panel === 'speed' ? '' : 'speed')} active={audio.rate !== 1 || panel === 'speed'} testID="now-playing-speed" />
            : <RoundButton icon="shuffle" label={msg('media.player.shuffle')} onPress={() => store.audio.toggleShuffle()} active={audio.queue.shuffle} testID="now-playing-shuffle" />}
          {book ? <RoundButton icon="back15" label={msg('media.player.back15')} onPress={() => store.audio.skip(-15)} size={54} testID="now-playing-back15" />
            : <RoundButton icon="previous" label={msg('media.player.previous')} onPress={() => store.audio.previous()} size={54} testID="now-playing-previous" iconSize={22} />}
          <PlayButton playing={playing} size={76} onPress={() => store.audio.toggle()} testID="now-playing-toggle" nativeID="now-playing-toggle" />
          {book ? <RoundButton icon="forward30" label={msg('media.player.forward30')} onPress={() => store.audio.skip(30)} size={54} testID="now-playing-forward30" />
            : <RoundButton icon="next" label={msg('media.player.next')} onPress={() => store.audio.next()} size={54} testID="now-playing-next" iconSize={22} />}
          {book
            ? <RoundButton icon="moon" label={msg('media.player.sleep')} onPress={() => setPanel(panel === 'sleep' ? '' : 'sleep')} active={sleeping || panel === 'sleep'} testID="now-playing-sleep" />
            : <RoundButton icon={audio.queue.repeat === 'one' ? 'repeatOne' : 'repeat'} label={audio.queue.repeat === 'one' ? msg('media.player.repeatOne') : msg('media.player.repeat')}
                onPress={() => store.audio.cycleRepeat()} active={audio.queue.repeat !== 'off'} testID="now-playing-repeat" />}
        </View>
        {/* Speed and sleep open as a popover under the transport, over what follows, so nothing below
            moves; it drops in and lifts away with the shared motion. */}
        <Presence shown={!!panel} still={m.look.still} offstage={{ y: -8, scale: 0.98 }} exitMs={MOTION.quick} pointerEvents="auto" testID="now-playing-panel"
          style={[{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 12, padding: 12, borderRadius: 18, backgroundColor: m.ui.popover, zIndex: 3 } as ViewStyle,
            m.box({ 'box-shadow': '0px 18px 48px -12px rgba(0, 0, 0, 0.6), 0px 0px 0px 1px $ui.glassEdge' })]}>
          {shownPanel === 'speed' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }} accessibilityRole="radiogroup" accessibilityLabel={msg('media.player.speed')}>
              {AUDIO_RATES.map(rate => <Chip key={rate} label={rateLabel(rate)} selected={audio.rate === rate} onPress={() => { store.audio.setRate(rate); setPanel(''); }} testID={`speed-${rate}`} />)}
            </View>
          ) : shownPanel === 'sleep' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }} accessibilityRole="radiogroup" accessibilityLabel={msg('media.player.sleep')}>
              <Chip label={msg('media.player.sleepOff')} selected={!sleeping} onPress={() => { store.audio.setSleep('off'); setPanel(''); }} testID="sleep-off" />
              {[15, 30, 45, 60].map(minutes => <Chip key={minutes} label={msg('media.player.sleepMinutes', { count: number(minutes) })} selected={false} onPress={() => { store.audio.setSleep('timer', minutes); setPanel(''); }} testID={`sleep-${minutes}`} />)}
              {audio.chapters.length ? <Chip label={msg('media.player.sleepChapter')} selected={audio.sleep.mode === 'chapter'} onPress={() => { store.audio.setSleep('chapter'); setPanel(''); }} testID="sleep-chapter" /> : null}
            </View>
          ) : null}
        </Presence>
      </View>
      {book && (audio.rate !== 1 || sleeping) ? (
        <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet', 'text-align': 'center' })}>
          {[audio.rate !== 1 ? rateLabel(audio.rate) : '', audio.sleep.mode === 'timer' ? msg('media.player.sleepIn', { time: durationLabel(sleepLeft) }) : audio.sleep.mode === 'chapter' ? msg('media.player.sleepChapter') : audio.sleep.mode === 'item' ? msg('media.player.sleepItem') : ''].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
  const listItems = list === 'chapters' ? (
    audio.chapters.map((c, i) => <ListRow key={c.id} number={number(i + 1)} title={c.name} trailing={clock(c.startSeconds)} current={chapterAt === i} playing={playing}
      dim={i < chapterAt} onPress={() => store.audio.seek(c.startSeconds)} testID={`now-playing-chapter-${i}`} />)
  ) : after.length ? after.map((card, i) => <ListRow key={`${card.id}-${i}`} number={number(i + 1)} title={card.name} subtitle={card.media?.byline}
      trailing={card.media?.clockLabel} onPress={() => store.audio.jump(audio.queue!.items.indexOf(card))} testID={`now-playing-next-${card.id}`} />)
    : [<Text key="none" style={m.text({ 'font-size': '14px', color: '$ui.inkQuiet', padding: '12px 14px' })}>{msg('media.player.nothingNext')}</Text>];
  const tabs = (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }} accessibilityRole="tablist">
      <Chip label={msg('media.player.upNext')} selected={list === 'queue'} onPress={() => setList('queue')} testID="now-playing-queue-tab" />
      {audio.chapters.length ? <Chip label={msg('media.player.chapters')} selected={list === 'chapters'} onPress={() => setList('chapters')} testID="now-playing-chapters-tab" /> : null}
    </View>
  );
  const top = Math.max(14, host.viewport.insets.top + 10);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: m.ui.page }} testID="now-playing" accessibilityViewIsModal accessibilityLabel={msg('media.player.nowPlaying')}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
        {item.poster ? <Image source={host.image(item.poster)} contentFit="cover" blurRadius={90} style={{ position: 'absolute', top: -120, left: -120, right: -120, bottom: -120, opacity: 0.5 } as never} /> : null}
        <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, m.box({ 'background-image': `linear-gradient(180deg, ${alpha(tint, 0.3)} 0%, ${alpha(m.ui.page, 0.7)} 60%, ${m.ui.page} 100%)` })]} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: top, paddingHorizontal: m.gutter - 6, gap: 12 }}>
        <RoundButton icon="down" label={msg('media.player.close')} onPress={onClose} testID="now-playing-close" nativeID="now-playing-close" size={42} />
        <Pressable disabled={!audio.queue.source} onPress={() => { const s = audio.queue?.source; if (s) { onClose(); actions.openTitle({ id: s.id, kind: parentId === s.id ? 'album' : (item.media?.class === 'audiobook' ? 'audiobook' : 'album') }); } }}
          accessibilityRole="link" style={[NO_RING, { flex: 1, alignItems: 'center' }]} testID="now-playing-source">
          <Text style={m.text({ 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '0.18em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{msg('media.player.nowPlaying')}</Text>
          {audio.queue.source ? <Text numberOfLines={1} style={m.text({ 'font-size': '13px', 'font-weight': '600', color: '$ui.inkSecondary' })}>{audio.queue.source.name}</Text> : null}
        </Pressable>
        <View style={{ width: 42 }} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: m.gutter, paddingTop: 18, paddingBottom: 48, minHeight: '100%' as never }}>
        {sideBySide ? (
          <View style={{ flexDirection: 'row', gap: 56, alignItems: 'flex-start', maxWidth: 1280, width: '100%', alignSelf: 'center' } as ViewStyle}>
            <View style={{ flex: 1, gap: 34, alignItems: 'center' }}>
              <Artwork item={item} size={coverSize} playing={playing} />
              {controls}
            </View>
            <View style={{ flex: 1, maxWidth: 520, paddingTop: 8 }}>{tabs}<Arrive key={list} still={m.look.still} style={{ gap: 2 }}>{listItems}</Arrive></View>
          </View>
        ) : (
          <View style={{ gap: 28, alignItems: 'center' }}>
            <Artwork item={item} size={coverSize} playing={playing} />
            {controls}
            <View style={{ width: '100%', maxWidth: 560 }}>{tabs}<Arrive key={list} still={m.look.still} style={{ gap: 2 }}>{listItems}</Arrive></View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Artwork({ item, size, playing }: { item: Card; size: number; playing: boolean }): ReactNode {
  const m = useMediaLook();
  const book = item.shape === 'book';
  const width = book ? Math.round(size / 1.5) : size;
  // The cover eases back a little while paused, as a record settles.
  return (
    <View style={[{ transform: [{ scale: playing || m.look.still ? 1 : 0.94 }] }, web ? ({ transitionProperty: 'transform', transitionDuration: '420ms', transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' } as ViewStyle) : {}]}>
      <Cover uri={item.poster} shape={book ? 'book' : 'square'} size={width} title={item.name} byline={item.media?.byline} accent={item.accent} lift={2.2} />
    </View>
  );
}
