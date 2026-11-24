// The `sections` layout block (`docs/plugin-screens.md` §6): vertical page scroll of sections.
// - Isolates each section child inside an error boundary (`SectionBoundary`) so one bad section
//   never takes down the page.
// - Mounts the first `FIRST_SECTIONS = 3` sections on the initial frame and streams the remaining
//   sections one per animation frame (`useStreamedCount`).
// - Wraps each section in a staggered entrance motion (`Rise`: opacity + 18px translateY, delay
//   `min(index, 3) * 70ms`, skipped when `still` is true).
// - Calls `requestNeeds` when a section with `needs: string[]` is about to mount.
// - Renders a hidden level-1 heading on the web (`aria-level={1}`) for screen readers.
// - Wraps each section in a TV `FocusBand` (`TVFocusGuideView autoFocus`) for per-section focus memory.
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, ScrollView, Text, View, type TextStyle } from 'react-native';
import { useHost } from '../host';
import { fill, holds, type Template } from '../resolve';
import type { Ctx, Env } from '../vocabulary';
import { FocusBand } from './focus';
import { FIRST_SECTIONS, initialStreamedCount, nextStreamedCount, parsePoints } from './layout-math';
import { useBlockLook, type BlockLook } from './look';
import { useScreenBlockRuntime, type BlockRNodeCommon, type SectionsBlockNode } from './types';

const HIDDEN_H1: TextStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  opacity: 0,
  overflow: 'hidden',
};

export class SectionBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    console.warn(`[skin/sections] section "${this.props.name}" failed to render`, error);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function useStreamedCount(count: number): number {
  const [mounted, setMounted] = useState(() => initialStreamedCount(count, FIRST_SECTIONS));
  useEffect(() => {
    if (count <= FIRST_SECTIONS) {
      setMounted(count);
      return;
    }
    setMounted(n => Math.min(count, Math.max(FIRST_SECTIONS, n)));
  }, [count]);
  useEffect(() => {
    if (mounted >= count) return;
    const frame = requestAnimationFrame(() =>
      setMounted(n => nextStreamedCount(n, count, FIRST_SECTIONS)),
    );
    return () => cancelAnimationFrame(frame);
  }, [mounted, count]);
  return Math.min(mounted, count);
}

function SectionRise({ look, delay = 0, children }: { look: BlockLook; delay?: number; children: ReactNode }) {
  const progress = useRef(new Animated.Value(look.still ? 1 : 0)).current;
  useEffect(() => {
    if (look.still) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 420,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, look.still, delay]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [look.px(18), 0] });
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

function SectionsPlaceholder({ look }: { look: BlockLook }) {
  const { px } = look;
  return (
    <View style={{ paddingHorizontal: look.gutter, gap: px(12) }}>
      <View
        style={{
          width: px(140),
          height: px(18),
          borderRadius: px(6),
          backgroundColor: look.chipFill,
        }}
      />
      <View style={{ flexDirection: 'row', gap: px(14) }}>
        {[0, 1, 2].map(i => (
          <View
            key={i}
            style={{
              width: px(286),
              height: px(136),
              borderRadius: px(14),
              backgroundColor: look.cardFill,
              borderWidth: 1,
              borderColor: look.cardEdge,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function collectNodeNeeds(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as BlockRNodeCommon & { children?: unknown[]; item?: unknown };
  const out = new Set<string>();
  if (Array.isArray(n.needs)) {
    for (const s of n.needs) if (typeof s === 'string' && s) out.add(s);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) {
      for (const s of collectNodeNeeds(child)) out.add(s);
    }
  }
  return [...out];
}

function sectionWhenHolds(node: unknown, ctx: Ctx, env: Env): boolean {
  if (!node || typeof node !== 'object') return false;
  const when = (node as { when?: Parameters<typeof holds>[0] }).when;
  if (!when || !when.length) return true;
  return holds(when, ctx, env);
}

export function SectionsBlock({ node, ctx }: { node: SectionsBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const runtime = useScreenBlockRuntime();
  const { px } = look;

  const isPage = runtime?.presentation === 'page';
  const defaultGap = px(isPage ? 18 : 26);
  const gap = parsePoints(node.gap, px, defaultGap);
  const topPad = isPage ? px(look.small ? 18 : 24) : look.barTop + px(look.tv ? 8 : 12);
  const bottomPad = px(isPage ? 48 : 64);

  const visibleChildren = node.children.filter(child => sectionWhenHolds(child, ctx, host.env));
  const mountedCount = useStreamedCount(visibleChildren.length);

  // Trigger lazy `needs` for sections that are mounted or next up to mount.
  useEffect(() => {
    if (!runtime?.requestNeeds) return;
    const upcoming = visibleChildren.slice(0, Math.min(visibleChildren.length, mountedCount + 1));
    const needed = new Set<string>();
    for (const child of node.children) {
      for (const s of collectNodeNeeds(child)) needed.add(s);
    }
    for (const child of upcoming) {
      for (const s of collectNodeNeeds(child)) needed.add(s);
    }
    if (needed.size > 0) runtime.requestNeeds([...needed]);
  }, [runtime, visibleChildren.length, mountedCount, node.children]);

  if (!runtime) return null;

  const title = runtime.pageTitle;
  const shown = visibleChildren.slice(0, mountedCount);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: topPad,
        paddingBottom: bottomPad,
        gap,
      }}
      showsVerticalScrollIndicator={!Platform.isTV}
    >
      {Platform.OS === 'web' && title ? (
        <Text accessibilityRole="header" {...{ 'aria-level': 1 }} style={HIDDEN_H1}>
          {title}
        </Text>
      ) : null}
      {shown.map((child, idx) => {
        const rawId = (child as { id?: Template; testId?: Template })?.id ?? (child as { testId?: Template })?.testId;
        const id = (rawId ? fill(rawId, ctx, host.env).trim() : '') || `section-${idx}`;
        return (
          <SectionBoundary key={id} name={id}>
            <SectionRise look={look} delay={Math.min(idx, 3) * 70}>
              <FocusBand>{runtime.renderNode(child, ctx)}</FocusBand>
            </SectionRise>
          </SectionBoundary>
        );
      })}
      {mountedCount < visibleChildren.length ? <SectionsPlaceholder look={look} /> : null}
    </ScrollView>
  );
}
