// The multiview screen: up to four live tiles side by side (2-up, 2×2, 1 big + 3 small). Focus
// carries the audio; a long press (Select held on the Siri Remote, a held touch, a click on the
// focused tile on the web) takes a tile full screen and back. Select on TV, or a tile's options
// button on touch and the web, opens the tile's panel: change its channel, make it the big one,
// the layout, remove it. Each tile draws its own state: tuning, playing (with the score bug when its
// programme is a live event) or why it was refused.
//
// Every tile's picture is a full-screen view moved into its slot by a native-driven transform
// (layout.ts), so layout changes and full screen animate without resizing a playing surface. The
// focusable press targets are plain views at the slots' rects, so TV focus sees real geometry.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { AccessibilityInfo, Animated, Easing, PixelRatio, Platform, ScrollView, StyleSheet, View, useTVEventHandler, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import type { VelaPlayerViewProps } from '@vela/player-api';
import { msg, type GuideChannel } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { holdBack } from '../../menu-key';
import type { Focusable } from '../../escape';
import { useGuideLook, type GuideLook, alpha } from '../guide/look';
import { Line, LogoTile, Press } from '../guide/parts';
import { PlayerIcon } from '../player/icons';
import { ScoreBug } from '../live-overlay/score-bug';
import { refusalTitle } from './refusal';
import type { LiveEventRef, MultiviewController, MultiviewTile, MultiviewView } from './controller';
import { featureBand, placement, slotRects, type MultiviewLayout, type Rect, type Size } from './layout';

const TV = Platform.isTV;
const TOUCH = !TV && Platform.OS !== 'web';
/** Tile motion: a long, soft ease-out, the same for layout, full screen and entry. */
const MOVE = { duration: 460, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };
const FADE = { duration: 320, easing: Easing.out(Easing.cubic) };
/** The caption row's height under side-by-side and one-big tiles. */
const CAPTION = TV ? 112 : Platform.OS === 'web' ? 84 : 64;
const useTVEvents = typeof useTVEventHandler === 'function' ? useTVEventHandler : (_handler: (event: { eventType?: string }) => void) => undefined;

export interface MultiviewScreenProps {
  controller: MultiviewController;
  Player: ComponentType<VelaPlayerViewProps>;
  /** The lineup: names and logos for the tiles, and the channel picker's list. */
  channels: GuideChannel[];
  /** Leave the screen (Back with nothing open). */
  onLeave(): void;
}

type Panel = { slot: number; mode: 'actions' | 'channels' } | { slot: -1; mode: 'add' };

export function useMultiviewView(controller: MultiviewController): MultiviewView {
  return useSyncExternalStore(controller.subscribe, controller.view, controller.view);
}

function useStill(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => sub.remove();
  }, []);
  return still;
}

