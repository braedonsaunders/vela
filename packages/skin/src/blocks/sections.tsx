// The `sections` layout block (`docs/plugin-screens.md` §6): vertical page scroll of sections.
// - Isolates each section child inside an error boundary (`SectionBoundary`) so one bad section
//   never takes down the page.
// - Mounts the first `FIRST_SECTIONS = 3` sections on the initial frame and streams the remaining
//   sections one per animation frame (`useStreamedCount`).
// - Wraps each section in a staggered entrance motion (`SectionRise`: opacity + 18px translateY, delay
//   `min(index, 3) * 70ms`, skipped when `still` is true).
// - Calls `requestNeeds` when a section with `needs: string[]` is about to mount.
// - Gives standalone pages a hidden level-1 heading on the web.
// - Wraps each section with focusable children in a TV `FocusBand` (`TVFocusGuideView autoFocus`)
//   for per-section focus memory, and in `ScopedRecordNode` so a record push only re-renders the
//   section reading that record.
import { Component, useContext, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle } from 'react-native';
import { pageScrollMemory } from '../screen/scroll-memory';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { InheritedContext, useHost } from '../host';
import { fill, holds, type Template } from '../resolve';
import { inheritText } from '../text-inheritance';
import type { Ctx, Env } from '../vocabulary';
import { FocusBand, hasFocusableChild } from './focus';
import { FIRST_SECTIONS, initialStreamedCount, nextStreamedCount, parsePoints } from './layout-math';
import { sectionsContentPadding } from './sections-padding';
import { useBlockLook, type BlockLook } from './look';
import { ScopedRecordNode } from './record-scope';
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

function SectionRise({ look, index, children }: { look: BlockLook; index: number; children: ReactNode }) {
  const t = useSharedValue(look.still ? 1 : 0);
  useEffect(() => {
    if (look.still) return;
    t.value = withDelay(
      Math.min(index, 8) * 70,
      withTiming(1, { duration: 620, easing: Easing.bezier(0.16, 1, 0.3, 1) }),
    );
    // Only on mount: a section that is already shown does not rise again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const animated = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 18 }],
  }));
  return <Animated.View style={animated}>{children}</Animated.View>;
}

