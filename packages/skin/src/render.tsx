// The skin document renderer: one recursive component per node kind over a resolved document
// (resolve.ts). A node's style is its state's layer with the hover, focus, group and pressed
// overlays in force, translated per the style matrix (translate.ts); text rows inherit down the
// tree through context and are drawn at text nodes. Presses dispatch the document's actions to
// the host, which owns navigation and data; nothing in a document executes.
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { Image, type ImageSource } from 'expo-image';
import type { ComponentType } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { Action } from '../../../protocol/v0/skin';
import { withClientStrings } from '../../../client/src/skin/client-strings';
import type { Measure, Viewport } from './css';
import { SYMBOLS } from './icons';
import { animation } from './motion';
import { fill, holds, type CssT, type Layer, type RNode, type ResolvedDocument } from './resolve';
import { INHERITED, boxStyle, fontSizeOf, textStyle, type Css, type Effects } from './translate';
import { collection, type Ctx, type Env } from './vocabulary';

export interface SkinHost {
  doc: ResolvedDocument;
  env: Env;
  viewport: Viewport;
  dispatch(action: Action, arg: string): void;
  /** An image source for a document path: an app asset, the document's own asset, or a URL. */
  image(src: string): ImageSource | number | undefined;
  setQuery(query: string): void;
  setFlag(flag: string, on: boolean): void;
  setPager(rowId: string, state: { atStart: boolean; atEnd: boolean }): void;
  /** Where the shell draws the route (slot `children`). */
  children?: ReactNode;
}

const Host = createContext<SkinHost | null>(null);
const Inherited = createContext<{ rows: Css; fontSize: number }>({ rows: {}, fontSize: 16 });
interface GroupState { hover: boolean; focus: boolean; report(kind: 'hover' | 'focus', on: boolean): void }
const Group = createContext<GroupState | null>(null);
/** Scroll views of row pagers, by row id, so pageNext/pagePrev can move them. */
interface Scroller { scrollTo(options: { x: number; animated: boolean }): void }
const pagers = new Map<string, { view: Scroller; x: number; width: number }>();
/** The masked-view package's class types predate React 19's JSX types. */
const Masked = MaskedView as unknown as ComponentType<{ style?: ViewStyle; maskElement: ReactNode; children: ReactNode }>;

const AView = Animated.View;
const AText = Animated.Text;
const AScroll = Animated.ScrollView;
const web = Platform.OS === 'web';

function useHost(): SkinHost {
  const host = useContext(Host);
  if (!host) throw new Error('Skin nodes draw inside <SkinRoot>');
  return host;
}

export function SkinRoot({ host, node }: { host: SkinHost; node: RNode }) {
  useEffect(() => {
    if (host.doc.unsupported.length) console.warn(`${host.doc.name}: rows outside the React Native style matrix: ${host.doc.unsupported.join(', ')}`);
  }, [host.doc]);
  return (
    <Host.Provider value={host}>
      <SkinNode node={node} ctx={{ index: 0 }} />
    </Host.Provider>
  );
}

/** A route tree: its root's children scroll in the route's own vertical ScrollView. */
export function SkinRoute({ host, node }: { host: SkinHost; node: RNode }) {
  return (
    <Host.Provider value={host}>
      <SkinNode node={node} ctx={{ index: 0 }} route />
    </Host.Provider>
  );
}

function SkinNode({ node, ctx, route }: { node: RNode; ctx: Ctx; route?: boolean }) {
  const { env } = useHost();
  if (node.kind === 'repeat') {
    return (
      <>
        {collection(node.over, ctx, env, node.limit).map(c =>
          holds(node.when, c, env) ? <SkinNode key={`${c.index}:${c.card?.id ?? c.row?.id ?? c.hero?.id ?? c.dest?.id ?? ''}`} node={node.item} ctx={c} /> : null)}
      </>
    );
  }
  if (!holds(node.when, ctx, env)) return null;
  switch (node.kind) {
    case 'box': return <Box node={node} ctx={ctx} route={route} />;
    case 'text': return <TextNode node={node} ctx={ctx} />;
    case 'image': return <ImageNode node={node} ctx={ctx} />;
    case 'icon': return <Icon node={node} ctx={ctx} />;
    case 'slot': return <Slot node={node} ctx={ctx} />;
    case 'widget': return <Widget node={node} ctx={ctx} />;
  }
}