export function MultiviewScreen({ controller, Player, channels, onLeave }: MultiviewScreenProps) {
  const view = useMultiviewView(controller);
  const look = useGuideLook();
  const still = useStill();
  const screen = useWindowDimensions();
  const [size, setSize] = useState<Size>({ width: screen.width, height: screen.height });
  const [panel, setPanel] = useState<Panel | null>(null);
  const byId = useMemo(() => new Map(channels.map(channel => [channel.id, channel])), [channels]);
  const gap = TV ? 14 : Platform.OS === 'web' ? 10 : 6;
  const count = view.tiles.length;
  // Side by side and one big + three small say what is on each tile under the tiles.
  const captioned = count > 1 && size.width >= size.height && (view.layout === 'feature' || view.layout === 'split');
  const caption = captioned ? CAPTION : 0;
  const rects = useMemo(() => slotRects(view.layout, count, size, gap, caption), [view.layout, count, size, gap, caption]);
  const full: Rect = { x: 0, y: 0, width: size.width, height: size.height };
  // Each tile asks for the stream height it is drawn at, in device pixels.
  const heights = view.tiles.map((tile, index) => `${tile.slot}:${Math.round((view.fullscreen === tile.slot ? size.height : rects[index]?.height ?? 0) * PixelRatio.get())}`).join(',');
  useEffect(() => {
    for (const entry of heights.split(',')) {
      const [slot, pixels] = entry.split(':').map(Number);
      if (pixels! > 0) controller.setHeight(slot!, pixels!);
    }
  }, [controller, heights]);
  // A tile's panel stays tied to its slot; a removed tile closes it.
  const panelOpen = panel !== null && (panel.slot === -1 || view.tiles.some(tile => tile.slot === panel.slot));

  useEffect(() => controller.open(), [controller]);
  // On the web and touch a press focuses its tile first (pointer down); that same press must not also
  // take the tile full screen.
  const focusedBy = useRef({ slot: -1, at: 0 });

  // Closing the panel gives the focus back to the tile it was for (TV and keyboard), not to whichever
  // tile the focus engine would find first.
  const targets = useRef(new Map<number, Focusable>());
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !panelOpen) {
      const target = targets.current.get(controller.view().focused);
      requestAnimationFrame(() => {
        if (target?.requestTVFocus) target.requestTVFocus();
        else target?.focus?.();
      });
    }
    wasOpen.current = panelOpen;
  }, [panelOpen, controller]);

  // Back closes the panel, then full screen, then leaves.
  const back = useRef<() => boolean>(() => false);
  back.current = () => {
    if (panelOpen) { setPanel(null); return true; }
    return controller.exitFullscreen();
  };
  const holding = panelOpen || view.fullscreen >= 0;
  useEffect(() => (holding ? holdBack(() => back.current()) : undefined), [holding]);
  // Full screen, left and right move it to the neighbouring tile (and the audio with it).
  const flip = useRef<(step: 1 | -1) => boolean>(() => false);
  flip.current = step => {
    if (panelOpen || view.fullscreen < 0 || view.tiles.length < 2) return false;
    const index = view.tiles.findIndex(tile => tile.slot === view.fullscreen);
    const next = view.tiles[(index + step + view.tiles.length) % view.tiles.length]!;
    controller.toggleFullscreen(next.slot);
    return true;
  };
  useTVEvents(event => {
    if (event.eventType === 'right') flip.current(1);
    else if (event.eventType === 'left') flip.current(-1);
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        if (flip.current(event.key === 'ArrowRight' ? 1 : -1)) event.preventDefault();
        return;
      }
      if (event.key !== 'Escape') return;
      if (!back.current()) onLeave();
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [onLeave]);

  const layout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) setSize({ width, height });
  };

  const hint = useHint(look, still, count > 0 && view.phase === 'open' && view.fullscreen < 0);
  const name = (id: string) => byId.get(id)?.name ?? '';

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: look.page }]} onLayout={layout}>
      {view.tiles.map((tile, index) => (
        <TilePicture key={tile.slot} tile={tile} look={look} size={size} still={still} Player={Player} controller={controller}
          rect={view.fullscreen === tile.slot ? full : rects[index] ?? full}
          fullscreen={view.fullscreen === tile.slot} hidden={view.fullscreen >= 0 && view.fullscreen !== tile.slot}
          focused={view.focused === tile.slot} channel={byId.get(tile.channelId)} />
      ))}
      {view.tiles.map((tile, index) => {
        const fullscreen = view.fullscreen === tile.slot;
        if (view.fullscreen >= 0 && !fullscreen) return null;
        const rect = fullscreen ? full : rects[index];
        if (!rect) return null;
        return <TileTarget key={tile.slot} tile={tile} rect={rect} look={look} focusable={!panelOpen}
          target={value => { if (value) targets.current.set(tile.slot, value); else targets.current.delete(tile.slot); }}
          preferred={!panelOpen && view.focused === tile.slot} channelName={name(tile.channelId)}
          onFocus={() => {
            if (controller.view().focused !== tile.slot) focusedBy.current = { slot: tile.slot, at: Date.now() };
            controller.focus(tile.slot);
          }}
          onPress={() => {
            if (TV) { setPanel({ slot: tile.slot, mode: tile.refusal ? 'channels' : 'actions' }); return; }
            const justFocused = focusedBy.current.slot === tile.slot && Date.now() - focusedBy.current.at < 600;
            focusedBy.current = { slot: -1, at: 0 };
            if (!justFocused && (controller.view().focused === tile.slot || fullscreen)) controller.toggleFullscreen(tile.slot);
            else controller.focus(tile.slot);
          }}
          onLongPress={() => controller.toggleFullscreen(tile.slot)}
          onOptions={() => setPanel({ slot: tile.slot, mode: 'actions' })} />;
      })}
      {view.fullscreen < 0 && captioned ? (
        <Captions key={view.layout} look={look} still={still} view={view} rects={rects} size={size} gap={gap} byId={byId} />
      ) : null}
      {count === 0 ? <Empty look={look} onAdd={() => setPanel({ slot: -1, mode: 'add' })} onLeave={onLeave} preferred={!panelOpen} /> : null}
      {view.phase === 'failed' ? <Notice look={look} text={view.failure ?? msg('multiview.failed')} /> : null}
      {hint}
      {!TV && count > 0 ? (
        <View style={{ position: 'absolute', left: gap + 8, bottom: gap + 8, zIndex: 6 }}>
          <Press label={msg('multiview.close')} onPress={() => { if (!back.current()) onLeave(); }} style={({ hovered }) => ({
            height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: hovered ? 'rgba(11, 15, 26, 0.92)' : 'rgba(11, 15, 26, 0.72)', borderWidth: 1, borderColor: look.edge })}>
            <Line look={look} size={13} weight={650}>{view.fullscreen >= 0 ? msg('multiview.backToGrid') : msg('multiview.close')}</Line>
          </Press>
        </View>
      ) : null}
      <TilePanel look={look} still={still} open={panelOpen} panel={panel} view={view} channels={channels} byId={byId}
        controller={controller} onClose={() => setPanel(null)} onAdd={() => setPanel({ slot: -1, mode: 'add' })} onMode={mode => setPanel(current => current && current.slot >= 0 ? { slot: current.slot, mode } : current)} />
    </View>
  );
}

