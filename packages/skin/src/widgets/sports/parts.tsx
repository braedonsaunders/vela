// The pieces the Sports screen and game page are drawn with, in the active skin's look: text, a
// focusable surface that lifts and rings on focus (D-pad, Siri Remote, keyboard, pointer), the
// pulsing live badge, team crests, a score that pops when it changes, the win-probability bar,
// chips, and the rise every section enters with. Motion runs on the UI thread (Reanimated) and
// stands still under reduced motion.
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { msg } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { SYMBOLS } from '../../icons';
import type { SportsLook } from './look';
import { crestColor, type Side } from './model';
import { alpha } from './colour';

const web = Platform.OS === 'web';
const NO_RING = (web ? { outlineStyle: 'none' } : {}) as unknown as ViewStyle;
const SPRING = { damping: 18, stiffness: 220, mass: 0.7 };

export function Txt({ look, size, weight = 500, color, lines, style, children, display, digits, testID, header }: {
  look: SportsLook; size: number; weight?: number; color?: string; lines?: number; style?: StyleProp<TextStyle>;
  children: ReactNode; display?: boolean; digits?: boolean; testID?: string; header?: boolean;
}) {
  return (
    <Text
      testID={testID}
      accessibilityRole={header ? 'header' : undefined}
      numberOfLines={lines}
      ellipsizeMode={lines ? 'tail' : undefined}
      style={[display ? look.display() : look.font(weight), { fontSize: look.px(size), lineHeight: look.px(size * 1.25), color: color ?? look.ink }, digits ? look.digits : null, style]}
    >
      {children}
    </Text>
  );
}

/** Extra glyphs Sports needs beside the shared icon set (24-unit paths). */
const EXTRA: Record<string, { paths: string[]; stroke?: boolean }> = {
  grid: { paths: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'], stroke: true },
  'eye-off': { paths: ['M3 3l18 18', 'M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-3 3.9', 'M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.7 9.7 0 0 0 4.4-1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'], stroke: true },
  bell: { paths: ['M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z', 'M10 21h4'], stroke: true },
  star: { paths: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'], stroke: true },
  tv: { paths: ['M3.5 6.5h17v11h-17z', 'M8.5 21h7', 'M9 2.5l3 4 3-4'], stroke: true },
  trophy: { paths: ['M8 4h8v5a4 4 0 0 1-8 0z', 'M8 6H5a3 3 0 0 0 3 4', 'M16 6h3a3 3 0 0 1-3 4', 'M12 13v4', 'M8.5 20h7'], stroke: true },
};

export function Glyph({ name, size, color }: { name: string; size: number; color: string }) {
  const symbol = EXTRA[name] ?? SYMBOLS[name];
  if (!symbol) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      {symbol.paths.map((d, i) => symbol.stroke
        ? <Path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        : <Path key={i} d={d} fill={color} />)}
    </Svg>
  );
}

/**
 * A focusable, pressable surface: on focus it lifts (scale), its ring and halo fade in and its fill
 * brightens; pressed it gives a little. The ring is drawn over the content, so it is never clipped
 * by the surface's own corners.
 */
export function Surface({ look, onPress, onFocus, style, children, radius, fill, focusFill, lift = 1.04, label, testID, nativeID, hasTVPreferredFocus, ring = true, disabled }: {
  look: SportsLook; onPress?: () => void; onFocus?: () => void; style?: StyleProp<ViewStyle>; children: ReactNode; radius?: number; fill?: string; focusFill?: string;
  lift?: number; label?: string; testID?: string; nativeID?: string; hasTVPreferredFocus?: boolean; ring?: boolean; disabled?: boolean;
}) {
  const on = useSharedValue(0);
  const press = useSharedValue(0);
  const corner = radius ?? look.radiusCard;
  const base = fill ?? look.card;
  const lit = focusFill ?? look.cardHover;
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: (1 + (lift - 1) * on.value) * (1 - 0.025 * press.value) }],
    backgroundColor: interpolateColor(on.value, [0, 1], [base, lit]),
    shadowOpacity: 0.45 * on.value,
  }), [lift, base, lit]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  const go = (value: number) => { on.value = look.still ? value : withSpring(value, SPRING); };
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onFocus={() => { go(1); onFocus?.(); }}
      onBlur={() => go(0)}
      onHoverIn={() => go(1)}
      onHoverOut={() => go(0)}
      onPressIn={() => { press.value = withTiming(1, { duration: 90 }); }}
      onPressOut={() => { press.value = withTiming(0, { duration: 180 }); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      testID={testID}
      nativeID={nativeID}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={NO_RING}
    >
      <Animated.View style={[{ borderRadius: corner, shadowColor: '#000', shadowRadius: look.px(18), shadowOffset: { width: 0, height: look.px(10) } }, style, animated]}>
        {children}
        {ring ? (
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -look.px(3), left: -look.px(3), right: -look.px(3), bottom: -look.px(3),
            borderRadius: corner + look.px(3), borderWidth: look.px(2.5), borderColor: look.ring }, ringStyle]} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

/** A pill button: filled (primary) or quiet, with a glyph. */
export function Pill({ look, label, glyph, primary, onPress, testID, small, hasTVPreferredFocus }: {
  look: SportsLook; label: string; glyph?: string; primary?: boolean; onPress(): void; testID?: string; small?: boolean; hasTVPreferredFocus?: boolean;
}) {
  const height = look.px(small ? 34 : 42);
  const ink = primary ? look.inkInverse : look.ink;
  return (
    <Surface look={look} onPress={onPress} label={label} testID={testID} radius={height / 2} lift={1.06} hasTVPreferredFocus={hasTVPreferredFocus}
      fill={primary ? look.ink : alpha(look.ink, 0.12)} focusFill={primary ? look.accent : alpha(look.ink, 0.22)}
      style={{ height, paddingHorizontal: look.px(small ? 14 : 18), flexDirection: 'row', alignItems: 'center', gap: look.px(8) }}>
      {glyph ? <Glyph name={glyph} size={look.px(small ? 14 : 16)} color={ink} /> : null}
      <Txt look={look} size={small ? 13 : 14.5} weight={650} color={ink} lines={1}>{label}</Txt>
    </Surface>
  );
}

/** A pulsing dot: a ripple runs out from it unless motion is reduced. */
export function LiveDot({ look, size, color }: { look: SportsLook; size: number; color?: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (look.still) return;
    pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(pulse);
  }, [look.still, pulse]);
  const ripple = useAnimatedStyle(() => ({ opacity: 0.8 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 1.4 }] }));
  const fill = color ?? look.liveInk;
  return (
    <View style={{ width: size, height: size }}>
      {!look.still ? <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: fill }, ripple]} /> : null}
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: fill }} />
    </View>
  );
}

