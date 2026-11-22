// The scores ticker: a band along the bottom of the live player that runs the server's ticker
// (`/live/ticker`) right to left, endlessly, at reading speed: "● LIVE NFL NYG 24 PHI 27 Q4 · 2:14".
// The events follow the live stream while it shows, so scores move in place and a goal rolls in
// the scorer's number. The run advances on the UI thread (a frame callback) and a run that grows
// or shrinks as scores change carries on where it was. Under reduced motion it stands still.
// Nothing in it takes focus: the band is information, its toggle lives in the player's controls.
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { msg } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { MOTION, Presence } from '../../presence';
import type { PlayerLook } from '../player/look';
import { marqueeScrolls, marqueeStep, tickerItems, type TickerItem } from './model';
import { Rolling } from './score-bug';

/** Reading speed, in design points a second. */
const SPEED = 64;
/** The ticker's list is read again this often while it shows (new games start, old ones drop). */
const REFRESH_MS = 5 * 60_000;

/** The band's height for a look, so the player can lift what sits on its edge. */
export function tickerHeight(look: PlayerLook): number {
  return look.small ? 30 : look.size(36);
}

export function LiveTicker({ look, shown }: { look: PlayerLook; shown: boolean }) {
  return (
    <Presence shown={shown} still={look.still} offstage={{ y: tickerHeight(look) }} exitMs={MOTION.exit}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
      <Band look={look} />
    </Presence>
  );
}

/** The ticker's screen: the first plugin screen bootstrap lists, else the server's default. */
function useTickerScreen(): string {
  return useVelaState(state => state.home.value?.screens?.[0]?.id ?? '');
}

function Band({ look }: { look: PlayerLook }) {
  const vela = useVela();
  const screen = useTickerScreen();
  const ticker = useVelaState(state => state.liveEvents.ticker[screen]);
  const events = useVelaState(state => state.liveEvents.events);
  const ids = ticker?.value;
  const items = useMemo(() => tickerItems(ids, events), [ids, events]);
  useEffect(() => {
    void vela.liveEvents.loadTicker(screen);
    const timer = setInterval(() => void vela.liveEvents.loadTicker(screen), REFRESH_MS);
    return () => clearInterval(timer);
  }, [vela, screen]);
  const followKey = (ids ?? []).join(',');
  useEffect(() => (ids?.length ? vela.liveEvents.follow({ events: ids }) : undefined), [vela, followKey]);
  const height = tickerHeight(look);
  return (
    <View testID="live-ticker" accessibilityRole="summary" accessibilityLabel={msg('liveOverlay.ticker')}
      style={{ height, flexDirection: 'row', alignItems: 'center', backgroundColor: '#05070de0', borderTopWidth: 1, borderTopColor: '#ffffff12' }}>
      <View style={{ height, flexDirection: 'row', alignItems: 'center', gap: look.size(8), paddingLeft: look.gutter, paddingRight: look.size(14), backgroundColor: '#05070d' }}>
        <View style={{ width: look.size(3), height: height * 0.5, borderRadius: look.size(2), backgroundColor: look.accent }} />
        <Text style={[look.text(11, 800, look.ink), { letterSpacing: look.size(1.6), textTransform: 'uppercase' }]}>{msg('liveOverlay.scores')}</Text>
      </View>
      {items.length ? <Run items={items} look={look} height={height} /> : (
        <Text style={[look.text(13, 500, look.inkQuiet), { paddingHorizontal: look.size(12) }]}>
          {ticker?.load === 'failed' ? msg('liveOverlay.tickerUnavailable') : ticker?.value ? msg('liveOverlay.noGames') : ''}
        </Text>
      )}
    </View>
  );
}