/** One tile's picture and the chrome over it, carried into its rect by a native-driven transform. */
function TilePicture({ tile, rect, size, look, still, fullscreen, hidden, focused, channel, Player, controller }: {
  tile: MultiviewTile; rect: Rect; size: Size; look: GuideLook; still: boolean; fullscreen: boolean; hidden: boolean;
  focused: boolean; channel: GuideChannel | undefined; Player: ComponentType<VelaPlayerViewProps>;
  controller: MultiviewController;
}) {
  const target = placement(rect, size);
  const values = useRef<{ x: Animated.Value; y: Animated.Value; scale: Animated.Value; opacity: Animated.Value; picture: Animated.Value; ring: Animated.Value } | null>(null);
  if (!values.current) {
    values.current = {
      x: new Animated.Value(target.translateX), y: new Animated.Value(target.translateY),
      scale: new Animated.Value(target.scale * (still ? 1 : 0.92)), opacity: new Animated.Value(0),
      picture: new Animated.Value(0), ring: new Animated.Value(0),
    };
  }
  const v = values.current;
  const [raised, setRaised] = useState(fullscreen);
  useEffect(() => {
    if (fullscreen) setRaised(true);
    const move = (value: Animated.Value, to: number) => Animated.timing(value, { toValue: to, ...MOVE, duration: still ? 0 : MOVE.duration, useNativeDriver: true });
    const animation = Animated.parallel([
      move(v.x, target.translateX), move(v.y, target.translateY), move(v.scale, target.scale),
      Animated.timing(v.opacity, { toValue: hidden ? 0 : 1, ...FADE, duration: still ? 0 : FADE.duration, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished && !fullscreen) setRaised(false); });
    return () => animation.stop();
  }, [target.translateX, target.translateY, target.scale, hidden, fullscreen, still, v]);
  const playing = tile.state === 'playing';
  useEffect(() => {
    Animated.timing(v.picture, { toValue: playing ? 1 : 0, ...FADE, duration: still ? 0 : playing ? 420 : 160, useNativeDriver: true }).start();
  }, [playing, still, v]);
  useEffect(() => {
    Animated.timing(v.ring, { toValue: focused && !fullscreen ? 1 : 0, duration: still ? 0 : 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [focused, fullscreen, still, v]);

  // The chrome keeps its own size on screen whatever the tile's scale: it is drawn inside the moving
  // view at 1/scale, and grows a little at full screen.
  // A small tile's chrome shrinks a little with it, so a long bug still fits; full screen draws the
  // player's own full-size bug.
  const visual = fullscreen ? 1 : Math.min(1, 0.45 + target.scale);
  const counter = useMemo(() => Animated.divide(visual, v.scale), [v.scale, visual]);
  const radius = fullscreen ? 0 : look.radiusTile;
  const s = Math.max(0.05, target.scale);

  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: 0, top: 0, width: size.width, height: size.height, zIndex: raised ? 2 : 1,
      opacity: v.opacity, transform: [{ translateX: v.x }, { translateY: v.y }, { scale: v.scale }],
    }}>
      <View style={{ flex: 1, borderRadius: radius / s, overflow: 'hidden', backgroundColor: look.media }}>
        <Placeholder look={look} channel={channel} tile={tile} counter={counter} />
        {tile.plan ? (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: v.picture }]}>
            {/* The session at a new height plays muted under the current one until its first picture,
                then takes its place under the same key, so the view is never remounted. */}
            {[tile.next, tile.plan].map(plan => plan ? (
              <Player key={plan.sessionId} tile={tile.slot} plan={plan} style={StyleSheet.absoluteFill}
                command={plan === tile.next ? { id: tile.command?.id ?? 0, type: 'mute', muted: true } : tile.command ?? undefined}
                onSnapshot={snapshot => controller.snapshot(tile.slot, snapshot)}
                onError={failure => controller.failed(tile.slot, plan.sessionId, failure.message)} />
            ) : null)}
          </Animated.View>
        ) : null}
        {tile.liveEvent && playing ? (
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, transformOrigin: 'left top', transform: [{ scale: counter }] } as never}>
            <View style={{ padding: TV ? 18 : 10 }}><ScoreBug eventId={tile.liveEvent.id} size={fullscreen ? 'full' : 'tile'} /></View>
          </Animated.View>
        ) : null}
        {tile.buffering ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Animated.View style={{ padding: TV ? 14 : 9, borderRadius: 999, backgroundColor: 'rgba(11, 15, 26, 0.6)', transform: [{ scale: counter }] }}>
              <TuningDots look={look} />
            </Animated.View>
          </View>
        ) : null}
        <TileNotice look={look} text={tile.notice} counter={counter} still={still} />
        {focused && !tile.muted && playing && !fullscreen ? (
          <Animated.View style={{ position: 'absolute', right: 0, bottom: 0, transformOrigin: 'right bottom', transform: [{ scale: counter }] } as never}>
            <View style={{ margin: TV ? 16 : 9, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: TV ? 6 : 4, paddingHorizontal: TV ? 12 : 8,
              borderRadius: 999, backgroundColor: 'rgba(11, 15, 26, 0.78)' }}>
              <PlayerIcon name="speaker" size={TV ? 22 : 14} color={look.ink} />
              <Line look={look} size={TV ? 13 : 11} weight={650}>{msg('multiview.audio')}</Line>
            </View>
          </Animated.View>
        ) : null}
      </View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        opacity: v.ring, borderRadius: radius / s, borderWidth: (TV ? 5 : 3) / s, borderColor: look.accent,
      }]} />
    </Animated.View>
  );
}

