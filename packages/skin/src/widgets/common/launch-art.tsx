// The approved searchlight ident. Nested translation frames put each motor's origin
// at the beam's foot. Only standard View rotation and opacity animate, on the native
// UI thread; the SVG paths, viewport and lighting remain static.
import { StyleSheet, View } from 'react-native';
import Animated, { cubicBezier, steps, type CSSAnimationKeyframes, type CSSAnimationProperties } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { searchlightGeometry } from './searchlight-geometry';

const IVORY = 'M9 8H26.4L41 57.6H32.4Z';
const AMBER = 'M38 8H55L36.8 50.8 32.4 57.6Z';
const LETTERS = ['M0 36L26 100L52 36', 'M72 68H136A32 32 0 1 0 128.51 88.57', 'M156 0V100', 'M240 68A32 32 0 1 0 176 68A32 32 0 1 0 240 68M240 36V100'];
const accelerate = cubicBezier(0.11, 0, 0.5, 0);
const decelerate = cubicBezier(0.5, 1, 0.89, 1);
function sweep(direction: number): CSSAnimationKeyframes {
  const points: [string, number, 'linear' | typeof accelerate][] = [
    ['0%',20,'linear'], ['15.54%',20,accelerate], ['19.4%',17.36,'linear'],
    ['43.81%',-17.36,decelerate], ['47.67%',-20,'linear'], ['49.74%',-20,accelerate],
    ['53.6%',-17.36,'linear'], ['78.01%',17.36,decelerate], ['81.87%',20,'linear'],
    ['83.94%',20,accelerate], ['85.87%',18.68,'linear'], ['98.88%',0.77,decelerate], ['100%',0,'linear'],
  ];
  return Object.fromEntries(points.map(([at, angle, easing]) => [at, { transform: [{ rotate: `${angle * direction}deg` }], animationTimingFunction: easing }]));
}
const sweepLight = sweep(1), sweepShadow = sweep(-1);
const power = { '0%': { opacity: 0 }, '18%': { opacity: 1 }, '30%': { opacity: 0.15 }, '42%': { opacity: 1 }, '58%': { opacity: 0.35 }, '70%': { opacity: 1 }, '100%': { opacity: 1 } };
const bulb = { '0%': { opacity: 0 }, '30%': { opacity: 1 }, '45%': { opacity: 0.25 }, '60%': { opacity: 1 }, '100%': { opacity: 1 } };
const lock = { '0%': { opacity: 0 }, '12%': { opacity: 0.5 }, '100%': { opacity: 0 } };
function animation(name: CSSAnimationKeyframes, duration: number, delay = 0, stepped = false): CSSAnimationProperties {
  return { animationName: name, animationDuration: duration, animationDelay: delay, animationFillMode: 'both', animationTimingFunction: stepped ? steps(1, 'end') : 'linear' };
}

export function LaunchArt({ width, height, still, compact = false, ink = '#f5f1e9', accent = '#dcb998' }: { width: number; height: number; still: boolean; compact?: boolean; ink?: string; accent?: string }) {
  const g = searchlightGeometry(width, height);
  const beam = (shadow: boolean) => {
    const x = shadow ? 34.6 : 36.7, y = shadow ? 54.2 : 57.6;
    const px = (x + 12) * g.scale + g.offsetX, py = (y - 2) * g.scale + g.offsetY;
    const path = shadow ? AMBER : IVORY;
    const vector = (flash: boolean) => <Svg width={g.markWidth} height={g.markHeight} viewBox="-12 2 88 55.8" style={{ overflow: 'visible' }}><Path d={path} fill={flash ? '#fff' : shadow ? accent : ink}/></Svg>;
    return <View key={String(shadow)} style={{ position: 'absolute', left: px, top: py, width: 0, height: 0 }}>
      <Animated.View testID={shadow ? 'launch-shadow' : 'launch-light'} style={[{ width: 0, height: 0, transformOrigin: [0, 0, 0] }, !still && { ...animation(shadow ? sweepShadow : sweepLight, 1930), ...(compact ? { animationIterationCount: 'infinite' as const, animationDirection: 'alternate' as const } : {}) }]}>
        <View style={{ position: 'absolute', left: -px, top: -py, width: g.markWidth, height: g.markHeight }}>
          <Animated.View testID="launch-lamp" style={[StyleSheet.absoluteFill, !still && !compact && animation(power, 300, 0, true)]}>{vector(false)}</Animated.View>
          {!still && !compact && <Animated.View testID="launch-flash" style={[StyleSheet.absoluteFill, { ...animation(lock, 420, 1930), animationTimingFunction: 'ease-out' }]}>{vector(true)}</Animated.View>}
        </View>
      </Animated.View>
    </View>;
  };
  return <View testID="launch-ident" style={{ alignItems: 'center', gap: 22 }}>
    <View testID="launch-mark" style={{ width: g.markWidth, height: g.markHeight, overflow: 'visible' }}>{beam(true)}{beam(false)}</View>
    {!compact && <View testID="launch-word" style={{ width: g.wordWidth, height: g.wordHeight }}>
      {LETTERS.map((path, i) => <Animated.View key={path} testID={`launch-bulb-${i}`} style={[StyleSheet.absoluteFill, !still && animation(bulb, 260, 1990 + i * 90, true)]}>
        <Svg width="100%" height="100%" viewBox="-6.25 -6.25 252.5 112.5"><Path d={path} fill="none" stroke="#f5f1e9" strokeWidth={12.5} strokeLinecap="round" strokeLinejoin="round"/></Svg>
      </Animated.View>)}
    </View>}
  </View>;
}
