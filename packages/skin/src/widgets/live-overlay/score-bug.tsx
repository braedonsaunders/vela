// The score bug (widget): a compact broadcast-style strip for one live event, drawn by Vela over
// any picture. Away side, the score, home side, then the status: "NYG | 24 – 27 | PHI | Q4 · 2:14".
// Team colours underline each side, the side with the ball wears the accent dot, and a score that
// moves rolls to its new number while the strip flashes in the scoring side's colour. A finished
// game quiets the loser; a game to come shows its start; a field event (a race) shows its name,
// the lap and the leader. For a spoiler-free viewer the scores stay hidden behind Reveal.
//
// Three sizes: `full` over the live player, `tile` over a multiview tile, `compact` in a list.
// Give it the event, or its id to follow it on the live stream while mounted.
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { cubicBezier, type CSSAnimationProperties } from 'react-native-reanimated';
import { msg, type LiveEvent } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { isFocusVisible } from '../../focus-visible';
import { EASE_OUT } from '../../presence';
import { usePlayerLook, type PlayerLook } from '../player/look';
import { bugModel, scoreChange, type BugModel, type BugSide, type BugTone, type FieldBug, type VersusBug } from './model';

export type ScoreBugSize = 'compact' | 'tile' | 'full';

export interface ScoreBugProps {
  /** The event to draw. Its owner keeps it current. */
  event?: LiveEvent | null;
  /** Or the event's id: the bug follows it on the live stream while mounted. */
  eventId?: string;
  size?: ScoreBugSize;
  /** The player's look; read from the host when absent. */
  look?: PlayerLook;
  /** A spoiler-free event offers Reveal (`full` only; on TV only while this is true, so a hidden
   * player chrome never leaves a focus target over the picture). */
  revealable?: boolean;
  /** Draw the situation line under the strip (`full`, by default). */
  situation?: boolean;
  testID?: string;
}

/** Design sizes per variant, at the player's 1440 px scale. */
const METRICS = {
  full: { text: 15, score: 17, status: 13, padV: 7, padH: 12, logo: 22, gap: 8, bar: 3 },
  tile: { text: 12, score: 13, status: 11, padV: 4, padH: 8, logo: 16, gap: 6, bar: 2 },
  compact: { text: 11, score: 12, status: 10, padV: 3, padH: 7, logo: 0, gap: 5, bar: 2 },
} as const;

/** Follows an event on the live stream while mounted (none for an empty id). */
export function useFollowedEvent(id: string | undefined): LiveEvent | undefined {
  const vela = useVela();
  const event = useVelaState(state => (id ? state.liveEvents.events[id] : undefined));
  useEffect(() => (id ? vela.liveEvents.follow({ events: [id] }) : undefined), [vela, id]);
  return event;
}

export function ScoreBug(props: ScoreBugProps) {
  const hostLook = usePlayerLook();
  const look = props.look ?? hostLook;
  const followed = useFollowedEvent(props.event === undefined ? props.eventId : undefined);
  const event = props.event === undefined ? followed : props.event;
  const model = bugModel(event, props.size === 'full' || props.size === undefined ? 2 : 0);
  if (!model) return null;
  return <Bug {...props} look={look} model={model} />;
}

/** Counts each score change, so its animation runs once per goal and not on every render. */
function useScoreFlash(model: BugModel): { n: number; away: boolean; home: boolean } {
  const previous = useRef<BugModel | null>(null);
  const [flash, setFlash] = useState({ n: 0, away: false, home: false });
  useEffect(() => {
    const change = scoreChange(previous.current, model);
    previous.current = model;
    if (change.away || change.home) setFlash(f => ({ n: f.n + 1, ...change }));
  }, [model.kind === 'versus' ? `${model.eventId}|${model.away.score}|${model.home.score}|${model.spoiler}` : model.eventId]);
  return flash;
}

