// The signed-out scene: a dusk sky over dark water, a glowing horizon, and the Vela sail standing
// on it with its reflection. The whole scene hangs from one anchor at the horizon, so a step that
// needs more room glides the horizon up (one transform transition on the UI thread) and the sail
// shrinks onto it. Ambient light is Reanimated CSS keyframes that alternate, never reset. A server
// pack's art replaces the sky (backdrop) and the sail (wordmark or name).
import { Image } from 'expo-image';
import { Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useHost } from '../../host';
import { animation, easing } from '../../motion';
import { useLook } from '../common/look';
import { HORIZON_EASE, HORIZON_MOTION } from './horizon-motion';
import type { HorizonPlan } from './layout';
import { SAIL_ASPECT, SAIL_DRAWN_MS, SailMark, SailReflection } from './sail';

export interface SceneBranding {
  /** A server pack's wordmark image path, shown in place of the sail. */
  wordmark?: string;
  /** A server pack's name, shown in place of the sail when it has no wordmark. */
  name?: string;
  /** A server pack's backdrop image path: it becomes the sky. */
  backdrop?: string;
}

/** The scene's colours: dusk on a dark page, dawn on a light (paper) one. */
const DUSK = {
  sky: ['#090b0e00', '#12142400', '#141526', '#2b1c2f', '#6d3a30', '#c98552'],
  skyAt: [0, 0.35, 0.58, 0.8, 0.93, 1],
  sea: ['#1c1315', '#0d0c10', '#090b0e'],
  line: '#ffe2bd',
  glow: '#e8a063',
  glint: '#ffd6a6',
};
const DAWN = {
  sky: ['#f3efe800', '#f3efe800', '#f1e6da', '#efd5bd', '#eab48b', '#e39563'],
  skyAt: [0, 0.35, 0.58, 0.8, 0.93, 1],
  sea: ['#e9ded2', '#f1ebe3', '#f3efe8'],
  line: '#fff6ea',
  glow: '#e8955c',
  glint: '#ffffff',
};

const GLINTS = [
  { y: 10, width: 0.5, x: 0.02 },
  { y: 22, width: 0.36, x: -0.06 },
  { y: 37, width: 0.62, x: 0.04 },
  { y: 55, width: 0.28, x: 0.08 },
  { y: 76, width: 0.44, x: -0.03 },
];