/** A refused channel change: the tile kept its channel and says why for a moment, fading in and out. */
function TileNotice({ look, text, counter, still }: { look: GuideLook; text: string | null; counter: Animated.AnimatedNode; still: boolean }) {
  const [shown, setShown] = useState(text);
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (text) setShown(text);
    const animation = Animated.timing(opacity, { toValue: text ? 1 : 0, duration: still ? 0 : text ? 220 : 320, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start(({ finished }) => { if (finished && !text) setShown(null); });
    return () => animation.stop();
  }, [text, still, opacity]);
  if (!shown) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', opacity, transformOrigin: 'center bottom', transform: [{ scale: counter }] } as never}>
      <View style={{ margin: TV ? 18 : 10, flexDirection: 'row', alignItems: 'center', gap: TV ? 10 : 6, maxWidth: TV ? 720 : 420,
        paddingVertical: TV ? 8 : 5, paddingHorizontal: TV ? 16 : 10, borderRadius: 999, backgroundColor: 'rgba(11, 15, 26, 0.84)' }}>
        <PlayerIcon name="alert" size={TV ? 22 : 14} color={look.now} />
        <Line look={look} size={TV ? 15 : 12} weight={650} lines={1}>{shown}</Line>
      </View>
    </Animated.View>
  );
}

/** What a tile shows under (or instead of) its picture: the channel while tuning, or why it failed. */
function Placeholder({ look, channel, tile, counter }: { look: GuideLook; channel: GuideChannel | undefined; tile: MultiviewTile; counter: Animated.AnimatedNode }) {
  const name = channel?.name ?? '';
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(look.ink, 0.04), alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View style={{ alignItems: 'center', gap: TV ? 18 : 10, maxWidth: TV ? 760 : 420, paddingHorizontal: 24, transform: [{ scale: counter }] }}>
        {tile.refusal ? <>
          <PlayerIcon name="alert" size={TV ? 44 : 26} color={look.now} />
          {channel ? <Line look={look} size={TV ? 14 : 12} weight={650} color={look.inkQuiet}>{`${channel.number} · ${name}`}</Line> : null}
          <Line look={look} size={TV ? 22 : 15} weight={700} lines={2} style={{ textAlign: 'center' }}>{refusalTitle(tile.refusal, name)}</Line>
          <Line look={look} size={TV ? 15 : 12} color={look.inkSecondary} lines={3} style={{ textAlign: 'center' }}>{tile.refusal.detail}</Line>
        </> : <>
          <LogoTile look={look} logo={channel?.logo ?? ''} name={name} channelId={channel?.id} width={TV ? 150 : 84} height={TV ? 90 : 50} radius={TV ? 14 : 8} />
          <Line look={look} size={TV ? 17 : 13} weight={650} color={look.inkSecondary}>{channel ? `${channel.number} · ${name}` : msg('multiview.tuning')}</Line>
          {tile.state !== 'waiting' ? <TuningDots look={look} /> : null}
        </>}
      </Animated.View>
    </View>
  );
}