function Run({ items, look, height }: { items: TickerItem[]; look: PlayerLook; height: number }) {
  const offset = useSharedValue(0);
  const width = useSharedValue(0);
  const [measured, setMeasured] = useState({ content: 0, viewport: 0 });
  const scrolls = !look.still && marqueeScrolls(measured.content, measured.viewport);
  const speed = look.size(SPEED);
  const frames = useFrameCallback(frame => {
    offset.value = marqueeStep(offset.value, frame.timeSincePreviousFrame ?? 0, speed, width.value);
  }, false);
  useEffect(() => {
    frames.setActive(scrolls);
    if (!scrolls) offset.value = 0;
  }, [scrolls]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -offset.value }] }));
  const onCopy = (event: LayoutChangeEvent) => {
    const content = Math.round(event.nativeEvent.layout.width);
    width.value = content;
    setMeasured(m => (m.content === content ? m : { ...m, content }));
  };
  const onViewport = (event: LayoutChangeEvent) => {
    const viewport = Math.round(event.nativeEvent.layout.width);
    setMeasured(m => (m.viewport === viewport ? m : { ...m, viewport }));
  };
  const fade = look.size(28);
  return (
    <View style={{ flex: 1, height, overflow: 'hidden', justifyContent: 'center' }} onLayout={onViewport}>
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', position: 'absolute', left: 0, top: 0, bottom: 0 }, style]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }} onLayout={onCopy}>
          {items.map(item => <Item key={item.id} item={item} look={look} height={height} />)}
        </View>
        {/* The second copy takes over as the first leaves, so the run never shows a gap. */}
        {scrolls ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {items.map(item => <Item key={item.id} item={item} look={look} height={height} />)}
          </View>
        ) : null}
      </Animated.View>
      <LinearGradient pointerEvents="none" colors={['#05070d', '#05070d00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fade }} />
      <LinearGradient pointerEvents="none" colors={['#05070d00', '#05070d']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: fade }} />
    </View>
  );
}

function Item({ item, look, height }: { item: TickerItem; look: PlayerLook; height: number }) {
  const { bug } = item;
  const tag = item.tone === 'live' ? msg('liveOverlay.live') : item.tone === 'final' ? msg('liveOverlay.final') : '';
  const score = (value: string | undefined, quiet: boolean) => value === undefined ? null
    : <Rolling value={value} look={look} height={height} style={{ ...look.text(13, 800, look.ink), fontVariant: ['tabular-nums'], opacity: quiet ? 0.6 : 1 }} />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(7), paddingHorizontal: look.size(16), height }}>
      {tag ? <Text style={[look.text(11, 800, item.tone === 'live' ? look.live : look.inkQuiet), { letterSpacing: look.size(0.8) }]}>{tag}</Text> : null}
      {item.league ? <Text style={[look.text(11, 700, look.inkQuiet), { letterSpacing: look.size(0.6) }]}>{item.league}</Text> : null}
      {bug.kind === 'versus' ? (
        <>
          <Abbr look={look} color={bug.away.color} text={bug.away.abbr} quiet={bug.away.loser} strong={bug.away.winner} />
          {score(bug.away.score, bug.away.loser)}
          <Abbr look={look} color={bug.home.color} text={bug.home.abbr} quiet={bug.home.loser} strong={bug.home.winner} />
          {score(bug.home.score, bug.home.loser)}
          {bug.spoiler && bug.tone !== 'upcoming' ? <Text style={look.text(12, 500, look.inkQuiet)}>{msg('liveOverlay.scoresHidden')}</Text> : null}
        </>
      ) : (
        <>
          <Text style={look.text(13, 650, look.ink)}>{bug.title}</Text>
          {bug.leader ? <Text style={look.text(13, 800, look.ink)}>{bug.leader}</Text> : null}
        </>
      )}
      {bug.status && !(bug.tone === 'final' && tag) ? (
        <Text style={[look.text(12, 500, look.inkSecondary), { fontVariant: ['tabular-nums'] }]}>{bug.status}</Text>
      ) : null}
      <View style={{ width: 1, height: height * 0.42, marginLeft: look.size(16), backgroundColor: '#ffffff26' }} />
    </View>
  );
}

function Abbr({ look, color, text, quiet, strong }: { look: PlayerLook; color?: string; text: string; quiet: boolean; strong: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(5), opacity: quiet ? 0.6 : 1 }}>
      {color ? <View style={{ width: look.size(4), height: look.size(14), borderRadius: look.size(2), backgroundColor: color }} /> : null}
      <Text style={[look.text(13, strong ? 800 : 650, look.ink), { letterSpacing: look.size(0.3) }]}>{text}</Text>
    </View>
  );
}
