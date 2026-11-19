// The time ruler over the grid: half-hour ticks with labels, hours stronger, and the now pill.
// It follows the timeline's horizontal scroll; the corner above the rail names the day.
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import type { GuideModel } from '@vela/core';
import { RULER, nowPillOffset } from './geometry';
import type { GuideLook } from './look';
import { Line } from './parts';
import { useGuideMinute } from './clock';
import { useLiveContext } from './live';

interface RulerProps {
  look: GuideLook;
  model: GuideModel;
  scale: number;
  rail: number;
  viewportWidth: number;
  small: boolean;
  scrollX: SharedValue<number>;
  window: { from: number; to: number };
}

export function Ruler({ look, model, scale, rail, small, scrollX, window, viewportWidth }: RulerProps) {
  const width = model.minutes * scale;
  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }));
  const dayName = small ? (model.days.find(d => d.offset === model.day)?.label ?? '') : model.dayLabel;

  return (
    <View
      style={{
        flexDirection: 'row',
        height: RULER,
        backgroundColor: look.ruler,
        borderBottomWidth: 1,
        borderBottomColor: look.edge,
        zIndex: 6,
      }}
    >
      <View
        style={{
          width: rail,
          height: RULER,
          justifyContent: 'center',
          paddingLeft: small ? 12 : 20,
          flexShrink: 0,
          backgroundColor: look.rail,
          borderRightWidth: 1,
          borderRightColor: look.edge,
          zIndex: 2,
        }}
      >
        <Line
          look={look}
          size={10}
          weight={650}
          color={look.inkSecondary}
          style={{ letterSpacing: 1.6, textTransform: 'uppercase' }}
        >
          {dayName}
        </Line>
      </View>
      <View
        style={{ flex: 1, overflow: 'hidden' }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.View style={[{ width, height: RULER }, follow]}>
          {model.ticks.filter(tick => tick.minute + 30 > window.from && tick.minute < window.to).map(tick => {
            const x = tick.minute * scale;
            // A label the now pill would cover fades out rather than colliding with it.

            return (
              <View
                key={tick.id}
                style={{
                  position: 'absolute',
                  left: x,
                  top: 0,
                  bottom: 0,
                  width: 30 * scale,
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    width: 1,
                    height: tick.hour ? 10 : 6,
                    backgroundColor: tick.hour ? look.edgeStrong : look.edge,
                  }}
                />
                <Line
                  look={look}
                  size={12}
                  weight={tick.hour ? 650 : 500}
                  color={tick.hour ? look.ink : look.inkQuiet}
                  tabular
                  style={{ paddingLeft: 10 }}
                >
                  {tick.label}
                </Line>
              </View>
            );
          })}
          <NowPill look={look} model={model} scale={scale} scrollX={scrollX} viewportWidth={viewportWidth} />
        </Animated.View>
      </View>
    </View>
  );
}

function NowPill({ look, model, scale, scrollX, viewportWidth }: { look: GuideLook; model: GuideModel; scale: number; scrollX: SharedValue<number>; viewportWidth: number }) {
  const minute = useGuideMinute(model.nowMinute);
  const live = useLiveContext();
  const [width, setWidth] = useState(72);
  const pin = useAnimatedStyle(() => {
    const position = minute * scale - scrollX.value;
    return { transform: [{ translateX: scrollX.value + nowPillOffset(position, viewportWidth, width) - minute * scale }], opacity: position >= 0 && position <= viewportWidth ? 1 : 0 };
  });
  if (minute < 0) return null;
  return (
    <Animated.View
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[{
        position: 'absolute', left: minute * scale, bottom: 7, flexDirection: 'row', alignItems: 'center',
        paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999,
        backgroundColor: look.now, boxShadow: `0px 4px 18px ${look.nowGlow}`,
      }, pin]}
    >
      <Line look={look} size={11} weight={700} tabular>
        {live?.controller.view().guide?.nowLabel ?? model.nowLabel}
      </Line>
    </Animated.View>
  );
}
