// The audio player's faces (docs/media-kinds.md): a mini player that floats over every page
// while a queue is loaded, and Now Playing: the cover, a scrubber, transport, shuffle and repeat
// for music, speed, 15/30-second skips, chapters and a sleep timer for audiobooks, and the queue.
// Both take the active document's `ui` look.
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { findNodeHandle, Platform, ScrollView, Text, TVFocusGuideView, View, type ViewStyle } from 'react-native';
import { AUDIO_RATES, chapterEnd, clock, currentInQueue, durationLabel, msg, number, upNext, type AudioState, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { focusElement, focusTarget } from '../../escape';
import { useHost } from '../../host';
import { NO_RING, useInteraction } from '../common/controls';
import { useMediaActions } from './context';
import { MediaGlyph } from './icons';
import { alpha, Cover, ListRow, RoundButton, TextLink, useMediaLook } from './parts';
import { Arrive, MOTION, Presence, useLast } from '../../presence';
import { LyricsPanel } from '../../blocks/listen/lyrics';
import { SoundBlock, SoundSection } from '../../blocks/sound';
import { musicTV } from '../../blocks/listen/layout';
import { nowPlayingSideBySide } from './window-layout';
import { listForItem, toggleSound, type NowPlayingList } from './now-playing-list';
import { NOW_PLAYING_PLAY, nowPlayingFirstFocus } from './now-playing-focus';
import { usePart } from '../../blocks/listen/look';

const web = Platform.OS === 'web';
/** A TV's focus engine moves by geometry: Now Playing's column and transport row are focus guides, so
 * the remote reaches them from the queue beside them and from the scrubber above. */
const Guide = Platform.isTV ? TVFocusGuideView : View;
const guided = Platform.isTV ? { autoFocus: true } : {};
/** Now Playing's page starts this far under its header. */
const PAGE_TOP = 18;

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
  const [preview, setPreview] = useState<number | null>(null);
  const seek = useCallback((seconds: number) => store.audio.seek(seconds), [store]);
  // A document's parts (the `player` block); none in the dock's own mini player.
  const rootPart = usePart('player.root').box;
  const titlePart = usePart('player.title').text;
  const bylinePart = usePart('player.byline').text;
  if (!item) return null;
  const playing = audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading';
  const fraction = audio.durationSeconds > 0 ? Math.min(1, audio.positionSeconds / audio.durationSeconds) : 0;
  const book = spoken(item);
  const width = Math.min(m.width - m.gutter * 2 + 16, 820);
  const shell = m.look.layer({ 'background-color': '$ui.popover', 'backdrop-filter': 'blur(24px) saturate(1.3)', 'box-shadow': '0px 18px 48px -12px rgba(0, 0, 0, 0.6), 0px 0px 0px 1px $ui.glassEdge' });
  return (
    <View style={[shell.style, { position: 'absolute', bottom, left: (m.width - width) / 2, width, borderRadius: Math.min(22, Number(m.ui.radiusPanel) || 18), overflow: 'hidden' }, rootPart]}
      testID="mini-player" accessibilityRole="toolbar" accessibilityLabel={msg('media.player.nowPlaying')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, paddingRight: 10 }}>
        <Pressable {...open.handlers} onPress={onOpen} testID="mini-player-open" accessibilityRole="button" accessibilityLabel={`${msg('media.player.open')}: ${item.name}`}
          style={[NO_RING, { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 4,
            backgroundColor: open.state.hover || open.state.focus ? m.ui.control : 'transparent' }]}>
          <Cover uri={item.poster} shape={item.shape === 'book' ? 'book' : 'square'} size={item.shape === 'book' ? 34 : 46} title={item.name} accent={item.accent} lift={0.4} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[m.text({ 'font-size': '15px', 'font-weight': '650' }), titlePart]}>{item.name}</Text>
            <Text numberOfLines={1} style={[m.text({ 'font-size': '13px', color: '$ui.inkSecondary' }), bylinePart]}>
              {preview !== null ? `${clock(preview)} / ${clock(audio.durationSeconds)}` : audio.phase === 'failed' ? (audio.unreleased ? audio.error : msg('media.player.failed')) : audio.unsupported ? msg('media.player.unsupported') : [item.media?.byline, item.media?.parent?.name].filter(Boolean).join(' — ')}
            </Text>
          </View>
        </Pressable>
        {book && !m.small ? <RoundButton icon="back15" label={msg('media.player.back15')} onPress={() => store.audio.skip(-15)} size={40} testID="mini-back15" /> : null}
        {!book && !m.small ? <RoundButton icon="previous" label={msg('media.player.previous')} onPress={() => store.audio.previous()} size={40} testID="mini-previous" iconSize={16} /> : null}
        {audio.unreleased ? null : <PlayButton playing={playing} size={46} onPress={() => store.audio.toggle()} testID="mini-toggle" />}
        {book ? <RoundButton icon="forward30" label={msg('media.player.forward30')} onPress={() => store.audio.skip(30)} size={40} testID="mini-forward30" />
          : <RoundButton icon="next" label={msg('media.player.next')} onPress={() => store.audio.next()} size={40} testID="mini-next" iconSize={16} />}
        {!m.small ? <RoundButton icon="close" label={msg('media.player.stop')} onPress={() => void store.audio.stop()} size={36} testID="mini-stop" iconSize={14} /> : null}
      </View>
      {Platform.isTV ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: m.ui.track }}>
          <View style={{ width: `${fraction * 100}%`, height: 3, backgroundColor: m.ui.accent }} />
        </View>
      ) : <MiniScrubber position={audio.positionSeconds} duration={audio.durationSeconds} onSeek={seek} onPreview={setPreview} />}
    </View>
  );
}