function TuningDots({ look }: { look: GuideLook }) {
  const phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [phase]);
  const size = TV ? 10 : 6;
  return (
    <View style={{ flexDirection: 'row', gap: size }}>
      {[0, 1, 2].map(i => (
        <Animated.View key={i} style={{ width: size, height: size, borderRadius: size, backgroundColor: look.accent,
          opacity: phase.interpolate({ inputRange: [0, (i + 0.5) / 4, (i + 1.5) / 4, 1], outputRange: [0.25, 1, 0.25, 0.25], extrapolate: 'clamp' }) }} />
      ))}
    </View>
  );
}

/** What is on each tile, where the layout leaves room: under each tile side by side, and in the band
 * under one big + three small. The tile with the audio is marked. */
function Captions({ look, still, view, rects, size, gap, byId }: {
  look: GuideLook; still: boolean; view: MultiviewView; rects: Rect[]; size: Size; gap: number;
  byId: Map<string, GuideChannel>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: still ? 0 : 420, delay: still ? 0 : 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [opacity, still]);
  if (view.layout === 'split') {
    return <>{view.tiles.map((tile, index) => {
      const rect = rects[index];
      if (!rect) return null;
      const top = rect.y + rect.height + gap;
      if (size.height - top < CAPTION) return null;
      return <Animated.View key={tile.slot} pointerEvents="none" style={{ position: 'absolute', left: rect.x, top, width: rect.width, opacity }}>
        <Caption look={look} tile={tile} channel={byId.get(tile.channelId)} focused={view.focused === tile.slot} />
      </Animated.View>;
    })}</>;
  }
  const band = featureBand(size, gap, CAPTION);
  if (band.y + band.height > size.height) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: band.x, top: band.y, width: band.width, height: band.height,
      flexDirection: 'row', gap, alignItems: 'center', opacity }}>
      {view.tiles.map(tile => (
        <View key={tile.slot} style={{ flex: 1, minWidth: 0 }}>
          <Caption look={look} tile={tile} channel={byId.get(tile.channelId)} focused={view.focused === tile.slot} />
        </View>
      ))}
    </Animated.View>
  );
}