/** The red LIVE badge. */
export function LiveBadge({ look, small }: { look: SportsLook; small?: boolean }) {
  return (
    <View accessibilityLabel={msg('sports.live')} style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(small ? 4 : 6), backgroundColor: look.live,
      borderRadius: look.px(5), paddingHorizontal: look.px(small ? 5 : 7), paddingVertical: look.px(small ? 1.5 : 2.5) }}>
      <LiveDot look={look} size={look.px(small ? 5 : 6)} />
      <Txt look={look} size={small ? 9.5 : 11} weight={800} color={look.liveInk} style={{ letterSpacing: look.px(0.8) }}>{msg('sports.liveBadge')}</Txt>
    </View>
  );
}

/** A team's crest: its logo on its colour, its abbreviation until (or unless) the logo loads. */
export function Crest({ look, side, size, ring }: { look: SportsLook; side: Pick<Side, 'abbr' | 'logo' | 'color' | 'altColor' | 'name'>; size: number; ring?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const fill = crestColor(side);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      borderWidth: ring ? Math.max(1, size * 0.04) : 0, borderColor: alpha('#ffffff', 0.35) }}>
      {!loaded ? <Text style={[look.font(800), { color: '#ffffff', fontSize: size * (side.abbr.length > 3 ? 0.26 : 0.32), letterSpacing: 0.3 }]} numberOfLines={1}>{side.abbr}</Text> : null}
      {side.logo ? (
        <Image source={{ uri: side.logo }} onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} contentFit="contain" transition={look.still ? 0 : 220}
          style={{ position: 'absolute', width: size * 0.78, height: size * 0.78, opacity: loaded ? 1 : 0 }} accessibilityIgnoresInvertColors />
      ) : null}
    </View>
  );
}

/** A score that pops and glows in the accent when it changes, then settles. */
export function Score({ look, value, size, color, weight = 800, testID, dim }: { look: SportsLook; value: string; size: number; color?: string; weight?: number; testID?: string; dim?: boolean }) {
  const pop = useSharedValue(0);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (look.still) return;
    pop.value = withSequence(withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) }), withDelay(500, withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) })));
  }, [value, look.still, pop]);
  const ink = color ?? look.ink;
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.16 * pop.value }],
    color: interpolateColor(pop.value, [0, 1], [ink, look.accent]),
  }), [ink, look.accent]);
  return (
    <Animated.Text testID={testID} style={[look.font(weight), look.digits, { fontSize: look.px(size), lineHeight: look.px(size * 1.12), opacity: dim ? 0.55 : 1 }, style]}>{value}</Animated.Text>
  );
}