// ---- Style: layers, overlays, translation ----

const MOVES = new Set(['scale', 'translate', 'rotate', 'transition', 'animation']);

function filled(css: CssT | undefined, c: Ctx, e: Env, still: boolean): Css {
  const out: Css = {};
  for (const [row, value] of Object.entries(css ?? {})) if (!(still && MOVES.has(row))) out[row] = fill(value, c, e);
  return out;
}

interface Interaction { hover: boolean; focus: boolean; active: boolean }

/** The rows in force: the first holding state's layer (or the base), its overlays, then pressed and disabled. */
function rowsFor(node: RNode, c: Ctx, e: Env, ui: Interaction, group: GroupState | null, disabled: boolean): Css {
  // The holding state's overlays replace the node's; a state without one keeps the node's (docs/skin-schema.md, "Node features").
  const state: Layer | undefined = node.states.find(s => holds(s.when, c, e))?.layer;
  const look = (kind: 'hover' | 'focus' | 'groupHover' | 'groupFocus') => state?.[kind] ?? node.base[kind];
  const rows: Css = filled((state ?? node.base).style, c, e, false);
  const overlay = (css: CssT | undefined) => Object.assign(rows, filled(css, c, e, e.still));
  if (group?.hover) overlay(look('groupHover'));
  if (group?.focus) overlay(look('groupFocus'));
  if (ui.hover) overlay(look('hover'));
  // On TV, focus is the only pointer: a node with a hover look and no focus look shows its hover look.
  if (ui.focus) overlay(look('focus') ?? (Platform.isTV ? look('hover') : undefined));
  if (ui.active) overlay(node.active);
  if (disabled) overlay(node.disabledStyle);
  return rows;
}

const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  const value = make();
  if (cache.size > 6000) cache.clear();
  cache.set(key, value);
  return value;
}

function split(rows: Css): { own: Css; inherited: Css } {
  const own: Css = {}, inherited: Css = {};
  for (const [row, v] of Object.entries(rows)) (INHERITED.has(row) ? inherited : own)[row] = v;
  return { own, inherited };
}

function measure(viewport: Viewport, fontSize: number): Measure {
  return { viewport, fontSize, axis: 'x' };
}

function translatedBox(rows: Css, viewport: Viewport, fontSize: number) {
  return cached(`b${viewport.width}x${viewport.height}|${fontSize}|${JSON.stringify(rows)}`, () => boxStyle(rows, measure(viewport, fontSize)));
}

/** The text context children inherit: the parent's rows with this node's inherited rows over them. */
function inheritFrom(parent: { rows: Css; fontSize: number }, inherited: Css, viewport: Viewport) {
  if (!Object.keys(inherited).length) return parent;
  const fontSize = fontSizeOf(inherited['font-size'], parent.fontSize, measure(viewport, parent.fontSize));
  return { rows: { ...parent.rows, ...inherited, 'font-size': `${fontSize}px` }, fontSize };
}

function a11yProps(node: RNode, c: Ctx, e: Env) {
  const role = node.role === 'heading' ? 'header' : node.role === 'button' ? 'button' : node.role === 'link' ? 'link' : node.role === 'img' ? 'image' : undefined;
  const label = node.label ? fill(node.label, c, e) : undefined;
  const state = node.a11y && {
    selected: node.a11y.selected ? holds(node.a11y.selected, c, e) : undefined,
    expanded: node.a11y.expanded ? holds(node.a11y.expanded, c, e) : undefined,
    checked: node.a11y.checked ? holds(node.a11y.checked, c, e) : undefined,
  };
  return {
    accessibilityRole: role,
    accessibilityLabel: label || undefined,
    accessibilityState: state,
    accessibilityElementsHidden: node.hidden || undefined,
    importantForAccessibility: node.hidden ? ('no-hide-descendants' as const) : undefined,
    testID: node.testId ? fill(node.testId, c, e) : undefined,
    nativeID: node.id ? fill(node.id, c, e) : undefined,
  };
}

