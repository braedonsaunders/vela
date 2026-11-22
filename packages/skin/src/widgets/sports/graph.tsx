// The win-probability graph: a smooth line through the series over a soft area, the even line
// dashed across the middle, each side's name at its edge. It draws itself on when it first shows
// (the line runs in from the left), and a live game's latest point pulses.
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import type { LiveProbabilityPoint } from '@vela/core';
import type { SportsLook } from './look';
import { pathLength, probabilityPath } from './model';
import { LiveDot, Txt } from './parts';
import { alpha, mix } from './colour';
import { luminance } from './model';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const web = Platform.OS === 'web';

export interface GraphSide { abbr: string; color: string }

/** A team colour lifted until it reads on the page (a navy on a dark page is lightened). */
export function readableTeam(colour: string, page: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour || '#7aa2ff';
  const dark = luminance(page) < 0.4;
  const l = luminance(colour);
  if (dark && l < 0.12) return mix(colour, '#ffffff', Math.min(0.6, 0.12 + (0.12 - l) * 3.4));
  if (!dark && l > 0.6) return mix(colour, '#000000', 0.35);
  return colour;
}

export function ProbabilityGraph({ look, series, top, bottom, live, height }: {
  look: SportsLook; series: readonly LiveProbabilityPoint[]; top: GraphSide; bottom: GraphSide; live: boolean; height: number;
}) {
  const [width, setWidth] = useState(0);
  const drawn = useSharedValue(look.still || web ? 1 : 0);
  const { line, area, end } = probabilityPath(series, width, height);
  const length = pathLength(series, width, height);
  useEffect(() => {
    if (!width || look.still || web) return;
    drawn.value = withTiming(1, { duration: 1300, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  }, [width > 0, look.still]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - drawn.value) }), [length]);
  const areaStyle = useAnimatedStyle(() => ({ opacity: drawn.value }));
  // The line takes the colour of the side it favours: above the even line the top side's, below the other's.
  const topColor = readableTeam(top.color, look.page), bottomColor = readableTeam(bottom.color, look.page);
  const stroke = 'url(#sports-line)';
  const endColor = end && end.y > height / 2 ? bottomColor : topColor;
  const dot = look.px(9);
  return (
    <View onLayout={event => setWidth(Math.round(event.nativeEvent.layout.width))} style={{ height: height + look.px(4) }} accessibilityRole="image">
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
            <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={alpha(look.ink, 0.22)} strokeWidth={1} strokeDasharray="4 5" />
            {line ? (web
              ? <Path d={line} fill="none" stroke={stroke} strokeWidth={look.px(2.5)} strokeLinecap="round" strokeLinejoin="round" />
              : <AnimatedPath d={line} fill="none" stroke={stroke} strokeWidth={look.px(2.5)} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[length, length]} animatedProps={lineProps} />) : null}
          </Svg>
          {end && live ? <View pointerEvents="none" style={{ position: 'absolute', left: end.x - dot / 2, top: end.y - dot / 2 }}><LiveDot look={look} size={dot} color={endColor} /></View> : null}
          <EdgeLabel look={look} side={top} color={topColor} style={{ top: look.px(2) }} />
          <EdgeLabel look={look} side={bottom} color={bottomColor} style={{ bottom: look.px(2) }} />
        </>
      ) : null}
    </View>
  );
}

/** A side's name at its edge of the graph, on its colour. */
function EdgeLabel({ look, side, color, style }: { look: SportsLook; side: GraphSide; color: string; style: { top?: number; bottom?: number } }) {
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', left: look.px(2), flexDirection: 'row', alignItems: 'center', gap: look.px(5), paddingHorizontal: look.px(7),
      paddingVertical: look.px(2), borderRadius: look.px(6), backgroundColor: alpha(color, 0.18), borderWidth: 1, borderColor: alpha(color, 0.55) }, style]}>
      <View style={{ width: look.px(7), height: look.px(7), borderRadius: look.px(4), backgroundColor: color }} />
      <Txt look={look} size={11} weight={800} color={look.ink}>{side.abbr}</Txt>
    </View>
  );
}