/** The mini player's bottom edge is its seek bar: hovering or dragging thickens it and the byline shows
 * the time under the pointer; press or drag anywhere along it to seek. */
function MiniScrubber({ position, duration, onSeek, onPreview }: { position: number; duration: number; onSeek(seconds: number): void; onPreview(seconds: number | null): void }) {
  const m = useMediaLook();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const bounds = useRef({ x: 0, width: 1 });
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const live = duration > 0;
  const shown = drag ?? position;
  const fraction = live ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const at = (pageX: number) => Math.min(1, Math.max(0, (pageX - bounds.current.x) / Math.max(1, bounds.current.width))) * duration;
  const measure = (then: () => void) => ref.current?.measureInWindow((x: number, _y: number, width: number) => { bounds.current = { x, width }; then(); });
  const active = drag !== null || hover !== null;
  const preview = drag ?? hover;
  useEffect(() => { onPreview(preview); }, [preview, onPreview]);
  const pointer = web ? {
    onMouseEnter: (event: { nativeEvent: { pageX: number } }) => { const x = event.nativeEvent.pageX; measure(() => setHover(at(x))); },
    onMouseMove: (event: { nativeEvent: { pageX: number } }) => setHover(at(event.nativeEvent.pageX)),
    onMouseLeave: () => setHover(null),
  } : {};
  if (!live) return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: m.ui.track }} />
  );
  return (
    <View ref={ref} testID="mini-player-scrubber" accessible accessibilityRole="adjustable" accessibilityLabel={msg('media.player.seek')}
      accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown), text: `${clock(shown)} / ${clock(duration)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => onSeek(position + (event.nativeEvent.actionName === 'increment' ? 10 : -10))}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={event => { const x = event.nativeEvent.pageX; measure(() => setDrag(at(x))); }}
      onResponderMove={event => setDrag(at(event.nativeEvent.pageX))}
      onResponderRelease={event => { const to = at(event.nativeEvent.pageX); setDrag(null); onSeek(to); }}
      onResponderTerminate={() => setDrag(null)}
      {...(pointer as object)}
      style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, justifyContent: 'flex-end' }, web ? ({ cursor: 'pointer' } as ViewStyle) : {}]}>
      <View style={{ height: active ? 6 : 3, backgroundColor: m.ui.track }}>
        <View style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: m.ui.accent }} />
      </View>
    </View>
  );
}

function PlayButton({ playing, size, onPress, testID, nativeID, preferred, focusRef, onLayout, onFocus }: {
  playing: boolean; size: number; onPress(): void; testID?: string; nativeID?: string; preferred?: boolean;
  focusRef?: Ref<ComponentRef<typeof Pressable>>; onLayout?(): void; onFocus?(): void;
}) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} ref={focusRef} onPress={onPress} onLayout={onLayout}
      onFocus={() => { handlers.onFocus(); onFocus?.(); }} testID={testID} nativeID={nativeID}
      {...(preferred ? { hasTVPreferredFocus: true } : {})} accessibilityRole="button" accessibilityLabel={playing ? msg('media.player.pause') : msg('media.player.play')}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: lit ? m.ui.inkHover : m.ui.accent, transform: [{ scale: state.pressed ? 0.94 : lit ? 1.04 : 1 }] },
        state.focus ? m.box({ 'box-shadow': `0px 0px 0px 4px ${m.ui.focusHalo}` }) : {},
        Platform.isTV ? { borderWidth: 4, borderColor: state.focus ? m.ui.ink : 'transparent' } : {},
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
          focus ? m.box({ 'box-shadow': `0px 0px 0px 2px ${m.ui.focusHalo}` }) : {},
          Platform.isTV ? { borderWidth: 2, borderColor: focus ? m.ui.ink : 'transparent' } : {}]}>
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
        state.focus ? m.box({ 'box-shadow': `0px 0px 0px 3px ${m.ui.focusHalo}` }) : {},
        Platform.isTV ? { borderWidth: 3, borderColor: state.focus ? m.ui.accent : 'transparent' } : {}]}>
      <Text style={m.text({ 'font-size': '13px', 'font-weight': '600', color: selected ? m.ui.inkInverse : m.ui.ink })}>{label}</Text>
    </Pressable>
  );
}

function rateLabel(rate: number): string { return `${number(rate, { maximumFractionDigits: 2, minimumFractionDigits: rate % 1 ? 1 : 1 })}×`; }

/** The visualizer's On/Off for this profile, offered where the device can draw one for this item. */
export interface VisualizerSwitch { on: boolean; onToggle(on: boolean): void }

/** Now Playing: the whole-screen player. */
export function NowPlaying({ onClose, panel: opening, onOpenVisualizer, visualizer, hidden = false, open = true, setPlayTarget, background }: {
  onClose(): void; panel?: 'queue' | 'lyrics' | 'sound'; onOpenVisualizer?(): void; visualizer?: VisualizerSwitch; hidden?: boolean;
  /** The dock can keep the controls drawn while it closes. */
  open?: boolean;
  setPlayTarget?(tag: number | undefined): void;
  /** The `nowPlaying` block's background (its nowPlaying.background template: a visualizer), drawn
   *  over the artwork's wash and under the tint, taking no focus. */
  background?: ReactNode;
}) {
  const host = useHost();
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  const live = useAudio();
  // While it leaves (closed, or the queue stopped) it keeps showing what was playing.
  const queue = useLast(live.queue);
  const audio = { ...live, queue: live.queue ?? queue ?? null };
  const item = currentInQueue(audio.queue);
  const [laidOut, setLaidOut] = useState(false);
  const [entered, setEntered] = useState(false);
  const playRef = useMemo(() => {
    if (!Platform.isTV) return undefined;
    const register = focusTarget(NOW_PLAYING_PLAY);
    return (target: ComponentRef<typeof Pressable> | null) => {
      if (!target) return;
      const forget = register(target);
      setPlayTarget?.(findNodeHandle(target) ?? undefined);
      return () => { forget?.(); setPlayTarget?.(undefined); };
    };
  }, [setPlayTarget]);
  useEffect(() => { if (!open) setEntered(false); }, [open]);
  const { preferPlay, requestTarget: initialFocus } = nowPlayingFirstFocus({
    tv: Platform.isTV, open: open && !hidden && !!item, laidOut, entered,
  });
  useEffect(() => {
    if (!initialFocus) return;
    // A view can lay out during the opening fade, while tvOS still excludes it from focus.
    // Stop at the first focus event, so moving the remote never brings Play back into focus.
    const deadline = performance.now() + 2000;
    let frame = requestAnimationFrame(function requestPlay() {
      focusElement(initialFocus);
      if (performance.now() < deadline) frame = requestAnimationFrame(requestPlay);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFocus]);
  const [panel, setPanel] = useState<'' | 'speed' | 'sleep'>('');
  const source = useInteraction();
  const shownPanel = useLast(panel || undefined);
  const [list, setList] = useState<NowPlayingList>(opening === 'lyrics' || opening === 'sound' ? opening : 'queue');
  // A document's parts (the nowPlaying block); none in the dock's own Now Playing.
  const headerPart = usePart('nowPlaying.header');
  const stagePart = usePart('nowPlaying.stage');
  const artworkPart = usePart('nowPlaying.artwork');
  const titlePart = usePart('nowPlaying.title');
  const bylinePart = usePart('nowPlaying.byline');
  const tintPart = usePart('nowPlaying.tint');
  const tabsPart = usePart('nowPlaying.tabs');
  const book = spoken(item);
  const music = item?.media?.class === 'music' && store.music.lyricsAvailable;
  const offered = { chapters: !!book && audio.chapters.length > 0, lyrics: !!music };
  useEffect(() => { setList(current => listForItem(current, offered)); }, [book, music, audio.chapters.length, item?.id]);
  // The list Sound was opened over, for the header's Sound button to go back to.
  const beforeSound = useRef<NowPlayingList>('queue');
  useEffect(() => { if (list !== 'sound') beforeSound.current = list; }, [list]);
  // Where the tabs sit in the page, so the header's Sound button can bring the panel into view
  // where it opens below the cover and transport.
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const listTop = useRef(0);
  const revealing = useRef(false);
  const [revealSound, setRevealSound] = useState(0);
  const reveal = () => {
    if (!revealing.current) return;
    revealing.current = false;
    scroller.current?.scrollTo({ y: Math.max(0, listTop.current), animated: !m.look.still });
  };
  // The tabs' new place arrives with their layout (from the phone's lyrics, the page re-lays out);
  // if it does not move, two frames on.
  useEffect(() => {
    if (!revealSound) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(reveal); });
    return () => cancelAnimationFrame(frame);
  }, [revealSound]);
  useEffect(() => { if (opening) setList(opening === 'sound' ? 'sound' : opening === 'lyrics' && music ? 'lyrics' : 'queue'); }, [opening, music]);
  // Space plays and pauses; Escape closes (web).
  useEffect(() => {
    if (hidden || !web || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      else if (event.key === ' ' && target?.getAttribute('role') !== 'button') { event.preventDefault(); store.audio.toggle(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, store, hidden]);
  if (!item || !audio.queue || hidden) return null;
  const playing = audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading';
  const sideBySide = nowPlayingSideBySide(m.width, m.height);
  const coverSize = sideBySide ? Math.min(480, m.height - 360, (m.width - m.gutter * 2) * 0.42) : Math.min(m.width - m.gutter * 2 - 24, m.height * 0.42, 420);
  const tint = item.accent || m.ui.accent;
  // Android TV's artwork wash starts at the tinted gradient stop when no visualizer is showing.
  const artworkWash = Platform.OS === 'android' && Platform.isTV && !onOpenVisualizer;
  // Keep the header legible over pale covers and the lightest visualizer frames.
  const washTop = artworkWash ? alpha(tint, 0.3) : alpha(m.ui.page, onOpenVisualizer ? 0.82 : 0.72);
  const parentId = item.media?.parent?.id;
  const chapterIndex = [...audio.chapters].reverse().find(c => c.startSeconds <= audio.positionSeconds);
  const chapterAt = chapterIndex ? audio.chapters.indexOf(chapterIndex) : -1;
  const sleeping = audio.sleep.mode !== 'off';
  const sleepLeft = audio.sleep.mode === 'timer' ? Math.max(0, (audio.sleep.endsAt - Date.now()) / 1000) : 0;
  const after = upNext(audio.queue);
  const launcherByTitle = (Platform.OS === 'ios' || Platform.OS === 'android') && !Platform.isTV;
  const launcher = onOpenVisualizer ? <RoundButton icon="visualizer" label={msg('visualizer.open')} onPress={onOpenVisualizer}
    nativeID="now-playing-visualizer" testID="now-playing-visualizer" size={44} /> : null;
  // Sound is one press away on every layout, beside the visualizer: the tab below can sit under the
  // fold on a phone or a short window.
  const soundButton = <RoundButton icon="sound" label={msg('music.sound')} active={list === 'sound'} size={44}
    onPress={() => { const next = toggleSound(list, beforeSound.current, offered); setList(next); if (next === 'sound' && !sideBySide) { revealing.current = true; setRevealSound(n => n + 1); } }}
    nativeID="now-playing-sound" testID="now-playing-sound" />;
  const headerEnd = [soundButton, launcherByTitle ? null : launcher].filter(Boolean).length;
  // Both ends of the header are as wide, so the source stays centred over the page.
  const headerSide = headerEnd * 44 + (headerEnd - 1) * 8;
  const controls = (
    <Guide {...guided} style={{ gap: 22, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {launcherByTitle ? launcher : null}
        <View style={{ flex: 1, gap: 6 }}>
          <Text numberOfLines={2} accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '28px' : '36px', 'line-height': '1.08' }), titlePart.text]} testID="now-playing-title">{item.name}</Text>
          {item.media?.byline ? <TextLink label={item.media.byline} testID="now-playing-byline"
            onPress={item.media.bylineTarget ? () => { onClose(); const t = item.media!.bylineTarget; if (t.startsWith('title:')) actions.openTitle({ id: t.slice(6), kind: 'artist' }); else actions.openPerson(t.slice(7), item.media!.byline); } : undefined}
            style={{ ...m.text({ 'font-size': '17px', color: '$ui.inkSecondary' }), ...bylinePart.text }} /> : null}
          {book && chapterIndex ? <Text style={m.text({ 'font-size': '14px', color: '$ui.inkQuiet' })}>{chapterIndex.name} · {msg('media.player.chapterOf', { index: number(chapterAt + 1), count: number(audio.chapters.length) })}</Text> : null}
        </View>
      </View>
      <Scrubber position={audio.positionSeconds} duration={audio.durationSeconds} onSeek={s => store.audio.seek(s)} chapters={book ? audio.chapters : []} />
      {audio.phase === 'failed' || audio.unsupported ? <Arrive still={m.look.still}><Text accessibilityRole="alert" style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>{audio.unsupported ? msg('media.player.unsupported') : audio.unreleased ? audio.error : msg('media.player.failed')}</Text></Arrive> : null}
      <View style={{ zIndex: 3 }}>
        <Guide {...guided} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {book
            ? <RoundButton icon="speed" label={`${msg('media.player.speed')}: ${rateLabel(audio.rate)}`} onPress={() => setPanel(panel === 'speed' ? '' : 'speed')} active={audio.rate !== 1 || panel === 'speed'} testID="now-playing-speed" />
            : <RoundButton icon="shuffle" label={msg('media.player.shuffle')} onPress={() => store.audio.toggleShuffle()} active={audio.queue.shuffle} testID="now-playing-shuffle" />}
          {book ? <RoundButton icon="back15" label={msg('media.player.back15')} onPress={() => store.audio.skip(-15)} size={54} testID="now-playing-back15" />
            : <RoundButton icon="previous" label={msg('media.player.previous')} onPress={() => store.audio.previous()} size={54} testID="now-playing-previous" iconSize={22} />}
          {audio.unreleased ? <View style={{ width: 76 }} /> : <PlayButton playing={playing} size={76} onPress={() => store.audio.toggle()}
            testID={NOW_PLAYING_PLAY} nativeID={NOW_PLAYING_PLAY} preferred={preferPlay}
            focusRef={playRef} onLayout={Platform.isTV ? () => setLaidOut(true) : undefined}
            onFocus={Platform.isTV && open ? () => setEntered(true) : undefined} />}
          {book ? <RoundButton icon="forward30" label={msg('media.player.forward30')} onPress={() => store.audio.skip(30)} size={54} testID="now-playing-forward30" />
            : <RoundButton icon="next" label={msg('media.player.next')} onPress={() => store.audio.next()} size={54} testID="now-playing-next" iconSize={22} />}
          {book
            ? <RoundButton icon="moon" label={msg('media.player.sleep')} onPress={() => setPanel(panel === 'sleep' ? '' : 'sleep')} active={sleeping || panel === 'sleep'} testID="now-playing-sleep" />
            : <RoundButton icon={audio.queue.repeat === 'one' ? 'repeatOne' : 'repeat'} label={audio.queue.repeat === 'one' ? msg('media.player.repeatOne') : msg('media.player.repeat')}
                onPress={() => store.audio.cycleRepeat()} active={audio.queue.repeat !== 'off'} testID="now-playing-repeat" />}
        </Guide>
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
    </Guide>
  );
  const listItems = list === 'sound' ? [<View key="sound" style={{ marginHorizontal: -18 }}>
    {/* The visualizer's switch heads the Sound tab, the one setting this device keeps per profile. */}
    {visualizer ? <SoundSection title={msg('visualizer.setting')} hint={msg(visualizer.on ? 'visualizer.settingOnHint' : 'visualizer.settingOffHint')}
      on={visualizer.on} onToggle={visualizer.onToggle} testID="now-playing-visualizer-setting" tv={musicTV()} /> : null}
    <SoundBlock tv={musicTV()} /></View>] : list === 'lyrics' ? [<View key="lyrics" style={[{ height: Math.max(320, m.height - 220), overflow: 'hidden' }, m.box({ 'mask-image': 'linear-gradient(180deg, transparent 0%, #000 9%, #000 86%, transparent 100%)' })]}><LyricsPanel card={item} large /></View>] : list === 'chapters' ? (
    audio.chapters.map((c, i) => <ListRow key={c.id} number={number(i + 1)} title={c.name} trailing={clock(c.startSeconds)} current={chapterAt === i} playing={playing}
      dim={i < chapterAt} onPress={() => store.audio.seek(c.startSeconds)} testID={`now-playing-chapter-${i}`} />)
  ) : after.length ? after.map((card, i) => <ListRow key={`${card.id}-${i}`} number={number(i + 1)} title={card.name} subtitle={card.media?.byline}
      trailing={card.media?.clockLabel} onPress={() => store.audio.jump(audio.queue!.items.indexOf(card))} testID={`now-playing-next-${card.id}`} />)
    : [<Text key="none" style={m.text({ 'font-size': '14px', color: '$ui.inkQuiet', padding: '12px 14px' })}>{msg('media.player.nothingNext')}</Text>];
  const tabs = (
    <View style={[{ flexDirection: 'row', gap: 8, marginBottom: 10 }, tabsPart.box]} accessibilityRole="tablist">
      <Chip label={msg('media.player.upNext')} selected={list === 'queue'} onPress={() => setList('queue')} testID="now-playing-queue-tab" />
      {audio.chapters.length ? <Chip label={msg('media.player.chapters')} selected={list === 'chapters'} onPress={() => setList('chapters')} testID="now-playing-chapters-tab" /> : null}
      {music ? <Chip label={msg('music.lyrics')} selected={list === 'lyrics'} onPress={() => setList('lyrics')} testID="now-playing-lyrics-tab" /> : null}
      <Chip label={msg('music.sound')} selected={list === 'sound'} onPress={() => setList('sound')} testID="now-playing-sound-tab" />
    </View>
  );
  const top = Math.max(14, host.viewport.insets.top + 10);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: onOpenVisualizer ? 'transparent' : m.ui.page }} testID="now-playing" accessibilityViewIsModal accessibilityLabel={msg('media.player.nowPlaying')}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden',
        backgroundColor: onOpenVisualizer || artworkWash ? 'transparent' : alpha(tint, 0.3) }}>
        {/* Native image blur (expo-image on Android and iOS) stops far short of 90: the cover's own
            lettering showed through behind the title and transport. There the wash is the colour alone. */}
        {!onOpenVisualizer && item.poster && Platform.OS === 'web' ? <Image source={host.image(item.poster)} contentFit="cover" blurRadius={90} style={{ position: 'absolute', top: -120, left: -120, right: -120, bottom: -120, opacity: 0.5 } as never} /> : null}
        {background ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>{background}</View> : null}
        <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, m.box({ 'background-image': `linear-gradient(180deg, ${washTop} 0%, ${alpha(m.ui.page, 0.7)} 60%, ${m.ui.page} 100%)` }), tintPart.box]} />
      </View>
      <View style={[{ flexDirection: 'row', alignItems: 'center', paddingTop: top, paddingHorizontal: m.gutter - 6, gap: 12 }, headerPart.box]}>
        <View style={{ width: headerSide, alignItems: 'flex-start' }}>
          <RoundButton icon="down" label={msg('media.player.close')} onPress={onClose} testID="now-playing-close" nativeID="now-playing-close" size={42} />
        </View>
        {/* The link spans the header, so a TV's remote reaches it from the Up Next tabs below; its
            focus ring is drawn around the words. */}
        <Pressable {...source.handlers} disabled={!audio.queue.source} onPress={() => { const s = audio.queue?.source; if (s) { onClose(); actions.openTitle({ id: s.id, kind: parentId === s.id ? 'album' : (item.media?.class === 'audiobook' ? 'audiobook' : 'album') }); } }}
          accessibilityRole="link" style={[NO_RING, { flex: 1, alignItems: 'center' }]} testID="now-playing-source">
          <View style={[{ alignItems: 'center', maxWidth: '100%' },
            Platform.isTV ? { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 2, borderWidth: 2, borderColor: source.state.focus ? m.ui.ink : 'transparent' } : undefined,
            web && source.state.focus ? { borderRadius: 8, outlineColor: m.ui.ink, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 3 } as ViewStyle : undefined]}>
            <Text numberOfLines={1} style={m.text({ 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '0.18em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{msg('media.player.nowPlaying')}</Text>
            {audio.queue.source ? <Text numberOfLines={1} style={m.text({ 'font-size': '13px', 'font-weight': '600', color: source.state.focus ? '$ui.ink' : '$ui.inkSecondary' })}>{audio.queue.source.name}</Text> : null}
          </View>
        </Pressable>
        <View style={{ width: headerSide, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          {soundButton}
          {launcherByTitle ? null : launcher}
        </View>
      </View>
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={[{ paddingHorizontal: m.gutter, paddingTop: PAGE_TOP, paddingBottom: 48, minHeight: '100%' as never }, stagePart.box]}>
        {sideBySide ? (
          <View style={{ flexDirection: 'row', gap: 56, alignItems: 'flex-start', maxWidth: 1280, width: '100%', alignSelf: 'center' } as ViewStyle}>
            <View style={{ flex: 1, gap: 34, alignItems: 'center' }}>
              <Artwork item={item} size={coverSize} playing={playing} style={artworkPart.box} />
              {controls}
            </View>
            <View style={{ flex: 1, maxWidth: 520, paddingTop: 8 }}>{tabs}<Arrive key={list} still={m.look.still} style={{ gap: 2 }}>{listItems}</Arrive></View>
          </View>
        ) : list === 'lyrics' ? (
          // On a phone the lyrics take the screen, with the title and transport below them.
          <View style={{ gap: 18 }}>
            {tabs}
            <View style={[{ height: Math.max(260, m.height - 430), overflow: 'hidden' }, m.box({ 'mask-image': 'linear-gradient(180deg, transparent 0%, #000 8%, #000 88%, transparent 100%)' })]}><LyricsPanel card={item} large /></View>
            {controls}
          </View>
        ) : (
          <View style={{ gap: 28, alignItems: 'center' }}>
            <Artwork item={item} size={coverSize} playing={playing} style={artworkPart.box} />
            {controls}
            <View style={{ width: '100%', maxWidth: 560 }} onLayout={e => { listTop.current = e.nativeEvent.layout.y + PAGE_TOP - 12; reveal(); }}>{tabs}<Arrive key={list} still={m.look.still} style={{ gap: 2 }}>{listItems}</Arrive></View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Artwork({ item, size, playing, style }: { item: Card; size: number; playing: boolean; style?: ViewStyle }): ReactNode {
  const m = useMediaLook();
  const book = item.shape === 'book';
  const width = book ? Math.round(size / 1.5) : size;
  // The cover eases back a little while paused, as a record settles.
  return (
    <View style={[{ transform: [{ scale: playing || m.look.still ? 1 : 0.94 }] }, web ? ({ transitionProperty: 'transform', transitionDuration: '420ms', transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' } as ViewStyle) : {}, style]}>
      <Cover uri={item.poster} shape={book ? 'book' : 'square'} size={width} title={item.name} byline={item.media?.byline} accent={item.accent} lift={2.2} />
    </View>
  );
}