function Bug({ model, look, size = 'full', revealable, situation = size === 'full', testID }: ScoreBugProps & { model: BugModel; look: PlayerLook }) {
  const m = METRICS[size];
  const flash = useScoreFlash(model);
  const height = look.size(m.padV * 2 + m.score * 1.3);
  const radius = Math.min(look.radiusControl, look.size(size === 'full' ? 10 : 7), height / 2);
  const still = look.still;
  // The strip swells a touch as a score lands.
  // Its keyframes differ by a hair each time, so every goal runs it afresh without remounting the
  // strip (which would cut the numbers' roll short).
  const swell = (size === 'full' ? 1.06 : 1.04) + (flash.n % 2) * 0.0001;
  const pulse: CSSAnimationProperties | undefined = still || !flash.n ? undefined : {
    animationName: { '0%': { transform: [{ scale: 1 }] }, '22%': { transform: [{ scale: swell }] }, '100%': { transform: [{ scale: 1 }] } },
    animationDuration: 900,
    animationTimingFunction: cubicBezier(0.2, 0.7, 0.3, 1),
  };
  const label = accessibleLabel(model);
  return (
    <View testID={testID ?? 'score-bug'} style={{ alignItems: 'flex-start', gap: look.size(5) }} accessible accessibilityRole="text" accessibilityLabel={label}>
      <Animated.View style={[{
        flexDirection: 'row', alignItems: 'stretch', height, borderRadius: radius, overflow: 'hidden',
        shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: look.size(14), shadowOffset: { width: 0, height: look.size(4) },
        borderWidth: Platform.isTV ? 0 : 1, borderColor: '#ffffff14',
      } as ViewStyle, pulse]}>
        {model.kind === 'versus' ? <Versus model={model} look={look} size={size} flash={flash} height={height} /> : <Field model={model} look={look} size={size} />}
      </Animated.View>
      {situation && model.kind === 'versus' && model.situation.length ? <Situation model={model} look={look} radius={radius} /> : null}
      {model.spoiler && revealable !== undefined && size === 'full' ? <Reveal eventId={model.eventId} look={look} focusable={revealable} radius={radius} /> : null}
    </View>
  );
}

function accessibleLabel(model: BugModel): string {
  if (model.kind === 'field') return [model.title, model.status, model.leader].filter(Boolean).join(', ');
  const { away, home } = model;
  if (model.spoiler || away.score === undefined || home.score === undefined) return [`${away.name} ${msg('liveOverlay.versus')} ${home.name}`, model.status].filter(Boolean).join(', ');
  return `${away.name} ${away.score}, ${home.name} ${home.score}, ${model.status}`;
}

const glass = '#0b0f1ad9';

function Versus({ model, look, size, flash, height }: { model: VersusBug; look: PlayerLook; size: ScoreBugSize; flash: { n: number; away: boolean; home: boolean }; height: number }) {
  const m = METRICS[size];
  const scored = flash.away ? model.away : flash.home ? model.home : null;
  const scores = !model.spoiler && model.away.score !== undefined && model.home.score !== undefined;
  return (
    <>
      <Team side={model.away} look={look} size={size} lit={flash.away ? flash.n : 0} />
      {scores ? (
        <View style={{ backgroundColor: look.ink, paddingHorizontal: look.size(m.padH), flexDirection: 'row', alignItems: 'center', gap: look.size(size === 'full' ? 8 : 5) }}>
          {flash.n > 0 && scored && !look.still ? (
            <Animated.View key={`flash-${flash.n}`} pointerEvents="none" style={{
              position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: scored.color ?? look.accent,
              animationName: { '0%': { opacity: 0 }, '14%': { opacity: 0.95 }, '100%': { opacity: 0 } },
              animationDuration: 1400, animationTimingFunction: 'ease-out', animationFillMode: 'both',
            } as ViewStyle} />
          ) : null}
          <Rolling value={model.away.score!} look={look} style={scoreText(look, m.score, model.away.loser)} height={height} />
          <Text style={scoreText(look, m.score, false)}>–</Text>
          <Rolling value={model.home.score!} look={look} style={scoreText(look, m.score, model.home.loser)} height={height} />
        </View>
      ) : (
        <View style={{ backgroundColor: glass, paddingHorizontal: look.size(m.padH * 0.5), justifyContent: 'center' }}>
          <Text style={[look.text(m.status, 600, look.inkQuiet), { textTransform: 'lowercase' }]}>{model.tone === 'upcoming' ? '@' : msg('liveOverlay.versus')}</Text>
        </View>
      )}
      <Team side={model.home} look={look} size={size} lit={flash.home ? flash.n : 0} trailing />
      <Status tone={model.tone} text={model.spoiler && model.tone !== 'upcoming' ? msg(model.tone === 'live' ? 'liveOverlay.live' : 'liveOverlay.final') : model.status} look={look} size={size} />
    </>
  );
}

