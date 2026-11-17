// A single launch per cold session. All moving layers are cached SVGs animated with
// transforms/opacity by Reanimated; no SVG filter, path mutation or per-frame JS.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { cubicBezier, useReducedMotion, type CSSAnimationKeyframes, type CSSAnimationProperties } from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { launchSession, type LaunchState } from './launch-state';

const ease = cubicBezier(0.22, 0.68, 0, 1);
const fadeIn = { from: { opacity: 0 }, to: { opacity: 1 } };
const fadeOut = { from: { opacity: 1 }, to: { opacity: 0 } };
const longSweep = { from: { opacity: 0, transform: [{ translateY: -36 }, { scaleY: 0.82 }] }, to: { opacity: 1, transform: [{ translateY: 0 }, { scaleY: 1 }] } };
const amberSweep = { from: { opacity: 0, transform: [{ translateY: -48 }, { translateX: 12 }] }, to: { opacity: 1, transform: [{ translateY: 0 }, { translateX: 0 }] } };
const settle = { from: { opacity: 0, transform: [{ translateY: 10 }] }, to: { opacity: 1, transform: [{ translateY: 0 }] } };
const lift = { from: { transform: [{ translateY: -12 }, { scale: 1 }] }, to: { transform: [{ translateY: -36 }, { scale: 0.97 }] } };
const breathe = { '0%, 100%': { opacity: 0.87, transform: [{ scale: 1 }] }, '50%': { opacity: 1, transform: [{ scale: 1.018 }] } };
const drift = { from: { transform: [{ translateX: -12 }, { translateY: -8 }, { scale: 1 }] }, to: { transform: [{ translateX: 14 }, { translateY: 12 }, { scale: 1.05 }] } };
function animation(name: CSSAnimationKeyframes, duration: number, delay = 0): CSSAnimationProperties {
  return { animationName: name, animationDuration: duration, animationDelay: delay, animationTimingFunction: ease, animationFillMode: 'both' };
}
const loop = (name: CSSAnimationKeyframes, duration: number, delay = 0): CSSAnimationProperties =>
  ({ ...animation(name, duration, delay), animationIterationCount: 'infinite', animationDirection: 'alternate' });

export function LaunchGate({ signedIn, ready, children }: { signedIn: boolean; ready: boolean; children: ReactNode }) {
  const still = useReducedMotion();
  const [state, setState] = useState<LaunchState>({ signedIn, stage: 'intro', run: 0 });
  const current = launchSession(state, signedIn);
  // Adjust before React commits: a new sign-in cannot flash home's skeletons first.
  if (current !== state) setState(current);
  const visible = current.stage !== 'done';
  return <View style={styles.root}>
    <Animated.View pointerEvents={visible ? 'none' : 'auto'} accessibilityElementsHidden={visible}
      importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}
      style={[styles.root, { opacity: visible ? 0 : 1 }, current.stage === 'exit' && animation(fadeIn, 700)]}>
      {children}
    </Animated.View>
    {visible && <LaunchCover key={current.run} ready={ready} still={still} exiting={current.stage === 'exit'}
      onExit={() => setState(s => ({ ...s, stage: 'exit' }))} onDone={() => setState(s => ({ ...s, stage: 'done' }))} />}
  </View>;
}
function LaunchCover({ ready, still, exiting, onExit, onDone }: { ready: boolean; still: boolean; exiting: boolean; onExit(): void; onDone(): void }) {
  const { width, height } = useWindowDimensions();
  const started = useRef(Date.now());
  const callbacks = useRef({ onExit, onDone });
  callbacks.current = { onExit, onDone };
  useEffect(() => {
    if (!ready) return;
    // A fast answer completes the entire gesture; a slow answer hands off immediately.
    const delay = Math.max(0, (still ? 0 : 1200) - (Date.now() - started.current));
    const exit = setTimeout(() => callbacks.current.onExit(), delay);
    const done = setTimeout(() => callbacks.current.onDone(), delay + 700);
    return () => { clearTimeout(exit); clearTimeout(done); };
  }, [ready, still]);
  const size = Math.min(width * 0.25, height * 0.2, 184);
  return <Animated.View testID="vela-launch" accessibilityRole="progressbar" accessibilityLabel="Vela is loading"
    accessibilityViewIsModal style={[styles.cover, exiting && animation(fadeOut, 700)]}>
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -48, bottom: -48, left: -48, right: -48 }, !still && loop(drift, 16000)]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="launch-amber" cx="0%" cy="0%" rx="85%" ry="85%"><Stop offset="0" stopColor="#c0703f" stopOpacity={0.42}/><Stop offset="1" stopColor="#c0703f" stopOpacity={0}/></RadialGradient>
          <RadialGradient id="launch-teal" cx="100%" cy="100%" rx="85%" ry="85%"><Stop offset="0" stopColor="#1f5a6b" stopOpacity={0.5}/><Stop offset="1" stopColor="#1f5a6b" stopOpacity={0}/></RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#launch-amber)"/><Rect width={width} height={height} fill="url(#launch-teal)"/>
      </Svg>
    </Animated.View>
    <Animated.View style={[styles.ident, !still && exiting && animation(lift, 700)]}>
      <Animated.View style={!still ? loop(breathe, 3200, 1200) : undefined}>
        <View style={{ width: size, height: size * 49.6 / 46 }}>
          <Animated.View style={[StyleSheet.absoluteFill, !still && animation(amberSweep, 1000, 130)]}>
            <Svg width="100%" height="100%" viewBox="9 8 46 49.6"><Path d="M38 8H55L36.8 50.8 32.4 57.6Z" fill="#dcb998"/></Svg>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, !still && animation(longSweep, 1000)]}>
            <Svg width="100%" height="100%" viewBox="9 8 46 49.6"><Path d="M9 8H26.4L41 57.6H32.4Z" fill="#f5f1e9"/></Svg>
          </Animated.View>
        </View>
      </Animated.View>
      <Animated.View style={[{ marginTop: size * 0.29 }, !still && animation(settle, 650, 450)]}>
        <Svg width={size * 0.78} height={size * 0.35} viewBox="-6.25 -6.25 252.5 112.5">
          <Path d="M0 36L26 100L52 36M72 68H136A32 32 0 1 0 128.51 88.57M156 0V100M240 68A32 32 0 1 0 176 68A32 32 0 1 0 240 68M240 36V100" fill="none" stroke="#f5f1e9" strokeWidth={12.5} strokeLinecap="round" strokeLinejoin="round"/>
        </Svg>
      </Animated.View>
    </Animated.View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: { ...StyleSheet.absoluteFill, zIndex: 10000, backgroundColor: '#090b0e', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ident: { alignItems: 'center', transform: [{ translateY: -12 }] },
});
