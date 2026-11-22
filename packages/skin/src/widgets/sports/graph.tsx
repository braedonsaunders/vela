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
import { alpha } from './colour';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const web = Platform.OS === 'web';

export function ProbabilityGraph({ look, series, top, bottom, live, height }: {
  look: SportsLook; series: readonly LiveProbabilityPoint[]; top: string; bottom: string; live: boolean; height: number;
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
  const stroke = look.accent;
  const dot = look.px(9);
  return (
    <View onLayout={event => setWidth(Math.round(event.nativeEvent.layout.width))} style={{ height: height + look.px(4) }} accessibilityRole="image">
      {width > 0 ? (
        <>
          <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, areaStyle]}>
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="sports-area" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={stroke} stopOpacity={0.32} />
                  <Stop offset="1" stopColor={stroke} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {area ? <Path d={area} fill="url(#sports-area)" /> : null}
            </Svg>
          </Animated.View>
          <Svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
            <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={alpha(look.ink, 0.22)} strokeWidth={1} strokeDasharray="4 5" />
            {line ? (web
              ? <Path d={line} fill="none" stroke={stroke} strokeWidth={look.px(2.5)} strokeLinecap="round" strokeLinejoin="round" />
              : <AnimatedPath d={line} fill="none" stroke={stroke} strokeWidth={look.px(2.5)} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[length, length]} animatedProps={lineProps} />) : null}
          </Svg>
          {end && live ? <View pointerEvents="none" style={{ position: 'absolute', left: end.x - dot / 2, top: end.y - dot / 2 }}><LiveDot look={look} size={dot} color={stroke} /></View> : null}
          <Txt look={look} size={11} weight={700} color={look.inkQuiet} style={{ position: 'absolute', top: look.px(2), left: look.px(2) }}>{top}</Txt>
          <Txt look={look} size={11} weight={700} color={look.inkQuiet} style={{ position: 'absolute', bottom: look.px(2), left: look.px(2) }}>{bottom}</Txt>
        </>
      ) : null}
    </View>
  );
}
