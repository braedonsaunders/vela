// The `marquee` layout block (`docs/plugin-screens.md` §Surfaces): a horizontal run of an item
// template that scrolls continuously at reading speed (64 design points/sec) on the UI thread,
// duplicating its copy when wider than the viewport so it loops without a gap, and pausing under
// reduced motion (`look.still`) or while a descendant has focus.
import { useEffect, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { measure, useHost } from '../host';
import { fill, type RNode } from '../resolve';
import { boxStyle } from '../translate';
import type { Ctx, Env } from '../vocabulary';
import { FocusBand, hasFocusableChild } from './focus';
import { marqueeScrolls, marqueeStep, parsePoints } from './layout-math';
import { useBlockLook } from './look';
import { useScreenBlockRuntime, type MarqueeBlockNode } from './types';

/** Reading speed in design points per second (matches legacy LiveTicker SPEED = 64). */
const MARQUEE_SPEED = 64;

function translateOwnStyle(node: RNode, ctx: Ctx, env: Env, host: ReturnType<typeof useHost>): ViewStyle {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.base.style ?? {})) {
    raw[k] = fill(v, ctx, env);
  }
  return boxStyle(raw, measure(host.viewport, 16)).style as ViewStyle;
}

export function MarqueeBlock({ node, ctx }: { node: MarqueeBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const runtime = useScreenBlockRuntime();
  const { px } = look;

  const gap = parsePoints(node.gap, px, px(14));
  const rawItems = runtime ? runtime.evalItems(node, ctx, host.env) : [];
  const entries = useMemo(() => {
    if (!runtime) return [];
    return rawItems.map((itemCtx, idx) => ({
      key: runtime.evalItemKey(node, itemCtx, host.env) || String(idx),
      ctx: itemCtx,
    }));
  }, [runtime, node, rawItems, host.env]);

  const offset = useSharedValue(0);
  const contentW = useSharedValue(0);
  const [measured, setMeasured] = useState({ content: 0, viewport: 0 });
  const [focused, setFocused] = useState(false);

  const scrolls = !look.still && !focused && marqueeScrolls(measured.content, measured.viewport);
  const speed = px(MARQUEE_SPEED);

  const frames = useFrameCallback(frame => {
    offset.value = marqueeStep(offset.value, frame.timeSincePreviousFrame ?? 0, speed, contentW.value);
  }, false);

  useEffect(() => {
    frames.setActive(scrolls);
    if (!marqueeScrolls(measured.content, measured.viewport) || look.still) {
      offset.value = 0;
    }
  }, [scrolls, measured.content, measured.viewport, look.still, frames, offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -offset.value }],
  }));

  if (!runtime || !entries.length) return null;

  const onCopyLayout = (event: LayoutChangeEvent) => {
    const w = Math.round(event.nativeEvent.layout.width);
    contentW.value = w;
    setMeasured(m => (m.content === w ? m : { ...m, content: w }));
  };

  const onViewportLayout = (event: LayoutChangeEvent) => {
    const w = Math.round(event.nativeEvent.layout.width);
    setMeasured(m => (m.viewport === w ? m : { ...m, viewport: w }));
  };

  const ownStyle = translateOwnStyle(node, ctx, host.env, host);
  const rowStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap,
    paddingRight: gap,
  };

  const body = (
    <View
      style={[{ flex: 1, overflow: 'hidden', justifyContent: 'center' }, ownStyle]}
      onLayout={onViewportLayout}
      {...({
        onFocusCapture: () => setFocused(true),
        onBlurCapture: () => setFocused(false),
      } as object)}
    >
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center' }, animatedStyle]}>
        <View style={rowStyle} onLayout={onCopyLayout}>
          {entries.map(entry => (
            <View key={entry.key}>{runtime.renderNode(node.item, entry.ctx)}</View>
          ))}
        </View>
        {marqueeScrolls(measured.content, measured.viewport) && !look.still ? (
          <View
            style={rowStyle}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {entries.map(entry => (
              <View key={`dup-${entry.key}`}>{runtime.renderNode(node.item, entry.ctx)}</View>
            ))}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );

  return hasFocusableChild(node.item) ? <FocusBand>{body}</FocusBand> : body;
}
