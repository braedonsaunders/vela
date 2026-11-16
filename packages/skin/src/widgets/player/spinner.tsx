// The one spinner: a faint ring with a travelling arc and a breathing dot in the accent. It has
// no text; screen readers hear what the engine is doing. The chrome keeps one mounted from the
// press of Play through every waiting phase, so the arc never restarts.
import { View } from 'react-native';
import Animated, { cubicBezier, type CSSAnimationProperties } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import type { PlayerLook } from './look';

const turn = { from: { transform: [{ rotate: '0deg' }] }, to: { transform: [{ rotate: '360deg' }] } };
const breath = { '50%': { opacity: 0.45 } };

export function Spinner({ look, size, label }: { look: PlayerLook; size: number; label?: string }) {
  const dot = Math.max(4, Math.round(size / 8));
  const spin: CSSAnimationProperties | undefined = look.still ? undefined : {
    animationName: turn,
    animationDuration: '1.1s',
    animationIterationCount: 'infinite',
    animationTimingFunction: cubicBezier(0.5, 0.15, 0.5, 0.85),
  };
  const breathe: CSSAnimationProperties | undefined = look.still ? undefined : {
    animationName: breath,
    animationDuration: '1.6s',
    animationIterationCount: 'infinite',
    animationTimingFunction: cubicBezier(0.45, 0, 0.55, 1),
  };
  return (
    <View accessibilityRole={label ? 'progressbar' : undefined} accessibilityLabel={label}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 48 48" style={{ position: 'absolute' }}>
        <Circle cx={24} cy={24} r={21} fill="none" stroke={look.track} strokeWidth={2.5} />
      </Svg>
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, spin]}>
        <Svg width={size} height={size} viewBox="0 0 48 48">
          <Circle cx={24} cy={24} r={21} fill="none" stroke={look.ink} strokeWidth={2.5} strokeLinecap="round"
            strokeDasharray="34 98" />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: look.accent }, breathe]} />
    </View>
  );
}
