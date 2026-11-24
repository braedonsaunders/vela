// The `lineGraph` layout block (`docs/plugin-screens.md` §6): renders a 0..1 probability / time-series
// curve with Catmull-Rom cubic Bézier smoothing, gradient fill, animated draw-on stroke, and a live
// pulsing endpoint dot (`live`).
// Matches legacy `ProbabilityGraph` pixel-for-pixel.
import { useEffect, useState } from 'react';
import { Platform, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { useHost } from '../host';
import { fill, type Template } from '../resolve';
import type { Ctx } from '../vocabulary';
import { luminance, pathLength, probabilityPath } from './graph-math';
import { parsePoints } from './layout-math';
import { alpha, mix, useBlockLook, type BlockLook } from './look';
import type { LineGraphBlockNode } from './types';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const web = Platform.OS === 'web';

interface GraphSide {
  abbr: string;
  color: string;
}

/** A team colour lifted until it reads on the page (a navy on a dark page is lightened). */
export function readableTeam(colour: string, page: string): string {
  const norm = /^[0-9a-f]{6}$/i.test(colour.trim()) ? `#${colour.trim()}` : colour.trim();
  if (!/^#[0-9a-f]{6}$/i.test(norm)) return norm || '#7aa2ff';
  const dark = luminance(page) < 0.4;
  const l = luminance(norm);
  if (dark && l < 0.12) return mix(norm, '#ffffff', Math.min(0.6, 0.12 + (0.12 - l) * 3.4));
  if (!dark && l > 0.6) return mix(norm, '#000000', 0.35);
  return norm;
}

function normalizeSides(raw: unknown): [GraphSide, GraphSide] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const toSide = (item: unknown, fallbackAbbr: string): GraphSide => {
    if (!item || typeof item !== 'object') return { abbr: fallbackAbbr, color: '' };
    const obj = item as { abbr?: unknown; short?: unknown; name?: unknown; color?: unknown };
    const abbrRaw = typeof obj.abbr === 'string' && obj.abbr.trim()
      ? obj.abbr.trim()
      : typeof obj.short === 'string' && obj.short.trim()
        ? obj.short.trim().slice(0, 3).toUpperCase()
        : typeof obj.name === 'string' && obj.name.trim()
          ? obj.name.trim().slice(0, 3).toUpperCase()
          : fallbackAbbr;
    return {
      abbr: abbrRaw,
      color: typeof obj.color === 'string' ? obj.color : '',
    };
  };
  return [toSide(raw[0], ''), toSide(raw[1], '')];
}

function LiveDot({ look, size = look.px(7), color = look.live }: { look: BlockLook; size?: number; color?: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (look.still || web) return;
    pulse.value = withTiming(1, { duration: 1400 });
  }, [look.still]); // eslint-disable-line react-hooks/exhaustive-deps
  const ring = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.55,
    transform: [{ scale: 1 + pulse.value * 1.15 }],
  }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {!look.still && !web ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, ring]}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

function EdgeLabel({ look, side, color, style }: { look: BlockLook; side: GraphSide; color: string; style: { top?: number; bottom?: number } }) {
  if (!side.abbr) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: look.px(2),
          flexDirection: 'row',
          alignItems: 'center',
          gap: look.px(5),
          paddingHorizontal: look.px(7),
          paddingVertical: look.px(2),
          borderRadius: look.px(6),
          backgroundColor: alpha(color, 0.18),
          borderWidth: 1,
          borderColor: alpha(color, 0.55),
        },
        style,
      ]}
    >
      <View style={{ width: look.px(7), height: look.px(7), borderRadius: look.px(4), backgroundColor: color }} />
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{
          ...look.face(800),
          fontSize: look.px(11),
          lineHeight: look.px(11 * 1.25),
          color: look.ink,
        }}
      >
        {side.abbr}
      </Text>
    </View>
  );
}

export function LineGraphBlock({ node, ctx }: { node: LineGraphBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const { px } = look;
  const [width, setWidth] = useState(0);
  const drawn = useSharedValue(look.still || web ? 1 : 0);

  const rawSeries = typeof node.series === 'function' ? node.series(ctx, host.env) : node.series;
  const series = Array.isArray(rawSeries) ? rawSeries : [];
  const rawSides = typeof node.sides === 'function' ? node.sides(ctx, host.env) : node.sides;
  const sides = normalizeSides(rawSides);

  const subjectStr = node.subject ? fill(node.subject as Template, ctx, host.env).trim() : '1';
  const subject: 0 | 1 = subjectStr === '0' ? 0 : 1;
  const live = node.live ? fill(node.live as Template, ctx, host.env).trim() === 'true' : false;
  const label = node.label ? fill(node.label as Template, ctx, host.env).trim() : undefined;

  const top = sides ? sides[subject] : { abbr: '', color: '' };
  const bottom = sides ? sides[subject === 1 ? 0 : 1] : { abbr: '', color: '' };

  const defaultH = px(look.small ? 96 : 132);
  const height = parsePoints(node.height, px, defaultH);

  const { line, area, end } = probabilityPath(series, width, height, subject);
  const length = pathLength(series, width, height, subject);

  useEffect(() => {
    if (!width || look.still || web) return;
    drawn.value = withTiming(1, { duration: 1300, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  }, [width > 0, look.still]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - drawn.value) }), [length]);
  const areaStyle = useAnimatedStyle(() => ({ opacity: drawn.value }));

  if (series.length < 2) return null;

  const topColor = readableTeam(top.color, look.page);
  const bottomColor = readableTeam(bottom.color, look.page);
  const stroke = 'url(#sports-line)';
  const endColor = end && end.y > height / 2 ? bottomColor : topColor;
  const dot = px(9);
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));

  return (
    <View
      onLayout={onLayout}
      style={{ height: height + px(4) }}
      accessibilityRole="image"
      accessibilityLabel={label || undefined}
    >
      {width > 0 ? (
        <>
          <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, areaStyle]}>
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="sports-area" x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={topColor} stopOpacity={0.34} />
                  <Stop offset="0.5" stopColor={topColor} stopOpacity={0.08} />
                  <Stop offset="0.5" stopColor={bottomColor} stopOpacity={0.05} />
                  <Stop offset="1" stopColor={bottomColor} stopOpacity={0.22} />
                </LinearGradient>
              </Defs>
              {area ? <Path d={area} fill="url(#sports-area)" /> : null}
            </Svg>
          </Animated.View>
          <Svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
            <Defs>
              <LinearGradient id="sports-line" x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={topColor} />
                <Stop offset="0.47" stopColor={topColor} />
                <Stop offset="0.53" stopColor={bottomColor} />
                <Stop offset="1" stopColor={bottomColor} />
              </LinearGradient>
            </Defs>
            <Line
              x1={0}
              y1={height / 2}
              x2={width}
              y2={height / 2}
              stroke={alpha(look.ink, 0.22)}
              strokeWidth={1}
              strokeDasharray="4 5"
            />
            {line ? (
              web ? (
                <Path d={line} fill="none" stroke={stroke} strokeWidth={px(2.5)} strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <AnimatedPath
                  d={line}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={px(2.5)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={[length, length]}
                  animatedProps={lineProps}
                />
              )
            ) : null}
          </Svg>
          {end && live ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: end.x - dot / 2, top: end.y - dot / 2 }}>
              <LiveDot look={look} size={dot} color={endColor} />
            </View>
          ) : null}
          <EdgeLabel look={look} side={top} color={topColor} style={{ top: px(2) }} />
          <EdgeLabel look={look} side={bottom} color={bottomColor} style={{ bottom: px(2) }} />
        </>
      ) : null}
    </View>
  );
}