function scoreText(look: PlayerLook, px: number, quiet: boolean): TextStyle {
  return { ...look.text(px, 800, look.inkInverse), fontVariant: ['tabular-nums'], opacity: quiet ? 0.55 : 1, letterSpacing: look.size(0.3) };
}

/** One side: its crest and abbreviation over its colour, with the ball when it has it. */
function Team({ side, look, size, lit, trailing }: { side: BugSide; look: PlayerLook; size: ScoreBugSize; lit: number; trailing?: boolean }) {
  const m = METRICS[size];
  const logo = m.logo ? look.size(m.logo) : 0;
  const crest = logo ? (side.logo
    ? <Image source={{ uri: side.logo }} style={{ width: logo, height: logo }} contentFit="contain" transition={160} accessible={false} />
    : <View style={{ width: logo * 0.62, height: logo * 0.62, borderRadius: logo, backgroundColor: side.color ?? look.inkQuiet }} />) : null;
  const ball = side.possession
    ? <View accessibilityLabel={msg('liveOverlay.possession')} style={{ width: look.size(6), height: look.size(6), borderRadius: look.size(3), backgroundColor: look.accent }} />
    : null;
  return (
    <View style={{ backgroundColor: glass, flexDirection: 'row', alignItems: 'center', gap: look.size(m.gap * 0.75), paddingHorizontal: look.size(m.padH) }}>
      {lit > 0 && side.color && !look.still ? (
        <Animated.View key={`lit-${lit}`} pointerEvents="none" style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: side.color,
          animationName: { '0%': { opacity: 0 }, '18%': { opacity: 0.85 }, '100%': { opacity: 0 } },
          animationDuration: 1600, animationTimingFunction: 'ease-out', animationFillMode: 'both',
        } as ViewStyle} />
      ) : null}
      {trailing ? ball : crest}
      <Text numberOfLines={1} style={[look.text(m.text, 750, look.ink), { opacity: side.loser ? 0.6 : 1, letterSpacing: look.size(0.4) }]}>{side.abbr}</Text>
      {trailing ? crest : ball}
      {side.color ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: look.size(m.bar), backgroundColor: side.color }} /> : null}
    </View>
  );
}

/** The status cap: red and breathing while live, quiet otherwise. */
function Status({ tone, text, look, size }: { tone: BugTone; text: string; look: PlayerLook; size: ScoreBugSize }) {
  const m = METRICS[size];
  if (!text) return null;
  const live = tone === 'live';
  const dot = look.size(size === 'full' ? 7 : 5);
  return (
    <View style={{ backgroundColor: live ? look.live : tone === 'final' ? '#1d222bdd' : glass, flexDirection: 'row', alignItems: 'center', gap: look.size(6), paddingHorizontal: look.size(m.padH) }}>
      {live ? <Animated.View style={[{ width: dot, height: dot, borderRadius: dot, backgroundColor: '#ffffff' }, look.still ? null : breathe]} /> : null}
      <Text numberOfLines={1} style={[look.text(m.status, 700, live ? '#ffffff' : tone === 'final' ? look.ink : look.inkSecondary), { fontVariant: ['tabular-nums'], letterSpacing: look.size(0.3) }]}>{text}</Text>
    </View>
  );
}

const breathe: CSSAnimationProperties = {
  animationName: { '50%': { opacity: 0.3 } },
  animationDuration: 1400,
  animationIterationCount: 'infinite',
  animationTimingFunction: cubicBezier(0.45, 0, 0.55, 1),
};

function Field({ model, look, size }: { model: FieldBug; look: PlayerLook; size: ScoreBugSize }) {
  const m = METRICS[size];
  const name = [model.league, model.title].filter(Boolean).join(' · ');
  return (
    <>
      <View style={{ backgroundColor: glass, justifyContent: 'center', paddingHorizontal: look.size(m.padH) }}>
        <Text numberOfLines={1} style={look.text(m.text, 700, look.ink)}>{name}</Text>
      </View>
      {model.status ? (
        <View style={{ backgroundColor: look.ink, justifyContent: 'center', paddingHorizontal: look.size(m.padH) }}>
          <Text numberOfLines={1} style={[look.text(m.score - 1, 800, look.inkInverse), { fontVariant: ['tabular-nums'] }]}>{model.status}</Text>
        </View>
      ) : null}
      <Status tone={model.tone} text={model.leader || (model.tone === 'live' ? msg('liveOverlay.live') : model.tone === 'final' ? msg('liveOverlay.final') : '')} look={look} size={size} />
    </>
  );
}