export function Horizon({ plan, width, height, maxSail, waiting, branding, draw, moveMs }: {
  plan: HorizonPlan;
  width: number;
  height: number;
  /** The largest sail the plan can ask for: the mark is drawn at this size and scaled down. */
  maxSail: number;
  waiting: boolean;
  branding?: SceneBranding;
  /** Play the mark's entrance (the first appearance of the stage). */
  draw: boolean;
  /** How long the horizon takes to reach a new place (a keyboard's own duration while one moves). */
  moveMs: number;
}) {
  const look = useLook();
  const host = useHost();
  const paper = luminanceOf(look.ui.page) > 0.5;
  const palette = paper ? DAWN : DUSK;
  const still = look.still;
  const motion = (name: string, delay?: number): ViewStyle => {
    const preset = host.doc.motion[name] ?? HORIZON_MOTION[name];
    const shifted = preset && delay !== undefined ? { ...preset, delay } : preset;
    return (animation(shifted, host.doc.keyframes, still, 0) ?? {}) as ViewStyle;
  };
  const glide = (ms: number): ViewStyle => (still || ms <= 0 ? {} : {
    transitionProperty: ['transform', 'opacity'],
    transitionDuration: ms,
    transitionTimingFunction: easing(HORIZON_EASE),
  } as unknown as ViewStyle);
  const centre = plan.split ? plan.pane / 2 : width / 2;
  const sailWidth = maxSail * SAIL_ASPECT;
  const scale = plan.sail / maxSail;
  const reflectionStrength = paper ? 0.12 : 0.16;
  const mark = branding?.wordmark ? host.image(branding.wordmark) : undefined;
  const backdrop = branding?.backdrop ? host.image(branding.backdrop) : undefined;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.page, overflow: 'hidden' }]} pointerEvents="none"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Everything hangs from the horizon: one transform moves the whole world. */}
      <Animated.View style={[styles.anchor, { width, transform: [{ translateY: plan.horizon }] }, glide(moveMs)]}>
        {/* Sky */}
        <View style={[styles.above, { height: height + 40 }]}>
          {backdrop ? <Image source={backdrop} contentFit="cover" style={[StyleSheet.absoluteFill, { opacity: 0.62 }]} /> : null}
          <View style={[StyleSheet.absoluteFill, { backgroundImage: gradient(palette.sky, palette.skyAt, backdrop ? 0.55 : 1) } as ViewStyle]} />
          <Animated.View style={[styles.sun, { left: centre - width * 0.75, width: width * 1.5, backgroundImage: `radial-gradient(ellipse 50% 100% at 50% 100%, ${palette.glow}55 0%, ${palette.glow}00 70%)` } as ViewStyle, motion('velaSkyDrift')]} />
        </View>
        {/* Water */}
        <View style={[styles.below, { height: height + 40, backgroundImage: `linear-gradient(180deg, ${palette.sea[0]} 0%, ${palette.sea[1]} 18%, ${palette.sea[2]} 55%)` } as ViewStyle]}>
          <View style={[styles.underglow, { left: centre - width * 0.7, width: width * 1.4, backgroundImage: `radial-gradient(ellipse 50% 100% at 50% 0%, ${palette.glow}38 0%, ${palette.glow}00 72%)` } as ViewStyle]} />
          {plan.sail > 0 && !branding?.name && !mark ? GLINTS.map((glint, i) => (
            <Animated.View key={i} style={[styles.glint, {
              top: Math.round(glint.y * Math.max(0.5, scale)),
              left: centre - (plan.sail * glint.width * 1.6) / 2 + plan.sail * glint.x,
              width: plan.sail * glint.width * 1.6,
              backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, ${palette.glint}aa 0%, ${palette.glint}00 100%)`,
            } as ViewStyle, motion(`velaGlint${i}`)]} />
          )) : null}
        </View>
        {/* The line and its glow */}
        <Animated.View style={[styles.glow, { backgroundImage: `radial-gradient(ellipse 48% 50% at 50% 50%, ${palette.glow}70 0%, ${palette.glow}00 100%)`, left: centre - width * 0.7, width: width * 1.4 } as ViewStyle, motion('velaHorizonBreath')]} />
        <View style={[styles.line, { backgroundImage: `linear-gradient(90deg, ${palette.line}00 0%, ${palette.line}aa 22%, ${palette.line} 50%, ${palette.line}aa 78%, ${palette.line}00 100%)` } as ViewStyle]} />
        <Animated.View style={[styles.drift, { width }, motion('velaHorizonDrift')]}>
          <View style={[styles.highlight, { left: width * 0.3, width: width * 0.4, backgroundImage: `linear-gradient(90deg, #ffffff00, #ffffffcc, #ffffff00)` } as ViewStyle]} />
        </Animated.View>
        {/* Waiting: a brighter light travelling the line. */}
        <Animated.View style={[styles.drift, { width, opacity: waiting ? 1 : 0 }, glide(600), waiting ? motion('velaHorizonSweep') : null]}>
          <View style={[styles.sweep, { left: width / 2 - 70, backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, #ffffffee 0%, ${palette.line}88 30%, ${palette.glow}00 100%)` } as ViewStyle]} />
        </Animated.View>
        {/* The sail and its reflection, drawn at the largest size and scaled onto the line. */}
        {mark ? (
          <Animated.View style={[styles.brand, { left: centre - Math.min(width * 0.36, 180), width: Math.min(width * 0.72, 360), height: Math.max(plan.sail, 40) * 0.6, opacity: plan.sail > 0 ? 1 : 0 }, glide(moveMs)]}>
            <Image source={mark} contentFit="contain" style={StyleSheet.absoluteFill} />
          </Animated.View>
        ) : branding?.name ? (
          <Animated.View style={[styles.brand, { left: 0, width: plan.split ? plan.pane : width, alignItems: 'center', opacity: plan.sail > 0 ? 1 : 0 }, glide(moveMs)]}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={look.text({ 'font-family': '$ui.fontDisplay', 'font-size': `${Math.round(Math.max(28, Math.min(56, plan.sail * 0.34)))}px`, 'line-height': '1.3' })}>{branding.name}</Text>
          </Animated.View>
        ) : (
          <>
            <Animated.View style={[styles.reflection, { left: centre - sailWidth / 2, width: sailWidth, height: maxSail, opacity: plan.sail > 0 ? 1 : 0, transform: [{ scaleX: scale }, { scaleY: scale * 0.7 }] }, glide(moveMs)]}>
              <Animated.View style={[{ transformOrigin: 'top' } as ViewStyle, motion('velaReflectionRipple'), draw && !still ? fadeIn(SAIL_DRAWN_MS - 500) : null]}>
                <SailReflection height={maxSail} paper={paper} strength={reflectionStrength} />
              </Animated.View>
            </Animated.View>
            <Animated.View style={[styles.sail, { left: centre - sailWidth / 2, width: sailWidth, height: maxSail, opacity: plan.sail > 0 ? 1 : 0, transform: [{ scale }] }, glide(moveMs)]}>
              <Animated.View style={[{ transformOrigin: 'bottom' } as ViewStyle, motion('velaSailSway', draw ? SAIL_DRAWN_MS : 0)]}>
                <SailMark height={maxSail} draw={draw && !still} paper={paper} />
              </Animated.View>
            </Animated.View>
          </>
        )}
      </Animated.View>
      {/* Split: a veil behind the step's column keeps its words legible over the sky. */}
      {plan.split ? <View style={[StyleSheet.absoluteFill, { left: plan.pane * 0.7, backgroundImage: `linear-gradient(90deg, ${look.ui.page}00 0%, ${look.ui.page}b3 40%, ${look.ui.page}d9 100%)` } as ViewStyle]} /> : null}
      {/* The edges fall away. */}
      <View style={[StyleSheet.absoluteFill, { backgroundImage: `radial-gradient(ellipse 120% 90% at 50% 45%, #00000000 55%, ${paper ? '#00000014' : '#00000080'} 100%)` } as ViewStyle]} />
    </View>
  );
}

function fadeIn(delay: number): ViewStyle {
  return {
    animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
    animationDuration: 900,
    animationDelay: delay,
    animationFillMode: 'both',
    animationTimingFunction: 'ease-out',
  } as unknown as ViewStyle;
}

function gradient(colours: string[], stops: number[], alpha: number): string {
  const fade = (c: string) => (alpha >= 1 || c.length !== 7 ? c : `${c}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);
  return `linear-gradient(180deg, ${colours.map((c, i) => `${fade(c)} ${Math.round(stops[i]! * 100)}%`).join(', ')})`;
}

function luminanceOf(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0, height: 0 },
  above: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  below: { position: 'absolute', left: 0, right: 0, top: 0 },
  sun: { position: 'absolute', bottom: 0, height: 260 },
  underglow: { position: 'absolute', top: 0, height: 140 },
  glint: { position: 'absolute', height: 3, borderRadius: 1.5 },
  glow: { position: 'absolute', top: -34, height: 68 },
  line: { position: 'absolute', left: 0, right: 0, top: -0.75, height: 1.5 },
  drift: { position: 'absolute', left: 0, top: -2, height: 4 },
  highlight: { position: 'absolute', top: 1, height: 2, borderRadius: 1, opacity: 0.55 },
  sweep: { position: 'absolute', top: -10, width: 140, height: 24 },
  brand: { position: 'absolute', bottom: 10, justifyContent: 'flex-end' },
  sail: { position: 'absolute', bottom: 0, transformOrigin: 'bottom' } as ViewStyle,
  reflection: { position: 'absolute', top: 1, transformOrigin: 'top' } as ViewStyle,
});

export const HORIZON_PLATFORM_SCALE = Platform.isTV ? 1.25 : 1;