function SectionsPlaceholder({ look }: { look: BlockLook }) {
  const { px } = look;
  const cardWidth = look.small ? Math.min(px(272), look.width * 0.74) : px(look.tv ? 300 : 286);
  return (
    <View style={{ paddingHorizontal: look.gutter, gap: px(14) }}>
      <View
        style={{
          width: px(180),
          height: px(20),
          borderRadius: px(6),
          backgroundColor: look.chipFill,
        }}
      />
      <View style={{ flexDirection: 'row', gap: px(14), overflow: 'hidden' }}>
        {[0, 1, 2, 3, 4].map(i => (
          <View
            key={i}
            style={{
              width: cardWidth,
              height: px(128),
              borderRadius: Math.min(px(look.ui.radiusCard), px(18)),
              backgroundColor: look.chipFill,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function collectNodeNeeds(node: unknown, shown?: (node: unknown) => boolean): string[] {
  if (!node || typeof node !== 'object') return [];
  if (shown && !shown(node)) return [];
  const n = node as BlockRNodeCommon & { children?: unknown[]; item?: unknown };
  const out = new Set<string>();
  if (Array.isArray(n.needs)) {
    for (const s of n.needs) if (typeof s === 'string' && s) out.add(s);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) {
      for (const s of collectNodeNeeds(child, shown)) out.add(s);
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
  const parentText = useContext(InheritedContext);
  const { px } = look;

  const isPage = runtime?.presentation === 'page';
  // A page inside an experience's shell (renderer 20) lays out its own column: the shell keeps it
  // clear of its bars, so no inset, no end space and no gap of the section's own.
  const embedded = !!runtime?.scrollKey;
  const defaultGap = embedded ? 0 : px(isPage ? 22 : 30);
  const gap = parsePoints(node.gap, px, defaultGap);
  // An embedded page's own padding rows (from the style in force) pad its scroll content, so the end
  // space counts in the scroll, as the music pages' contentContainerStyle did.
  const content = embedded ? sectionsContentPadding(node, ctx, host.env, px) : {};
  const topPad = embedded ? content.top ?? 0 : isPage ? 0 : look.barTop + px(look.tv ? 8 : 12);
  const bottomPad = embedded ? content.bottom ?? 0 : px(isPage ? 48 : 64) + (isPage ? 0 : gap);
  const sidePads = embedded ? { paddingLeft: content.left ?? 0, paddingRight: content.right ?? 0 } : {};

  const inheritedRows: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.base.style ?? {})) {
    if (k === 'font-family' || k === 'color' || k === 'font-size' || k === 'line-height' || k === 'font-weight') {
      inheritedRows[k] = fill(v, ctx, host.env);
    }
  }
  const text = inheritText(parentText, inheritedRows, host.viewport);

  const visibleChildren = node.children.filter(child => sectionWhenHolds(child, ctx, host.env));
  const mountedCount = useStreamedCount(visibleChildren.length);

  // Trigger lazy `needs` for sections that are mounted or next up to mount.
  useEffect(() => {
    if (!runtime?.requestNeeds) return;
    const upcoming = visibleChildren.slice(0, Math.min(visibleChildren.length, mountedCount + 1));
    const needed = new Set<string>();
    // An experience page reads only what its shown branches need (music Home never reads the spoken
    // shelves); a plugin page keeps reading every child's, as Sports was tuned against.
    for (const child of embedded ? [] : node.children) {
      for (const s of collectNodeNeeds(child)) needed.add(s);
    }
    const shown = embedded ? (n: unknown) => sectionWhenHolds(n, ctx, host.env) : undefined;
    for (const child of upcoming) {
      for (const s of collectNodeNeeds(child, shown)) needed.add(s);
    }
    if (needed.size > 0) runtime.requestNeeds([...needed]);
  }, [runtime, visibleChildren.length, mountedCount, node.children, embedded, ctx, host.env]);

  // A page in an experience's shell keeps its scroll by its key and is put back where it was once its
  // content is tall enough (a drag first leaves it where the viewer takes it).
  const scrollKey = runtime?.scrollKey;
  const resume = useRef(scrollKey ? pageScrollMemory.resume(scrollKey) : 0);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const keep = (event: NativeSyntheticEvent<NativeScrollEvent>) => { if (scrollKey) pageScrollMemory.keep(scrollKey, event.nativeEvent.contentOffset.y); };
  const memory = scrollKey ? {
    ref: scroller,
    onScrollBeginDrag: () => { resume.current = 0; },
    onScrollEndDrag: keep,
    onMomentumScrollEnd: keep,
    onContentSizeChange: (_width: number, height: number) => {
      if (resume.current > 0 && height > resume.current) { scroller.current?.scrollTo({ y: resume.current, animated: false }); resume.current = 0; }
    },
    scrollEventThrottle: 64,
  } : {};

  if (!runtime) return null;

  // Pages in an experience shell draw their own headings. A second, invisible heading
  // with the document title would repeat the visible heading in the accessibility tree.
  const title = embedded ? undefined : runtime.pageTitle;
  const shown = visibleChildren.slice(0, mountedCount);
  const testID = node.testId ? fill(node.testId as Template, ctx, host.env).trim() || undefined : undefined;

  return (
    <InheritedContext.Provider value={text}>
      <ScrollView
        testID={testID}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: topPad,
          paddingBottom: bottomPad,
          ...sidePads,
          gap,
        }}
        showsVerticalScrollIndicator={!Platform.isTV}
        {...memory}
      >
        {Platform.OS === 'web' && title ? (
          <Text accessibilityRole="header" {...{ 'aria-level': 1 }} style={HIDDEN_H1}>
            {title}
          </Text>
        ) : null}
        {shown.map((child, idx) => {
          const rawId = (child as { id?: Template; testId?: Template })?.id ?? (child as { testId?: Template })?.testId;
          const id = (rawId ? fill(rawId, ctx, host.env).trim() : '') || `section-${idx}`;
          const rendered = <ScopedRecordNode node={child} ctx={ctx} renderNode={runtime.renderNode} />;
          return (
            <SectionBoundary key={id} name={id}>
              <SectionRise look={look} index={Math.min(idx, FIRST_SECTIONS)}>
                {hasFocusableChild(child) ? <FocusBand>{rendered}</FocusBand> : rendered}
              </SectionRise>
            </SectionBoundary>
          );
        })}
        {mountedCount < visibleChildren.length ? <SectionsPlaceholder look={look} /> : null}
      </ScrollView>
    </InheritedContext.Provider>
  );
}
