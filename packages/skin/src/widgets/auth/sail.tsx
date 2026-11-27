// The Vela mark as the sign-in's hero, drawn rather than shown: each sail's outline traces from
// the keel, the cloth fills in behind it, and the outline lifts away. Its reflection on the water,
// and the wordmark written letter by letter. Every animation is a finite Reanimated timing on the
// UI thread (no JS loop); under reduced motion everything is simply there.
import { useEffect } from 'react';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The symbol's two sails (apps/vela/assets/brand/vela-symbol.svg) and their outline lengths. */
/** In the file's order: the tan sail behind, the cream one over it. The cream draws first. */
const SAILS = [
  { d: 'M38 8H55L36.8 50.8 32.4 57.6Z', length: 121.6, light: '#dcb998', paper: '#a65b38', delay: 380 },
  { d: 'M9 8H26.4L41 57.6H32.4Z', length: 132.6, light: '#f5f1e9', paper: '#111419', delay: 120 },
];
export const SAIL_VIEWBOX = { x: 9, y: 8, width: 46, height: 49.6 };
export const SAIL_ASPECT = SAIL_VIEWBOX.width / SAIL_VIEWBOX.height;

const TRACE_MS = 1050;
const FILL_DELAY = 720;
/** When the mark has finished drawing: the step's content and the breath start after it. */
export const SAIL_DRAWN_MS = 1500;

function useProgress(play: boolean, delay: number, duration: number, easing = Easing.inOut(Easing.cubic)) {
  const value = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play) value.value = withDelay(delay, withTiming(1, { duration, easing }));
  }, []);
  return value;
}

function TracedSail({ d, length, colour, trace, fill, lift }: { d: string; length: number; colour: string; trace: SharedValue<number>; fill: SharedValue<number>; lift: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - trace.value),
    strokeOpacity: trace.value > 0.002 ? 1 - lift.value : 0,
    fillOpacity: fill.value,
  }));
  return <AnimatedPath d={d} fill={colour} stroke={colour} strokeWidth={0.55} strokeLinejoin="round"
    strokeDasharray={[length, length]} animatedProps={props} />;
}

/** The symbol at `height` points, drawing itself once when `draw` is set. */
export function SailMark({ height, draw, paper = false }: { height: number; draw: boolean; paper?: boolean }) {
  const traces = [useProgress(draw, SAILS[0]!.delay, TRACE_MS), useProgress(draw, SAILS[1]!.delay, TRACE_MS)];
  const fill = useProgress(draw, FILL_DELAY, 680, Easing.out(Easing.cubic));
  const lift = useProgress(draw, FILL_DELAY + 420, 520, Easing.out(Easing.quad));
  const { x, y, width, height: h } = SAIL_VIEWBOX;
  return (
    <Svg width={height * SAIL_ASPECT} height={height} viewBox={`${x} ${y} ${width} ${h}`}>
      {SAILS.map((sail, i) => (
        <TracedSail key={sail.d} d={sail.d} length={sail.length} colour={paper ? sail.paper : sail.light} trace={traces[i]!} fill={fill} lift={lift} />
      ))}
    </Svg>
  );
}

/** The mark upside down on the water, fading with depth; the scene ripples it. */
export function SailReflection({ height, paper = false, strength = 0.26 }: { height: number; paper?: boolean; strength?: number }) {
  const { x, y, width, height: h } = SAIL_VIEWBOX;
  return (
    <Svg width={height * SAIL_ASPECT} height={height} viewBox={`${x} ${y} ${width} ${h}`} style={{ transform: [{ scaleY: -1 }] }}>
      <Defs>
        {SAILS.map((sail, i) => (
          // Mirrored: the gradient's end (y2, the keel) is the top of the drawn reflection.
          <LinearGradient key={i} id={`vela-reflect-${i}`} x1="0" y1={String(y)} x2="0" y2={String(y + h)} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={paper ? sail.paper : sail.light} stopOpacity={0} />
            <Stop offset="0.55" stopColor={paper ? sail.paper : sail.light} stopOpacity={strength * 0.35} />
            <Stop offset="1" stopColor={paper ? sail.paper : sail.light} stopOpacity={strength} />
          </LinearGradient>
        ))}
      </Defs>
      {SAILS.map((sail, i) => <Path key={sail.d} d={sail.d} fill={`url(#vela-reflect-${i})`} />)}
    </Svg>
  );
}

/** The wordmark's strokes (vela-lockup.svg), one per pen movement, with their lengths. */
const LETTERS = [
  { d: 'M0 36L26 100L52 36', length: 138.2 },
  { d: 'M72 68H136A32 32 0 1 0 128.51 88.57', length: 242.7 },
  { d: 'M156 0V100', length: 100 },
  { d: 'M240 68A32 32 0 1 0 176 68A32 32 0 1 0 240 68', length: 201.1 },
  { d: 'M240 36V100', length: 64 },
];
const WORDMARK_VIEWBOX = '-7 -7 254 114';
export const WORDMARK_ASPECT = 254 / 114;

function Stroke({ d, length, progress, colour }: { d: string; length: number; progress: SharedValue<number>; colour: string }) {
  const props = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - progress.value),
    // A round cap draws a dot even for an empty dash: nothing until the pen touches down.
    strokeOpacity: progress.value > 0.002 ? 1 : 0,
  }));
  return <AnimatedPath d={d} fill="none" stroke={colour} strokeWidth={12.5} strokeLinecap="round" strokeLinejoin="round"
    strokeDasharray={[length, length]} animatedProps={props} />;
}

/** "vela", written stroke by stroke after `delay` when `write` is set. */
export function Wordmark({ height, write, delay = 0, colour = '#f5f1e9' }: { height: number; write: boolean; delay?: number; colour?: string }) {
  // Each stroke starts as the one before it is two thirds done: one continuous hand.
  const starts = [0, 260, 600, 760, 1080];
  const durations = [420, 520, 260, 480, 240];
  const strokes = LETTERS.map((_, i) => useProgress(write, delay + starts[i]!, durations[i]!, Easing.inOut(Easing.quad)));
  return (
    <Svg width={height * WORDMARK_ASPECT} height={height} viewBox={WORDMARK_VIEWBOX}>
      {LETTERS.map((letter, i) => <Stroke key={letter.d} d={letter.d} length={letter.length} progress={strokes[i]!} colour={colour} />)}
    </Svg>
  );
}