/** A number that rolls up to its next value: the old one rises out as the new one rises in. */
export function Rolling({ value, look, style, height }: { value: string; look: PlayerLook; style: TextStyle; height: number }) {
  const [shown, setShown] = useState({ value, previous: undefined as string | undefined, n: 0 });
  if (shown.value !== value) setShown(s => ({ value, previous: s.value, n: s.n + 1 }));
  useEffect(() => {
    if (shown.previous === undefined) return;
    const timer = setTimeout(() => setShown(s => (s.n === shown.n ? { ...s, previous: undefined } : s)), ROLL_MS + 60);
    return () => clearTimeout(timer);
  }, [shown.n]);
  const rolling = shown.n > 0 && !look.still;
  const travel = Math.round(height * 0.7);
  return (
    <View style={{ overflow: 'hidden', alignItems: 'center' }}>
      <Animated.View key={`in-${shown.n}`} style={rolling ? {
        animationName: { from: { opacity: 0, transform: [{ translateY: travel }] }, to: { opacity: 1, transform: [{ translateY: 0 }] } },
        animationDuration: ROLL_MS, animationTimingFunction: EASE_OUT, animationFillMode: 'both',
      } as ViewStyle : undefined}>
        <Text style={style}>{shown.value}</Text>
      </Animated.View>
      {rolling && shown.previous !== undefined ? (
        <Animated.View key={`out-${shown.n}`} pointerEvents="none" style={{
          position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center',
          animationName: { from: { opacity: 1, transform: [{ translateY: 0 }] }, to: { opacity: 0, transform: [{ translateY: -travel }] } },
          animationDuration: ROLL_MS, animationTimingFunction: EASE_OUT, animationFillMode: 'both',
        } as ViewStyle}>
          <Text style={style}>{shown.previous}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
const ROLL_MS = 520;

/** The line under the strip: "DOWN 3rd & 6 · BALL NYG 38". */
function Situation({ model, look, radius }: { model: VersusBug; look: PlayerLook; radius: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(10), paddingHorizontal: look.size(10), paddingVertical: look.size(4), borderRadius: radius, backgroundColor: glass }}>
      {model.situation.map(({ label, value }) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'baseline', gap: look.size(5) }}>
          <Text style={[look.text(10, 700, look.inkQuiet), { textTransform: 'uppercase', letterSpacing: look.size(1) }]}>{label}</Text>
          <Text style={[look.text(12, 600, look.ink), { fontVariant: ['tabular-nums'] }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/** "Scores hidden" with a press to reveal this one event's score. */
function Reveal({ eventId, look, focusable, radius }: { eventId: string; look: PlayerLook; focusable: boolean; radius: number }) {
  const vela = useVela();
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const tv = Platform.isTV;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={msg('liveOverlay.revealScore')}
      testID="score-bug-reveal"
      focusable={!tv || focusable}
      disabled={busy}
      onPress={() => { setBusy(true); void vela.liveEvents.reveal(eventId).catch(() => undefined).finally(() => setBusy(false)); }}
      onFocus={event => setFocus(isFocusVisible(event.currentTarget))}
      onBlur={() => setFocus(false)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: look.size(8), paddingHorizontal: look.size(10), paddingVertical: look.size(5),
        borderRadius: radius, backgroundColor: focus && tv ? look.ink : glass,
        outlineColor: look.accent, outlineStyle: 'solid', outlineWidth: focus ? (tv ? look.size(3) : 2) : 0, outlineOffset: tv ? look.size(2) : 0,
        transform: [{ scale: focus && tv && !look.still ? 1.06 : 1 }],
      } as ViewStyle}
    >
      <Text style={look.text(12, 500, focus && tv ? look.inkInverse : look.inkSecondary)}>{msg('liveOverlay.scoresHidden')}</Text>
      <Text style={look.text(12, 700, focus && tv ? look.inkInverse : look.accent)}>{busy ? '…' : msg('liveOverlay.reveal')}</Text>
    </Pressable>
  );
}