function Caption({ look, tile, channel, focused }: {
  look: GuideLook; tile: MultiviewTile; channel: GuideChannel | undefined; focused: boolean;
}) {
  const ring = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(ring, { toValue: focused ? 1 : 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [focused, ring]);
  const name = channel?.name ?? '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: TV ? 16 : 10, padding: TV ? 14 : 8, borderRadius: look.radiusCell, overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: look.live, borderRadius: look.radiusCell, borderWidth: 1, borderColor: look.liveEdge, opacity: ring }]} />
      <LogoTile look={look} logo={channel?.logo ?? ''} name={name} channelId={channel?.id} width={TV ? 112 : 60} height={TV ? 66 : 36} radius={TV ? 10 : 6} size={TV ? 13 : 10} />
      <View style={{ flex: 1, minWidth: 0, gap: TV ? 4 : 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {focused && !tile.muted ? <PlayerIcon name="speaker" size={TV ? 20 : 14} color={look.accent} /> : null}
          <Line look={look} size={TV ? 13 : 12} weight={700} color={focused ? look.ink : look.inkSecondary} style={{ flexShrink: 1 }}>
            {channel ? `${channel.number} · ${name}` : ''}
          </Line>
        </View>
        {channel?.now ? <Line look={look} size={TV ? 12 : 11} color={look.inkQuiet}>{channel.now}</Line> : null}
        {tile.liveEvent ? <View style={{ marginTop: TV ? 4 : 2, alignSelf: 'flex-start' }}><ScoreBug eventId={tile.liveEvent.id} size="compact" /></View> : null}
      </View>
    </View>
  );
}

/** The focusable press target over a tile, at its rect. */
function TileTarget({ tile, rect, look, focusable, preferred, channelName, target, onFocus, onPress, onLongPress, onOptions }: {
  tile: MultiviewTile; rect: Rect; look: GuideLook; focusable: boolean; preferred: boolean; channelName: string;
  target(value: Focusable | null): void;
  onFocus(): void; onPress(): void; onLongPress(): void; onOptions(): void;
}) {
  // The pointer moving from the tile onto its options button leaves the tile's press target: the
  // button stays while the pointer is over either.
  const [hovered, setHovered] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hover = (on: boolean) => {
    clearTimeout(leave.current);
    if (on) setHovered(true);
    else leave.current = setTimeout(() => setHovered(false), 250);
  };
  useEffect(() => () => clearTimeout(leave.current), []);
  const keep = Platform.OS === 'web' ? { onPointerEnter: () => hover(true), onPointerLeave: () => hover(false) } : {};
  return (
    <View style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: 3 }}>
      <Pressable
        ref={value => target(value as Focusable | null)}
        focusable={focusable}
        hasTVPreferredFocus={preferred}
        accessibilityRole="button"
        accessibilityLabel={channelName}
        accessibilityHint={msg(TOUCH ? 'multiview.hintTouch' : 'multiview.hint')}
        onFocus={onFocus}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={TV ? 450 : 420}
        onHoverIn={() => hover(true)}
        onHoverOut={() => hover(false)}
        tvParallaxProperties={{ enabled: false }}
        style={[StyleSheet.absoluteFill, Platform.OS === 'web' ? ({ outlineStyle: 'none', cursor: 'pointer' } as never) : null]}
      />
      {!TV && (hovered || TOUCH) && tile.state !== 'waiting' ? (
        <View style={{ position: 'absolute', right: 8, top: 8 }} {...keep}>
          <Press label={msg('multiview.title')} onPress={onOptions} style={({ hovered: over }) => ({
            width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
            backgroundColor: over ? 'rgba(11, 15, 26, 0.92)' : 'rgba(11, 15, 26, 0.7)' })}>
            <Line look={look} size={16} weight={800}>⋯</Line>
          </Press>
        </View>
      ) : null}
    </View>
  );
}

function Empty({ look, onAdd, onLeave, preferred }: { look: GuideLook; onAdd(): void; onLeave(): void; preferred: boolean }) {
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: TV ? 28 : 16 }]}>
      <Line look={look} size={TV ? 30 : 22} weight={700}>{msg('multiview.title')}</Line>
      <Line look={look} size={TV ? 17 : 14} color={look.inkSecondary}>{msg('multiview.empty')}</Line>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <PanelButton look={look} label={msg('multiview.addChannel')} onPress={onAdd} preferred={preferred} primary />
        <PanelButton look={look} label={msg('multiview.close')} onPress={onLeave} />
      </View>
    </View>
  );
}

function Notice({ look, text }: { look: GuideLook; text: string }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: TV ? 60 : 24, alignItems: 'center', zIndex: 5 }}>
      <View style={{ paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, backgroundColor: look.glass, borderWidth: 1, borderColor: look.edge }}>
        <Line look={look} size={TV ? 16 : 13} weight={600}>{text}</Line>
      </View>
    </View>
  );
}

/** How to use the screen, shown for a moment when the tiles first play. */
function useHint(look: GuideLook, still: boolean, ready: boolean) {
  const opacity = useRef(new Animated.Value(0)).current;
  const shown = useRef(false);
  useEffect(() => {
    if (!ready || shown.current) return;
    shown.current = true;
    Animated.sequence([
      Animated.delay(700),
      Animated.timing(opacity, { toValue: 1, duration: still ? 0 : 360, useNativeDriver: true }),
      Animated.delay(4200),
      Animated.timing(opacity, { toValue: 0, duration: still ? 0 : 600, useNativeDriver: true }),
    ]).start();
  }, [ready, still, opacity]);
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: TV ? 44 : 18, alignItems: 'center', opacity, zIndex: 4 }}>
      <View style={{ paddingVertical: TV ? 10 : 7, paddingHorizontal: TV ? 22 : 14, borderRadius: 999, backgroundColor: 'rgba(11, 15, 26, 0.82)' }}>
        <Line look={look} size={TV ? 14 : 12} weight={600} color={look.ink}>{msg(TOUCH ? 'multiview.hintTouch' : 'multiview.hint')}</Line>
      </View>
    </Animated.View>
  );
}