/** The win-probability bar: the home share fills from the right in the home colour, easing to each new value. */
export function ProbabilityBar({ look, home, awayColor, homeColor, height }: { look: SportsLook; home: number; awayColor: string; homeColor: string; height: number }) {
  const share = useSharedValue(home);
  useEffect(() => { share.value = look.still ? home : withTiming(home, { duration: 900, easing: Easing.inOut(Easing.cubic) }); }, [home, look.still, share]);
  const away = useAnimatedStyle(() => ({ flex: Math.max(0.0001, 1 - share.value) }));
  const homeStyle = useAnimatedStyle(() => ({ flex: Math.max(0.0001, share.value) }));
  return (
    <View style={{ height, borderRadius: height / 2, overflow: 'hidden', flexDirection: 'row', backgroundColor: alpha('#ffffff', 0.14), gap: look.px(2) }}>
      <Animated.View style={[{ backgroundColor: awayColor }, away]} />
      <Animated.View style={[{ backgroundColor: homeColor }, homeStyle]} />
    </View>
  );
}

/** A filter chip: on, it fills with the ink. */
export function Chip({ look, label, on, onPress, testID, leading, small }: { look: SportsLook; label: string; on: boolean; onPress(): void; testID?: string; leading?: ReactNode; small?: boolean }) {
  const height = look.px(small ? 30 : 36);
  return (
    <Surface look={look} onPress={onPress} label={label} testID={testID} radius={height / 2} lift={1.06}
      fill={on ? look.ink : alpha(look.ink, small ? 0.06 : 0.08)} focusFill={on ? look.ink : alpha(look.ink, 0.18)}
      style={{ height, paddingHorizontal: look.px(small ? 13 : 16), flexDirection: 'row', alignItems: 'center', gap: look.px(8) }}>
      {leading}
      <Txt look={look} size={small ? 12.5 : 14} weight={on ? 700 : 560} color={on ? look.inkInverse : small ? look.inkSecondary : look.ink} lines={1}>{label}</Txt>
    </Surface>
  );
}

/** A section heading, as the home rows name themselves. */
export function Heading({ look, children, aside }: { look: SportsLook; children: string; aside?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: look.px(12) }}>
      <Txt look={look} size={look.tv ? 19 : 17} weight={700} header>{children}</Txt>
      {aside}
    </View>
  );
}

/** Each section rises into place on first draw, a little after the one above it. */
export function Rise({ look, index, children, style }: { look: SportsLook; index: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useSharedValue(look.still ? 1 : 0);
  useEffect(() => {
    if (look.still) return;
    t.value = withDelay(Math.min(index, 8) * 70, withTiming(1, { duration: 620, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
  // Only on mount: a section that is already shown does not rise again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const animated = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * 18 }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** A faint placeholder block that breathes while a section loads. */
export function Placeholder({ look, width, height, radius }: { look: SportsLook; width: number | `${number}%`; height: number; radius?: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (look.still) return;
    t.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(t);
  }, [look.still, t]);
  const animated = useAnimatedStyle(() => ({ opacity: 0.5 + 0.5 * t.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius ?? look.radiusCard, backgroundColor: alpha(look.ink, 0.07) }, animated]} />;
}

/** A small star: filled for a favourite. */
export function FavouriteMark({ look, on, size }: { look: SportsLook; on: boolean; size: number }) {
  const pop = useSharedValue(on ? 1 : 0);
  useEffect(() => { pop.value = look.still ? (on ? 1 : 0) : withSpring(on ? 1 : 0, { damping: 9, stiffness: 260 }); }, [on, look.still, pop]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: 0.85 + 0.15 * pop.value }], opacity: 0.55 + 0.45 * pop.value }));
  return (
    <Animated.View style={animated}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill={on ? look.gold : 'none'} stroke={on ? look.gold : look.inkQuiet} strokeWidth={1.8} strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

/** The multiview glyph drawn small, for buttons. */
export function GridMark({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {[[3, 3], [13, 3], [3, 13], [13, 13]].map(([x, y]) => <Rect key={`${x}${y}`} x={x} y={y} width={8} height={8} rx={1.5} fill="none" stroke={color} strokeWidth={2} />)}
    </Svg>
  );
}
