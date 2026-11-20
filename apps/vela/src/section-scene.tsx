import type { ReactNode } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import Reanimated from 'react-native-reanimated';
import {
  SECTION_SLIDE_MS,
  slideInBackward,
  slideInForward,
  slideOutBackward,
  slideOutForward,
  type SectionDirection,
} from './section-motion';

/** One scene in the directional slide shared by top-level sections and in-page library tabs. */
export function SectionScene({ children, current, visible = true, animated, direction, offset, testID }: {
  children: ReactNode;
  current: boolean;
  visible?: boolean;
  animated: boolean;
  direction: SectionDirection;
  offset: Animated.Value;
  testID?: string;
}) {
  const webAnimation = visible && animated && Platform.OS === 'web' ? {
    animationName: current
      ? direction > 0 ? slideInForward : slideInBackward
      : direction > 0 ? slideOutForward : slideOutBackward,
    animationDuration: SECTION_SLIDE_MS,
    animationTimingFunction: 'ease-in-out' as const,
    animationFillMode: 'both' as const,
  } : undefined;
  const SceneView = Platform.OS === 'web' ? Reanimated.View : Animated.View;
  return (
    <SceneView
      testID={testID}
      pointerEvents={current ? 'auto' : 'none'}
      accessibilityElementsHidden={!current}
      importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
      style={{
        display: visible ? 'flex' : 'none',
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        ...(Platform.OS === 'web' ? webAnimation : { transform: [{ translateX: offset }] }),
      }}
    >
      {children}
    </SceneView>
  );
}

/** Build the native half of the same slide. Callers own its lifetime and completion action. */
export function sectionSlide(incoming: Animated.Value, outgoing: Animated.Value, direction: SectionDirection, width: number) {
  incoming.setValue(direction * width);
  outgoing.setValue(0);
  const timing = { toValue: 0, duration: SECTION_SLIDE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true };
  return Animated.parallel([
    Animated.timing(incoming, timing),
    Animated.timing(outgoing, { ...timing, toValue: -direction * width }),
  ]);
}