function PanelButton({ look, label, onPress, preferred, primary, selected }: {
  look: GuideLook; label: string; onPress(): void; preferred?: boolean; primary?: boolean; selected?: boolean;
}) {
  return (
    <Press label={label} onPress={onPress} hasTVPreferredFocus={preferred} lift={TV}
      style={({ focused, hovered }) => ({
        minHeight: TV ? 66 : 42, paddingHorizontal: TV ? 26 : 16, borderRadius: look.radiusControl, justifyContent: 'center',
        backgroundColor: focused ? look.ink : hovered ? look.controlHover : primary ? alpha(look.accent, 0.9) : look.control,
      })}>
      {({ focused }) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {selected ? <PlayerIcon name="check" size={TV ? 24 : 16} color={focused ? look.inkInverse : look.accent} /> : null}
          <Line look={look} size={TV ? 16 : 14} weight={650} color={focused ? look.inkInverse : primary ? look.onAccent : look.ink}>{label}</Line>
        </View>
      )}
    </Press>
  );
}

const LAYOUT_LABEL: Record<MultiviewLayout, string> = {
  single: 'multiview.fullScreen', split: 'multiview.layoutSplit', grid: 'multiview.layoutGrid', feature: 'multiview.layoutFeature',
};

/** The tile's panel, sliding in from the right: its actions, or the channel picker. */
function TilePanel({ look, still, open, panel, view, channels, byId, controller, onClose, onAdd, onMode }: {
  look: GuideLook; still: boolean; open: boolean; panel: Panel | null; view: MultiviewView; channels: GuideChannel[];
  byId: Map<string, GuideChannel>; controller: MultiviewController; onClose(): void; onAdd(): void; onMode(mode: 'actions' | 'channels'): void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<Panel | null>(null);
  // The press that opened the panel ends over its backdrop (a click follows pointer up on the web):
  // the backdrop closes only for a later press.
  const openedAt = useRef(0);
  const dismiss = () => { if (Date.now() - openedAt.current > 400) onClose(); };
  useEffect(() => {
    if (open && !shown) openedAt.current = Date.now();
    if (open && panel) setShown(panel);
    Animated.timing(progress, { toValue: open ? 1 : 0, duration: still ? 0 : open ? 340 : 220, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true })
      .start(({ finished }) => { if (finished && !open) setShown(null); });
  }, [open, panel, still, progress]);
  const width = TV ? 640 : Platform.OS === 'web' ? 420 : 340;
  if (!shown) return null;
  const tile = view.tiles.find(candidate => candidate.slot === shown.slot);
  const channel = tile ? byId.get(tile.channelId) : undefined;
  const picking = shown.mode === 'channels' || shown.mode === 'add';
  const choose = (id: string) => {
    if (shown.mode === 'add') controller.add(id);
    else if (tile) controller.swap(tile.slot, id);
    onClose();
  };
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.45)', opacity: progress }]}>
        {!TV ? <View style={StyleSheet.absoluteFill} onTouchEnd={dismiss} {...({ onClick: dismiss } as object)} /> : null}
      </Animated.View>
      <Animated.View style={{
        position: 'absolute', top: 0, bottom: 0, right: 0, width: Math.min(width, 9999), backgroundColor: look.glass,
        borderLeftWidth: 1, borderColor: look.edge, paddingTop: TV ? 64 : 28, paddingHorizontal: TV ? 40 : 20, gap: TV ? 16 : 10,
        opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [width * 0.4, 0] }) }],
      }}>
        <Line look={look} size={TV ? 13 : 11} weight={750} color={look.inkQuiet} style={{ letterSpacing: 1.6 }}>{msg('multiview.title').toUpperCase()}</Line>
        <Line look={look} size={TV ? 24 : 18} weight={700} lines={picking ? 1 : 2}>
          {shown.mode === 'add' ? msg('multiview.addChannel') : channel ? `${channel.number} · ${channel.name}` : ''}
        </Line>
        {picking ? null : tile ? (
          <View style={{ gap: TV ? 14 : 8, marginTop: TV ? 12 : 6 }}>
            {tile.refusal ? <PanelButton look={look} label={msg('multiview.tryAgain')} onPress={() => { controller.retry(tile.slot); onClose(); }} preferred /> : null}
            <PanelButton look={look} label={msg('multiview.changeChannel')} onPress={() => onMode('channels')} preferred={!tile.refusal} />
            <PanelButton look={look} label={view.fullscreen === tile.slot ? msg('multiview.backToGrid') : msg('multiview.fullScreen')}
              onPress={() => { controller.toggleFullscreen(tile.slot); onClose(); }} />
            {view.layout === 'feature' && view.tiles[0]?.slot !== tile.slot ? (
              <PanelButton look={look} label={msg('multiview.makeBig')} onPress={() => { controller.promote(tile.slot); onClose(); }} />
            ) : null}
            {view.tiles.length < view.maxTiles ? (
              <PanelButton look={look} label={msg('multiview.addChannel')} onPress={onAdd} />
            ) : null}
            {view.layouts.length > 1 ? <>
              <Line look={look} size={TV ? 13 : 11} weight={750} color={look.inkQuiet} style={{ letterSpacing: 1.6, marginTop: TV ? 14 : 8 }}>
                {msg('multiview.layout').toUpperCase()}
              </Line>
              <View style={{ flexDirection: 'row', gap: TV ? 12 : 8, flexWrap: 'wrap' }}>
                {view.layouts.map(layout => (
                  <PanelButton key={layout} look={look} label={msg(LAYOUT_LABEL[layout])} selected={layout === view.layout}
                    onPress={() => { controller.setLayout(layout); onClose(); }} />
                ))}
              </View>
            </> : null}
            <View style={{ height: TV ? 10 : 4 }} />
            <PanelButton look={look} label={msg('multiview.remove')} onPress={() => { controller.remove(tile.slot); onClose(); }} />
          </View>
        ) : null}
      </Animated.View>
      {picking ? (
        // A sibling of the sliding panel, placed by its edges: inside the natively moved panel the
        // list collapsed to nothing on tvOS. It fades with the panel.
        <Animated.View style={{ position: 'absolute', right: TV ? 40 : 20, width: width - (TV ? 80 : 40), top: TV ? 168 : 96, bottom: 0, opacity: progress }}>
          <ChannelList look={look} channels={channels} current={tile?.channelId ?? ''} taken={new Set(view.tiles.map(t => t.channelId))} onChoose={choose} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function ChannelList({ look, channels, current, taken, onChoose }: {
  look: GuideLook; channels: GuideChannel[]; current: string; taken: Set<string>; onChoose(id: string): void;
}) {
  const row = TV ? 104 : 64;
  const start = Math.max(0, channels.findIndex(channel => channel.id === current));
  // Rows are drawn a page at a time as the list scrolls toward its end, so a long lineup costs
  // nothing up front; the tile's own channel is in the first page.
  const [count, setCount] = useState(Math.min(channels.length, Math.max(40, start + 20)));
  const scroll = useRef<{ scrollTo(options: { y: number; animated: boolean }): void } | null>(null);
  const placed = useRef(false);
  return (
    <ScrollView
      ref={scroll as never}
      style={{ flex: 1, marginHorizontal: TV ? -14 : -6 }}
      contentContainerStyle={{ paddingVertical: TV ? 14 : 6, paddingHorizontal: TV ? 14 : 6 }}
      scrollEventThrottle={200}
      onLayout={() => {
        if (placed.current || start < 3 || TV) return;
        placed.current = true;
        scroll.current?.scrollTo({ y: Math.max(0, (start - 2) * row), animated: false });
      }}
      onScroll={event => {
        const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
        if (count < channels.length && contentOffset.y + layoutMeasurement.height > contentSize.height - row * 10) {
          setCount(value => Math.min(channels.length, value + 40));
        }
      }}
    >
      {channels.slice(0, count).map((item, index) => (
        <View key={item.id} style={{ height: row, paddingVertical: TV ? 6 : 3 }}>
          <Press label={item.name} onPress={() => onChoose(item.id)} hasTVPreferredFocus={index === start} lift={TV}
            style={({ focused, hovered }) => ({ height: row - (TV ? 12 : 6), flexDirection: 'row', alignItems: 'center', gap: TV ? 18 : 12, paddingHorizontal: TV ? 14 : 10,
              borderRadius: look.radiusCell, backgroundColor: focused ? look.ink : hovered ? look.cellHover : item.id === current ? look.live : 'transparent' })}>
            {({ focused }) => <>
              <LogoTile look={look} logo={item.logo} name={item.name} channelId={item.id} width={TV ? 104 : 64} height={TV ? 62 : 38} radius={TV ? 10 : 6} />
              <View style={{ flex: 1, gap: 2 }}>
                <Line look={look} size={TV ? 15 : 13} weight={700} color={focused ? look.inkInverse : look.ink}>{`${item.number} · ${item.name}`}</Line>
                {item.now ? <Line look={look} size={TV ? 13 : 11} color={focused ? alpha(look.inkInverse, 0.7) : look.inkSecondary}>{item.now}</Line> : null}
              </View>
              {taken.has(item.id) ? <PlayerIcon name="check" size={TV ? 26 : 16} color={focused ? look.inkInverse : look.accent} /> : null}
            </>}
          </Press>
        </View>
      ))}
    </ScrollView>
  );
}
