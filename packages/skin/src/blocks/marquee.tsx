// The `marquee` block (docs/plugin-screens.md: Language additions for surfaces): a horizontal run of
// an item template that scrolls right to left, endlessly, at reading speed (the scores ticker). The
// run advances on the UI thread (a frame callback); a second copy takes over as the first leaves,
// so there is never a gap, and a run that grows or shrinks as scores change carries on where it was.
// It stands still under reduced motion, while focus is inside it, and when it fits.
import { useEffect, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useHost } from '../host';
import type { Ctx } from '../vocabulary';
import { parsePoints } from './layout-math';
import { useBlockLook } from './look';
import { marqueeScrolls, marqueeStep } from './marquee-math';
import { useScreenBlockRuntime, type MarqueeBlockNode } from './types';

/** Reading speed without a `speed`, in design points a second. */
const SPEED = 64;

export function MarqueeBlock({ node, ctx }: { node: MarqueeBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const runtime = useScreenBlockRuntime();
  const { px } = look;
  const gap = parsePoints(node.gap, px, 0);
  const rawItems = runtime ? runtime.evalItems(node, ctx, host.env) : [];
  const entries = useMemo(() => {
    if (!runtime) return [];
    return rawItems.map((itemCtx, idx) => ({ key: runtime.evalItemKey(node, itemCtx, host.env) || String(idx), ctx: itemCtx }));
  }, [runtime, node, rawItems, host.env]);

  const offset = useSharedValue(0);
  const width = useSharedValue(0);
  const [measured, setMeasured] = useState({ content: 0, viewport: 0 });
  const [focused, setFocused] = useState(false);
  const scrolls = !host.env.still && !focused && marqueeScrolls(measured.content, measured.viewport);
  const speed = px(node.speed ?? SPEED);
  const frames = useFrameCallback(frame => {
    offset.value = marqueeStep(offset.value, frame.timeSincePreviousFrame ?? 0, speed, width.value);
  }, false);
  useEffect(() => {
    frames.setActive(scrolls);
    // Reduced motion and a run that fits stand at the start; focus holds the run where it is.
    if (!scrolls && !focused) offset.value = 0;
  }, [scrolls, focused]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -offset.value }] }));

  if (!runtime || !entries.length) return null;
  const onCopy = (event: LayoutChangeEvent) => {
    // One copy and the gap after it: the distance after which the second copy stands where the first began.
    const content = Math.round(event.nativeEvent.layout.width + gap);
    width.value = content;
    setMeasured(m => (m.content === content ? m : { ...m, content }));
  };
  const onViewport = (event: LayoutChangeEvent) => {
    const viewport = Math.round(event.nativeEvent.layout.width);
    setMeasured(m => (m.viewport === viewport ? m : { ...m, viewport }));
  };
  const copy = (hidden: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap, marginRight: gap }} onLayout={hidden ? undefined : onCopy}
      {...(hidden ? { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const } : {})}>
      {entries.map(entry => <View key={entry.key}>{runtime.renderNode(node.item, entry.ctx)}</View>)}
    </View>
  );
  return (
    <View style={{ flex: 1, alignSelf: 'stretch', overflow: 'hidden', justifyContent: 'center' }} onLayout={onViewport}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', position: 'absolute', left: 0, top: 0, bottom: 0 }, style]}>
        {copy(false)}
        {scrolls || focused ? copy(true) : null}
      </Animated.View>
    </View>
  );
}
