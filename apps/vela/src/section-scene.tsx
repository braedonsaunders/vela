import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, useWindowDimensions, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import {
  SECTION_SLIDE_MS,
  slideInBackward,
  slideInForward,
  slideOutBackward,
  slideOutForward,
  type SectionDirection,
  sceneMotion, type ScenePosition,
} from './section-motion';

const slide = (animationName: object) => ({ animationName, animationDuration: SECTION_SLIDE_MS,
  animationTimingFunction: 'ease-in-out' as const, animationFillMode: 'both' as const });
const WEB_SLIDES: Record<string, ReturnType<typeof slide>> = {
  in1: slide(slideInForward), 'in-1': slide(slideInBackward), out1: slide(slideOutForward), 'out-1': slide(slideOutBackward),
};
const WEB_SCENE = { flex: 1 } as const;
const HIDDEN_WEB_SCENE = { flex: 1, visibility: 'hidden' } as const;

/** One scene in the directional slide shared by top-level sections and in-page library tabs. */
export function SectionScene({ children, current, visible = true, animated, direction, offset, testID, transitionKey }: {
  children: ReactNode;
  current: boolean;
  visible?: boolean;
  animated: boolean;
  direction: SectionDirection;
  offset?: Animated.Value;
  testID?: string;
  transitionKey?: string;
}) {
  if (Platform.OS !== 'web' && transitionKey !== undefined) return <RetainedNativeScene current={current}
    visible={visible} animated={animated} direction={direction} section={transitionKey} testID={testID}>{children}</RetainedNativeScene>;
  const wanted = visible && animated && Platform.OS === 'web' ? WEB_SLIDES[`${current ? 'in' : 'out'}${direction}`] : undefined;
  // Reanimated's web view applies a CSS animation while it renders, not when React commits. A
  // section switch renders as a transition, in slices, so the leaving scene began its slide up to
  // 100 ms before the incoming scene was shown. The slide is handed over at commit instead.
  const [webAnimation, setWebAnimation] = useState(wanted);
  useLayoutEffect(() => setWebAnimation(wanted), [wanted]);
  const SceneView = Platform.OS === 'web' ? Reanimated.View : Animated.View;
  return (
    <SceneView
      testID={testID}
      pointerEvents={current ? 'auto' : 'none'}
      accessibilityElementsHidden={!current}
      importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
      style={{
        ...(Platform.OS === 'web' ? null : { display: visible ? 'flex' : 'none' }),
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        ...(Platform.OS === 'web' ? webAnimation : { transform: [{ translateX: offset ?? 0 }] }),
      }}
    >
      {/* On the web a hidden retained scene keeps its layout (visibility, not display): hiding
          it with display: none fired every onLayout in the section, at no size, as it left and
          again as it came back, and showing it laid the whole section out again. */}
      {Platform.OS === 'web' ? <View style={visible ? WEB_SCENE : HIDDEN_WEB_SCENE}>{children}</View> : children}
    </SceneView>
  );
}

/** A retained view owns its native value for life. Swapping incoming/outgoing values left
 * Fabric's retained Home at the outgoing transform when search returned to it. */
function RetainedNativeScene({ children, current, visible, animated, direction, section, testID }: {
  children: ReactNode; current: boolean; visible: boolean; animated: boolean;
  direction: SectionDirection; section: string; testID?: string;
}) {
  const { width } = useWindowDimensions();
  const offset = useRef(new Animated.Value(0)).current;
  const previous = useRef<ScenePosition | null>(null);
  const [settled, setSettled] = useState(true);
  useLayoutEffect(() => {
    const next = { section, current, visible, width };
    const motion = sceneMotion(previous.current, next, animated, direction);
    previous.current = next;
    offset.setValue(motion.from);
    if (motion.from === motion.to) { setSettled(true); return; }
    setSettled(false);
    const slide = Animated.timing(offset, { toValue: motion.to, duration: SECTION_SLIDE_MS,
      easing: Easing.inOut(Easing.ease), useNativeDriver: true });
    slide.start(({ finished }) => { if (finished) setSettled(true); });
    return () => slide.stop();
  }, [section, current, visible, width, animated, direction, offset]);
  return <Animated.View testID={testID} pointerEvents={current ? 'auto' : 'none'}
    accessibilityElementsHidden={!current} importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
    style={{ display: visible ? 'flex' : 'none', position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
      transform: [{ translateX: offset }] }}
    passthroughAnimatedPropExplicitValues={settled && current ? { style: { transform: [{ translateX: 0 }] } } : undefined}>
    {children}
  </Animated.View>;
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