// ---- Box ----

/** The rows that size and place a box, which a mask wrapper takes over from it. */
const GEOMETRY = new Set(['position', 'top', 'right', 'bottom', 'left', 'zIndex', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'aspectRatio', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft']);
/** The rows that lay out a scroll box's content. */
const CONTENT = new Set(['flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'alignContent', 'rowGap', 'columnGap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);

function partition(style: Record<string, unknown>, keys: Set<string>): [Record<string, unknown>, Record<string, unknown>] {
  const inside: Record<string, unknown> = {}, outside: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) (keys.has(k) ? inside : outside)[k] = v;
  return [inside, outside];
}

function Box({ node, ctx, route }: { node: Extract<RNode, { kind: 'box' }>; ctx: Ctx; route?: boolean }) {
  const host = useHost();
  const { env, viewport } = host;
  const parentText = useContext(Inherited);
  const parentGroup = useContext(Group);
  const [ui, setUi] = useState<Interaction>({ hover: false, focus: false, active: false });
  const [groupUi, setGroupUi] = useState({ hover: false, focus: false });
  const [gridWidth, setGridWidth] = useState(0);
  const scrollRef = useRef<Scroller>(null);

  const disabled = node.disabled ? holds(node.disabled, ctx, env) : false;
  const rows = rowsFor(node, ctx, env, ui, parentGroup, disabled);
  const { own, inherited } = split(rows);
  const text = inheritFrom(parentText, inherited, viewport);
  const { style, fx } = translatedBox(own, viewport, text.fontSize);
  const motion = animation(node.motion, host.doc.keyframes, env.still, ctx.index, node.stagger);
  const rowId = ctx.row?.id ?? '';

  const report = useCallback((kind: 'hover' | 'focus', on: boolean) => {
    setGroupUi(g => (g[kind] === on ? g : { ...g, [kind]: on }));
  }, []);
  const groupValue = useMemo<GroupState | null>(() => (node.group ? { ...groupUi, report } : parentGroup), [node.group, groupUi, report, parentGroup]);
  const set = (kind: keyof Interaction, on: boolean) => {
    setUi(u => (u[kind] === on ? u : { ...u, [kind]: on }));
    if (kind !== 'active') groupValue?.report(kind, on);
  };

  useEffect(() => {
    if (!node.pager || !fx.scrollX || !rowId) return;
    const view = scrollRef.current;
    if (view) pagers.set(rowId, { view, x: 0, width: viewport.width });
    return () => { pagers.delete(rowId); };
  }, [node.pager, fx.scrollX, rowId, viewport.width]);

  if (fx.hidden) return null;

  const children = node.children.map((child, i) => <SkinNode key={i} node={child} ctx={ctx} />);
  let content: ReactNode = children;
  if (fx.grid && gridWidth > 0) {
    const gap = fx.grid.gap;
    const count = fx.grid.count ?? Math.max(1, Math.floor((gridWidth + gap) / ((fx.grid.min ?? 160) + gap)));
    const cell = (gridWidth - gap * (count - 1)) / count;
    content = children.map((child, i) => <View key={i} style={{ width: cell }}>{child}</View>);
  }
  const layers = (
    <>
      {fx.backdropBlur ? <BlurView intensity={Math.min(100, Math.round(fx.backdropBlur * 2.5))} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      {fx.backgroundUrl ? <BackgroundImage src={fx.backgroundUrl} /> : null}
    </>
  );
  const boxStyleFinal: Record<string, unknown> = { ...style, ...(fx.grid ? { flexDirection: 'row', flexWrap: 'wrap' } : {}), ...(fx.backdropBlur ? { overflow: 'hidden' } : {}), ...motion };
  const a11y = a11yProps(node, ctx, env);
  const hoverProps = web && (node.base.hover || node.group || node.states.some(s => s.layer.hover))
    ? { onMouseEnter: () => set('hover', true), onMouseLeave: () => set('hover', false) } : {};
  const onLayout = fx.grid ? (e: LayoutChangeEvent) => setGridWidth(e.nativeEvent.layout.width - (Number(style.paddingLeft) || 0) - (Number(style.paddingRight) || 0)) : undefined;

  let element: ReactNode;
  if (route || fx.scrollX || fx.scrollY) {
    const horizontal = !route && !!fx.scrollX && !fx.scrollY;
    const [contentStyle, outerStyle] = partition(boxStyleFinal, CONTENT);
    const sticky = horizontal ? undefined : node.children.flatMap((child, i) => (child.base.style.position === 'sticky' && holds(child.when, ctx, env) ? [i] : []));
    const onScroll = node.pager && rowId ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const pager = pagers.get(rowId);
      if (pager) { pager.x = contentOffset.x; pager.width = layoutMeasurement.width; }
      host.setPager(rowId, { atStart: contentOffset.x <= 1, atEnd: contentOffset.x + layoutMeasurement.width >= contentSize.width - 1 });
    } : undefined;
    element = (
      <AScroll ref={scrollRef as never} horizontal={horizontal} style={route ? [{ flex: 1 }, outerStyle as ViewStyle] : (outerStyle as ViewStyle)}
        contentContainerStyle={[contentStyle as ViewStyle, route ? { flexGrow: 1 } : null]} stickyHeaderIndices={sticky?.length ? sticky : undefined}
        showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={!horizontal && !Platform.isTV} onScroll={onScroll} scrollEventThrottle={64}
        onLayout={onLayout} {...a11y}>
        {content}
      </AScroll>
    );
  } else {
    // A press box is the schema's full-size transparent button over its content: the button takes
    // focus (keyboard, tvOS focus engine, D-pad) and carries the label; the box keeps its motion.
    const press = node.press;
    const button = press ? (
      <Pressable style={[StyleSheet.absoluteFill, ownFocusLook(node) ? NO_RING : null]} disabled={disabled}
        onPress={() => host.dispatch(press.action, fill(press.arg, ctx, env))}
        onFocus={() => set('focus', true)} onBlur={() => set('focus', false)}
        onHoverIn={() => set('hover', true)} onHoverOut={() => set('hover', false)}
        onPressIn={() => set('active', true)} onPressOut={() => set('active', false)}
        accessibilityRole={a11y.accessibilityRole ?? 'button'} accessibilityLabel={a11y.accessibilityLabel} accessibilityState={a11y.accessibilityState}
        testID={a11y.testID} />
    ) : null;
    element = (
      <AView style={boxStyleFinal as ViewStyle} onLayout={onLayout} {...hoverProps} {...(press ? { nativeID: a11y.nativeID } : a11y)}>
        {layers}
        {content}
        {button}
      </AView>
    );
  }
  if (fx.mask) element = <Mask mask={fx.mask} style={boxStyleFinal}>{element}</Mask>;
  return (
    <Inherited.Provider value={text}>
      <Group.Provider value={groupValue}>{element}</Group.Provider>
    </Inherited.Provider>
  );
}

/** The press button inside a box never draws the platform ring: the box is the clipping element,
 * so the ring is the box's own, drawn from its focus look (`outline: auto` keeps the platform ring
 * on the box). A press box without any focus look keeps the button's ring. */
function ownFocusLook(node: RNode): boolean {
  return web && [node.base.focus, ...node.states.map(s => s.layer.focus)].some(Boolean);
}
const NO_RING = { outlineWidth: 0 } as ViewStyle;

/** A native gradient mask: the mask takes the box's geometry; the box fills it. */
function Mask({ mask, style, children }: { mask: NonNullable<Effects['mask']>; style: Record<string, unknown>; children: ReactNode }) {
  const [geometry] = partition(style, GEOMETRY);
  return (
    <Masked style={geometry as ViewStyle} maskElement={
      <LinearGradient colors={mask.colors as [string, string, ...string[]]} locations={mask.locations as [number, number, ...number[]]} start={mask.start} end={mask.end} style={StyleSheet.absoluteFill} />
    }>
      <View style={StyleSheet.absoluteFill}>{children}</View>
    </Masked>
  );
}

function BackgroundImage({ src }: { src: string }) {
  const host = useHost();
  const source = host.image(src);
  return source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /> : null;
}

// ---- Leaves ----

function useLeafStyle(node: RNode, ctx: Ctx) {
  const { env, viewport, doc } = useHost();
  const parentText = useContext(Inherited);
  const group = useContext(Group);
  const rows = rowsFor(node, ctx, env, { hover: false, focus: false, active: false }, group, false);
  const { own, inherited } = split(rows);
  const text = inheritFrom(parentText, inherited, viewport);
  const { style, fx } = translatedBox(own, viewport, text.fontSize);
  const motion = animation(node.motion, doc.keyframes, env.still, ctx.index, node.stagger);
  return { own, text, style: { ...style, ...motion } as Record<string, unknown>, fx };
}

function TextNode({ node, ctx }: { node: Extract<RNode, { kind: 'text' }>; ctx: Ctx }) {
  const { env, viewport } = useHost();
  const { own, text, style, fx } = useLeafStyle(node, ctx);
  const drawn = cached(`t${viewport.width}x${viewport.height}|${text.fontSize}|${JSON.stringify(text.rows)}|${own['text-overflow'] ?? ''}|${own['line-clamp'] ?? ''}`,
    () => textStyle({ ...text.rows, ...pick(own, ['text-overflow', 'line-clamp']) }, measure(viewport, text.fontSize)));
  if (fx.hidden) return null;
  const value = fill(node.text, ctx, env);
  // A text drawn as a centring flex box (a badge, an initial in a circle) centres its line.
  const centred: { textAlign?: TextStyle["textAlign"]; lineHeight?: number } = {};
  if (own['justify-content'] === 'center' && !text.rows['text-align']) centred.textAlign = 'center';
  if (own['align-items'] === 'center' && typeof style.height === 'number' && !text.rows['line-height']) {
    centred.lineHeight = style.height - (Number(style.borderTopWidth ?? style.borderWidth) || 0) - (Number(style.borderBottomWidth ?? style.borderWidth) || 0);
  }
  return (
    <AText style={[drawn.style, style as TextStyle, centred]} numberOfLines={drawn.numberOfLines} ellipsizeMode={drawn.ellipsize ? 'tail' : undefined} {...a11yProps(node, ctx, env)}>
      {value}
    </AText>
  );
}

function pick(rows: Css, keys: string[]): Css {
  return Object.fromEntries(keys.filter(k => rows[k] !== undefined).map(k => [k, rows[k]]));
}

function ImageNode({ node, ctx }: { node: Extract<RNode, { kind: 'image' }>; ctx: Ctx }) {
  const host = useHost();
  const { style, fx } = useLeafStyle(node, ctx);
  if (fx.hidden) return null;
  const source = host.image(fill(node.src, ctx, host.env));
  const alt = node.alt ? fill(node.alt, ctx, host.env) : '';
  // The box carries the node's style and motion; the image fills it.
  return (
    <AView style={style as ViewStyle} pointerEvents="none" accessible={!!alt} accessibilityLabel={alt || undefined} accessibilityRole={alt ? 'image' : undefined}>
      {source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit={fx.contentFit ?? 'fill'} blurRadius={fx.imageBlur} transition={node.fade ? 420 : 0} /> : null}
    </AView>
  );
}

function Icon({ node, ctx }: { node: Extract<RNode, { kind: 'icon' }>; ctx: Ctx }) {
  const { style, text, fx } = useLeafStyle(node, ctx);
  if (fx.hidden) return null;
  const symbol = node.symbol ? SYMBOLS[node.symbol] : undefined;
  const paths = node.paths ?? symbol?.paths ?? [];
  const color = textStyle(text.rows, { viewport: { width: 0, height: 0, insets: { top: 0, right: 0, bottom: 0, left: 0 } }, fontSize: text.fontSize, axis: 'x' }).style.color as string | undefined ?? '#fff';
  const size = text.fontSize;
  return (
    <AView style={[{ width: size, height: size }, style as ViewStyle]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={node.viewBox ?? '0 0 24 24'}>
        {paths.map((d, i) => symbol?.stroke && !node.paths
          ? <Path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          : <Path key={i} d={d} fill={color} fillRule={node.fillRule ?? 'nonzero'} />)}
      </Svg>
    </AView>
  );
}

function Slot({ node, ctx }: { node: Extract<RNode, { kind: 'slot' }>; ctx: Ctx }) {
  const host = useHost();
  const { style, text, fx } = useLeafStyle(node, ctx);
  const inner = node.inner ? translatedBox(split(filled(node.inner, ctx, host.env, false)).own, host.viewport, text.fontSize).style : undefined;
  if (fx.hidden) return null;
  const content = node.slot === 'children' ? host.children : <SearchField params={{}} ctx={ctx} />;
  return (
    <Inherited.Provider value={text}>
      <AView style={style as ViewStyle}>
        <View style={inner as ViewStyle}>{content}</View>
      </AView>
    </Inherited.Provider>
  );
}

function Widget({ node, ctx }: { node: Extract<RNode, { kind: 'widget' }>; ctx: Ctx }) {
  const { style, text, fx } = useLeafStyle(node, ctx);
  if (fx.hidden) return null;
  switch (node.widget) {
    case 'searchInput':
      return (
        <Inherited.Provider value={text}>
          <AView style={style as ViewStyle}><SearchField params={node.params} ctx={ctx} /></AView>
        </Inherited.Provider>
      );
    default:
      // Widgets outside the spike (install, observe, sentinel, select, previews, live tile) draw nothing yet.
      return null;
  }
}

function SearchField({ params, ctx }: { params: Record<string, string>; ctx: Ctx }) {
  const host = useHost();
  const text = useContext(Inherited);
  const drawn = textStyle(text.rows, measure(host.viewport, text.fontSize));
  const placeholder = params.placeholder ? withClientStrings(params.placeholder) : undefined;
  const label = params.label ? withClientStrings(params.label) : placeholder;
  return (
    <TextInput value={host.env.query} onChangeText={host.setQuery} placeholder={placeholder} accessibilityLabel={label}
      placeholderTextColor={params.placeholderColor ?? (drawn.style.color as string | undefined)} autoCorrect={false} autoCapitalize="none"
      returnKeyType="search" testID={`search-${ctx.index}`} nativeID="vela-search"
      onFocus={() => host.setFlag('search-focused', true)} onBlur={() => host.setFlag('search-focused', false)}
      style={[drawn.style, { flex: 1, minWidth: 0, padding: 0, ...(web ? { outlineStyle: 'none' } : {}) } as TextStyle]} />
  );
}

/** Move a row's pager by a page: max(200, width - 2 x inset - peek). */
export function page(rowId: string, direction: 1 | -1, inset = 0, peek = 0): void {
  const pager = pagers.get(rowId);
  if (!pager) return;
  const step = Math.max(200, pager.width - 2 * inset - peek);
  pager.view.scrollTo({ x: Math.max(0, pager.x + direction * step), animated: true });
}

