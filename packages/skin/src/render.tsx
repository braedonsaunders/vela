import { ScreenActive } from './screen-active';
export { ScreenActive } from './screen-active';
import { sameRouteHost } from './route-host';
import { WebLibraryGrid } from './web-library-grid';
import { msg } from '@vela/core';
import { restartAction, secondaryPlayAction } from './restart-action';
import { CardContextMenu, type CardMenuAnchor, type CardMenuOpenMode } from './widgets/card-context-menu';
import { visibleRowItems } from './row-visible';
import { EpisodeNavigation, episodeNavigation } from './episode-navigation';
import { inheritText as inheritFrom } from './text-inheritance';
import { hasFlowHeader } from './resolve/inherit';
// The skin document renderer: one recursive component per node kind over a resolved document
// (resolve.ts). A node's style is its state's layer with the hover, focus, group and pressed
// overlays in force, translated per the style matrix (translate.ts); text rows inherit down the
// tree through context and are drawn at text nodes. Presses dispatch the document's actions to
// the host, which owns navigation and data; nothing in a document executes.
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import type { ComponentType } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Children, memo, cloneElement, createContext, forwardRef, useImperativeHandle, useCallback, useContext, useEffect, useMemo, useRef, useState, useLayoutEffect, type ReactElement, type ReactNode } from 'react';
import { Animated as RNAnimated, Platform, Pressable, RefreshControl, StyleSheet, Text, TVFocusGuideView, View, useTVEventHandler, type GestureResponderEvent, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { Viewport } from './css';
import { GroupContext, HostContext, InheritedContext, WidgetInteractionContext, measure, useHost, type GroupState, type SkinHost } from './host';
import { EscapeScope, focusElement, focusTarget, noteOpener, notePress, scopeOpen, trackButton, type Focusable } from './escape';
import { SYMBOLS } from './icons';
import { useFocusStyles } from './focus';
import { focusStyle } from './focus-style';
import { isFocusVisible } from './focus-visible';
import { RouteFocusContext, useRouteFocus, useRouteFocusContext } from './route-focus';
import { RevealContext, noteTopBar, revealer, revealing } from './tv-reveal';
import { FOCUSABLE_WIDGETS, WIDGETS } from './widgets';
import { ExpandableSummary } from './summary';
import { VersionsControl } from './widgets/title-actions';
import { SeasonSelector } from './widgets/season-selector';
import { SearchField } from './widgets/search/search-field';
import { animation } from './motion';
import { needsAnimatedFrame } from './animated-frame';
import { useHeroSwipe } from './hero-swipe';
import { resolveUi } from './resolve/ui';
import { fill, holds, type CssT, type Layer, type RNode, type ResolvedDocument } from './resolve';
import { INHERITED, boxStyle, textStyle, type Css, type Effects } from './translate';
import { collection, itemKey, type Card, type Ctx, type Env } from './vocabulary';
import { stickyLimit, stickyOffset, type StickyLayout } from './sticky-layout';
import { pointerPolicy, type PointerMode } from './pointer-policy';
import { moveWebRowFocus } from './web-row-navigation';

const ROOT_CONTEXT: Ctx = { index: 0 };
function contextCard(id: string, kind: string, name: string, image = ''): Card {
  return {
    id, kind, name, summary: '', airDate: '', year: 0, rating: '', durationSeconds: 0,
    progressSeconds: 0, played: false, favorite: false, watchlisted: false, showId: '',
    showName: '', episodeContext: '', contextParts: [], seasonId: '', seasonNumber: 0,
    episodeNumber: 0, genres: [], durationLabel: '', yearLabel: '', progressLabel: '',
    seasonNumberLabel: '', episodeNumberLabel: '', facts: '', poster: image, backdrop: image,
    logo: '', accent: '', receipt: '',
  };
}
function channelCard(channel: NonNullable<Ctx['ch']>): Card {
  return {
    ...contextCard(channel.id, 'channel', channel.now || channel.name, channel.nowArt),
    summary: channel.next, favorite: channel.favorite, showName: channel.name,
    episodeContext: channel.nowEpisode, genres: channel.nowGenre ? [channel.nowGenre] : [],
    facts: [channel.number, channel.name].filter(Boolean).join(' · '), logo: channel.logo,
  };
}
const useTVMenuEvent = typeof useTVEventHandler === 'function'
  ? useTVEventHandler
  : (_handler: (event: { eventType?: string }) => void) => undefined;
const Host = HostContext;
const Inherited = InheritedContext;
const Group = GroupContext;
/** The direction of the parent's flex layout (native shrinking follows it; see shrinkFor). */
const Direction = createContext<'row' | 'column'>('column');
const PointerInheritance = createContext<PointerMode>('auto');
/** A direct child of a route: on TV one focus band (see tvGuide). */
const Band = createContext(false);
/** On TV, a section of a scroll with nothing focusable from it on: a reading stop (readingStops). */
const ReadingStop = createContext(false);
/** First content layout releases the skeleton covering a newly loaded route. */
const InstantContent = createContext(false);
const RouteLayout = createContext<{ grid(): void; drawn(): void } | null>(null);
const LoadingLibraryNav = createContext(false);
const HiddenLibraryNav = createContext(false);
/** Scroll views of row pagers, by row id, so pageNext/pagePrev can move them. */
interface Scroller { scrollTo(options: { x?: number; y?: number; animated: boolean }): void }
const pagers = new Map<string, { view: Scroller; x: number; width: number; contentWidth: number }>();
/** The masked-view package's class types predate React 19's JSX types. */
const Masked = MaskedView as unknown as ComponentType<{ style?: ViewStyle; maskElement: ReactNode; children: ReactNode; pointerEvents?: 'box-none' }>;

const AView = Animated.View;
const AText = Animated.Text;
const frameFor = (node: RNode) => web || needsAnimatedFrame(node) ? AView : View;
const AScroll = Animated.ScrollView;
const web = Platform.OS === 'web';
/** A box that is also a TV focus guide (react-native-web has no focus guide, so only on TV). */
const AGuide = Platform.isTV ? Animated.createAnimatedComponent(TVFocusGuideView) : AView;
const HOME_SLOW_NODE: Extract<RNode, { kind: 'widget' }> = {
  kind: 'widget', widget: 'homeSlow', params: {}, when: [], base: { style: {} }, states: [], group: false, order: 0,
};


export function SkinRoot({ host, node }: { host: SkinHost; node: RNode }) {
  useFocusStyles();
  useEffect(() => {
    if (host.doc.unsupported.length) console.warn(`${host.doc.name}: rows outside the React Native style matrix: ${host.doc.unsupported.join(', ')}`);
  }, [host.doc]);
  return (
    <Host.Provider value={host}>
      <SkinNode node={node} ctx={ROOT_CONTEXT} />
    </Host.Provider>
  );
}

/** A route tree: its root's children scroll in the route's own vertical ScrollView. `after` is a
 * tree drawn in the same view after the route's own nodes (search, in home's view, while a query is open). */
function SkinRouteView({ host, node, after, hideLibraryViews = false }: { host: SkinHost; node: RNode; after?: RNode; hideLibraryViews?: boolean }) {
  useFocusStyles();
  const focus = useRouteFocus();
  const episodeNav = useMemo(episodeNavigation, []);
  const loading = useRef<SkinHost | null>(null);
  const gridWaiting = useRef(false);
  const [, reveal] = useState(0);
  const section = host.env.route === 'home' || host.env.route === 'library';
  if (section && host.env.load === 'loading') loading.current = host;
  const layout = useMemo(() => ({
    grid() { gridWaiting.current = true; },
    drawn() {
      if (!loading.current) return;
      loading.current = null;
      reveal(value => value + 1);
    },
  }), []);
  useLayoutEffect(() => {
    if (host.env.load !== 'ready' || !loading.current) return;
    // Non-grid routes (including empty libraries) need a committed layout too.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => { if (!gridWaiting.current) layout.drawn(); });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [host.env.load, layout]);
  const cover = host.env.load === 'ready' ? loading.current : null;
  // The cover is the skeleton held over the content until it has laid out. It is opaque (the page's
  // own ground): a see-through cover showed the skeleton and the content over each other. Once the
  // content is drawn the cover leaves with a short fade.
  const [leaving, setLeaving] = useState<SkinHost | null>(null);
  const shown = useRef<SkinHost | null>(null);
  useLayoutEffect(() => {
    if (cover) shown.current = cover;
    else if (shown.current) {
      setLeaving(shown.current);
      shown.current = null;
    }
  }, [cover]);
  const ground = uiOf(host.doc).page;
  const clearLeaving = useCallback(() => setLeaving(null), []);
  const loadingLibraryNav = host.env.route === 'library' && (host.env.load !== 'ready' || !!cover || !!leaving);
  // Once TV content is ready, keep its switch in the focus tree even while the cover fades.
  const floatingLibraryNav = loadingLibraryNav && !(Platform.isTV && host.env.load === 'ready');
  const navTop = hasFlowHeader(host.doc.document.slots?.shell) ? 0 : 56 + host.viewport.insets.top;
  return (
    <View style={{ flex: 1 }}>
      <Host.Provider value={host}>
        <EpisodeNavigation.Provider value={episodeNav}><RouteFocusContext.Provider value={focus}>
          <RouteLayout.Provider value={layout}>
            <InstantContent.Provider value={section && host.env.load === 'ready'}>
              <HiddenLibraryNav.Provider value={hideLibraryViews || floatingLibraryNav}>
                {floatingLibraryNav && host.env.load !== 'ready' ? (
                  <View style={{ flex: 1, paddingTop: navTop === 0 ? 48 : 16 }}><SkinNode node={node} ctx={ROOT_CONTEXT} route after={after} /></View>
                ) : <SkinNode node={node} ctx={ROOT_CONTEXT} route after={after} />}
              </HiddenLibraryNav.Provider>
            </InstantContent.Provider>
          </RouteLayout.Provider>
        </RouteFocusContext.Provider></EpisodeNavigation.Provider>
      </Host.Provider>
      {cover || leaving ? (
        <SkeletonCover key={cover ? 'held' : 'leaving'} host={(cover ?? leaving)!} node={node} ground={ground}
          leaving={!cover} onGone={clearLeaving} />
      ) : null}
      {host.env.route === 'home' && host.env.homeSlow ? (
        <View style={StyleSheet.absoluteFill}>
          <Host.Provider value={host}><Widget node={HOME_SLOW_NODE} ctx={ROOT_CONTEXT} /></Host.Provider>
        </View>
      ) : null}
      {floatingLibraryNav && host.doc.libraryViews && !hideLibraryViews ? (
        <View style={{ position: 'absolute', top: navTop, left: 0, right: 0, zIndex: 20 }}>
          <Host.Provider value={host}><LoadingLibraryNav.Provider value><SkinNode node={host.doc.libraryViews} ctx={ROOT_CONTEXT} /></LoadingLibraryNav.Provider></Host.Provider>
        </View>
      ) : null}
    </View>
  );
}

export const SkinRoute = memo(SkinRouteView, (a, b) => a.node === b.node && a.after === b.after
  && a.hideLibraryViews === b.hideLibraryViews
  && sameRouteHost(a.host, b.host, [b.node, b.after, b.host.doc.libraryViews]));

/** The shared switch outside an animated library scene. */
export function SkinLibraryViews({ host }: { host: SkinHost }) {
  return host.doc.libraryViews ? <Host.Provider value={host}><LoadingLibraryNav.Provider value><SkinNode node={host.doc.libraryViews} ctx={ROOT_CONTEXT} /></LoadingLibraryNav.Provider></Host.Provider> : null;
}

/** The skeleton over a route that is still laying out: opaque, then a short fade once released. */
function SkeletonCover({ host, node, ground, leaving, onGone }: {
  host: SkinHost; node: RNode; ground: string; leaving: boolean; onGone(): void;
}) {
  const opacity = useRef(new RNAnimated.Value(1)).current;
  useEffect(() => {
    if (!leaving) return;
    const fade = RNAnimated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' });
    fade.start(() => onGone());
    return () => fade.stop();
  }, [leaving, opacity, onGone]);
  return (
    <RNAnimated.View style={[StyleSheet.absoluteFill, { backgroundColor: ground, opacity }]} pointerEvents="none"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Host.Provider value={host}><InstantContent.Provider value><SkinNode node={node} ctx={ROOT_CONTEXT} route /></InstantContent.Provider></Host.Provider>
    </RNAnimated.View>
  );
}

function SkinNodeView({ node, ctx, route, after, hero }: { node: RNode; ctx: Ctx; route?: boolean; after?: RNode; hero?: boolean }) {
  const { env } = useHost();
  const loadingLibraryNav = useContext(LoadingLibraryNav);
  const hiddenLibraryNav = useContext(HiddenLibraryNav);
  if (!loadingLibraryNav && env.route === 'library' && env.load !== 'ready' && node.id === 'vela-library-views') return null;
  if (hiddenLibraryNav && node.kind === 'box' && node.base.style.position === 'sticky'
    && node.children.some(child => child.id === 'vela-library-views')) {
    return <View style={{ opacity: 0, width: '100%' }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Box node={node} ctx={ctx} route={route} after={after} hero={hero} />
    </View>;
  }
  if (hiddenLibraryNav && node.id === 'vela-library-views' && (node.kind === 'box' || node.kind === 'widget')) {
    return <View style={{ opacity: 0, width: '100%' }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {node.kind === 'box' ? <Box node={node} ctx={ctx} /> : <Widget node={node} ctx={ctx} />}
    </View>;
  }
  if (node.kind === 'repeat') {
    if (node.over === 'detail.seasons' && (env.detail?.seasons.length ?? 0) > 8) {
      return <SeasonSelector ctx={ctx} />;
    }
    return (
      <>
        {collection(node.over, ctx, env, node.limit).map(c => {
          const context = c.row && c.row !== ctx.row ? { ...c, rowVisibleCount: visibleRowItems(node.item, c, env) } : c;
          return holds(node.when, c, env) ? <SkinNode key={itemKey(c, node.over)} node={node.item} ctx={context} hero={node.over === 'home.hero'} /> : null;
        })}
      </>
    );
  }
  if (!holds(node.when, ctx, env)) return null;
  switch (node.kind) {
    case 'box': return <Box node={node} ctx={ctx} route={route} after={after} hero={hero} />;
    case 'text': return <TextNode node={node} ctx={ctx} />;
    case 'image': return <ImageNode node={node} ctx={ctx} />;
    case 'icon': return <Icon node={node} ctx={ctx} />;
    case 'slot': return <Slot node={node} ctx={ctx} />;
    case 'widget': return <Widget node={node} ctx={ctx} />;
  }
}

// Local focus changes redraw that control/group, not every sibling in its row.
const SkinNode = memo(SkinNodeView, (a, b) => a.node === b.node && a.route === b.route
  && a.after === b.after && a.hero === b.hero
  && (a.ctx === b.ctx || Object.keys(a.ctx).length === Object.keys(b.ctx).length
    && (Object.keys(a.ctx) as (keyof Ctx)[]).every(key => a.ctx[key] === b.ctx[key])));

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
  // The holding state's overlays replace the node's; a state without one keeps the node's (docs/skin-schema.md).
  const state: Layer | undefined = node.states.find(s => holds(s.when, c, e))?.layer;
  const look = (kind: 'hover' | 'focus' | 'groupHover' | 'groupFocus') => state?.[kind] ?? node.base[kind];
  const rows: Css = filled((state ?? node.base).style, c, e, false);
  // `outline: auto` in a plain style is the platform's focus ring (CSS's :focus-visible outline):
  // it draws only while the node is focused. Written inside a focus look, it applies as written.
  const ring = rows.outline === 'auto';
  if (ring) delete rows.outline;
  const overlay = (css: CssT | undefined) => Object.assign(rows, filled(css, c, e, e.still));
  if (group?.hover) overlay(look('groupHover'));
  if (group?.focus) overlay(look('groupFocus'));
  if (ui.hover) overlay(look('hover'));
  // On TV, focus is the only pointer: a node with a hover look and no focus look shows its hover look.
  if (ui.focus) overlay(look('focus') ?? (Platform.isTV ? look('hover') : undefined));
  if (ui.focus && ring && rows.outline === undefined) rows.outline = 'auto';
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


/** CSS flex items shrink, but a column item never below its content (min-height: auto); Yoga has
 * no automatic minimum, so natively a column's items keep their size unless the document says
 * how they shrink. Row items shrink, as CSS's do, so long text can ellipsize. */
function shrinkFor<T extends object>(style: T, own: Css, parent: 'row' | 'column'): T {
  if (web || parent === 'row' || own['flex-shrink'] !== undefined || own.flex !== undefined) return style;
  return { ...style, flexShrink: 0 };
}

function translatedBox(rows: Css, viewport: Viewport, fontSize: number) {
  return cached(`b${viewport.width}x${viewport.height}|${fontSize}|${JSON.stringify(rows)}`, () => boxStyle(rows, measure(viewport, fontSize)));
}

function a11yProps(node: RNode, c: Ctx, e: Env) {
  const role = node.role === 'heading' ? 'header' : node.role === 'button' ? 'button' : node.role === 'link' ? 'link' : node.role === 'tab' ? 'tab' : node.role === 'img' ? 'image' : undefined;
  const label = node.label ? fill(node.label, c, e) : undefined;
  const state = node.a11y && {
    selected: node.a11y.selected ? holds(node.a11y.selected, c, e) : undefined,
    expanded: node.a11y.expanded ? holds(node.a11y.expanded, c, e) : undefined,
    checked: node.a11y.checked ? holds(node.a11y.checked, c, e) : undefined,
  };
  return {
    accessibilityRole: role,
    role: web && node.role === 'status' ? ('status' as const) : web && node.role === 'navigation' ? ('navigation' as const) : undefined,
    accessibilityLiveRegion: node.role === 'status' && (web || Platform.OS === 'android')
      ? ('polite' as const) : undefined,
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
// A route is the page the window scrolls, so its minimum height is its content's, as in CSS:
// a `min-height: 100dvh` stage fills the window and centres within it.
const ROUTE_CONTENT = new Set([...CONTENT, 'minHeight']);

function partition(style: Record<string, unknown>, keys: Set<string>): [Record<string, unknown>, Record<string, unknown>] {
  const inside: Record<string, unknown> = {}, outside: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) (keys.has(k) ? inside : outside)[k] = v;
  return [inside, outside];
}

interface StickyHeaderProps {
  children?: ReactNode;
  scrollAnimatedValue: RNAnimated.Value;
  nextHeaderLayoutY?: number;
  onLayout(event: LayoutChangeEvent): void;
}

/** Native ScrollView's default sticky wrapper forces zIndex 10. A backdrop must retain its
 * authored order below foreground content, just as position: sticky does on the web. */
const NativeStickyHeader = forwardRef<{ setNextHeaderY(y: number): void }, StickyHeaderProps>(function NativeStickyHeader(props, ref) {
  const { scrollAnimatedValue } = props;
  type ChildProps = { node?: RNode; ctx?: Ctx; children?: ReactNode; onLayout?: (event: LayoutChangeEvent) => void };
  const children = Children.only(props.children) as ReactElement<ChildProps>;
  const host = useHost();
  const group = useContext(Group);
  const [layout, setLayout] = useState<StickyLayout | null>(null);
  const [nextY, setNextY] = useState(props.nextHeaderLayoutY);
  const [explicitOffset, setExplicitOffset] = useState(0);
  useImperativeHandle(ref, () => ({ setNextHeaderY: setNextY }), []);
  // TV reading stops wrap the same child without changing its stacking or focus identity.
  const child = children.type === ReadingStop.Provider ? Children.only(children.props.children) as ReactElement<ChildProps> : children;
  const { node, ctx } = child.props;
  const rows = node ? rowsFor(node, ctx ?? ROOT_CONTEXT, host.env, { hover: false, focus: false, active: false }, group, false) : {};
  const zIndex = Number(rows['z-index'] ?? 0) || 0;
  const translateY = useMemo(() => {
    if (!layout) return scrollAnimatedValue.interpolate({ inputRange: [0, 1], outputRange: [0, 0] });
    const limit = stickyLimit(layout, nextY);
    return scrollAnimatedValue.interpolate({
      inputRange: [layout.y, layout.y + (Number.isFinite(limit) && limit > 0 ? limit : 1)],
      outputRange: [0, limit === 0 ? 0 : Number.isFinite(limit) ? limit : 1],
      extrapolateLeft: 'clamp', extrapolateRight: Number.isFinite(limit) ? 'clamp' : 'extend',
    });
  }, [layout, nextY, scrollAnimatedValue]);
  // Fabric's hit testing needs the settled transform in its shadow tree too. Drawing stays
  // native-driven during the gesture; only publish the explicit value once scrolling pauses.
  useEffect(() => {
    if (!layout) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = scrollAnimatedValue.addListener(({ value }) => {
      clearTimeout(timer);
      timer = setTimeout(() => setExplicitOffset(stickyOffset(value, layout, nextY)), 32);
    });
    return () => { scrollAnimatedValue.removeListener(listener); clearTimeout(timer); };
  }, [scrollAnimatedValue, layout, nextY]);
  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setLayout(previous => previous?.y === y && previous.height === height ? previous : { y, height });
    props.onLayout(event);
    children.props.onLayout?.(event);
  };
  return <RNAnimated.View collapsable={false} onLayout={onLayout} pointerEvents="box-none"
    style={{ zIndex, transform: [{ translateY }] }}
    passthroughAnimatedPropExplicitValues={{ style: { transform: [{ translateY: explicitOffset }] } }}>
    {children}
  </RNAnimated.View>;
});

function Box({ node, ctx, route, after, hero }: { node: Extract<RNode, { kind: 'box' }>; ctx: Ctx; route?: boolean; after?: RNode; hero?: boolean }) {
  const host = useHost();
  const { env, viewport } = host;
  const [cardMenu, setCardMenu] = useState<{ anchor: CardMenuAnchor; mode: CardMenuOpenMode } | null>(null);
  const swipe = useHeroSwipe(!!hero, env.home?.hero.length ?? 0, env.heroIndex, host.dispatch);
  const parentText = useContext(Inherited);
  const parentGroup = useContext(Group);
  const [ui, setUi] = useState<Interaction>({ hover: false, focus: false, active: false });
  const [groupUi, setGroupUi] = useState({ hover: false, focus: false });
  const scrollRef = useRef<Scroller>(null);
  const pagerMetrics = useRef({ x: 0, width: viewport.width, contentWidth: 0 });
  const buttonRef = useRef<Focusable | null>(null);
  const suppressPress = useRef(false);
  const guideRef = useRef<Focusable | null>(null);
  const releaseButton = useRef<(() => void) | undefined>(undefined);
  const band = useContext(Band);
  const stop = useContext(ReadingStop);
  const routeFocus = useRouteFocusContext();
  const episodeNav = useContext(EpisodeNavigation);
  const reveal = useContext(RevealContext);
  const offsetY = useRef(0);
  const routeReveal = useMemo(() => (route && revealing ? revealer(scrollRef, offsetY) : null), [route]);

  const disabled = node.disabled ? holds(node.disabled, ctx, env) : false;
  const menuCard = ctx.card
    ?? (ctx.ch ? channelCard(ctx.ch) : undefined)
    ?? (ctx.person ? contextCard(ctx.person.id || ctx.person.name, 'person', ctx.person.name, ctx.person.portrait) : undefined)
    ?? (ctx.extra ? contextCard(ctx.extra.id, 'extra', ctx.extra.name) : undefined);
  const cardArg = node.press ? fill(node.press.arg, ctx, env) : '';
  const cardPrimary = menuCard && node.press && (node.press.action === 'play' || node.press.action === 'playExtra' || node.press.action === 'person' || node.press.action === 'openHit' || cardArg.split('|')[0] === menuCard.id)
    ? { action: node.press.action, arg: cardArg }
    : null;
  const openAnchoredMenu = useCallback((mode: CardMenuOpenMode) => {
    if (!cardPrimary) return;
    if (mode !== 'keyboard') {
      suppressPress.current = true;
      setTimeout(() => { suppressPress.current = false; }, 500);
    }
    const target = buttonRef.current as (Focusable & { measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void }) | null;
    target?.measureInWindow?.((x, y, width, height) => setCardMenu({ mode, anchor: { kind: 'card', rect: { left: x, top: y, right: x + width, bottom: y + height } } }));
  }, [cardPrimary?.action, cardPrimary?.arg]);
  useTVMenuEvent(event => {
    if (!Platform.isTV || !ui.focus || !cardPrimary) return;
    if (event.eventType === 'longSelect' || event.eventType === 'menu') openAnchoredMenu('tv');
  });
  const rows = rowsFor(node, ctx, env, ui, parentGroup, disabled);
  const { own, inherited } = split(rows);
  const text = inheritFrom(parentText, inherited, viewport);
  const parentDirection = useContext(Direction);
  const translated = translatedBox(own, viewport, text.fontSize);
  const fx = translated.fx;
  const style = shrinkFor(translated.style, own, parentDirection) as typeof translated.style;
  const pointer = pointerPolicy(style.pointerEvents, useContext(PointerInheritance));
  const instant = useContext(InstantContent);
  const motion = animation(node.motion, host.doc.keyframes, env.still, ctx.index, node.stagger, instant, useContext(ScreenActive));
  const rowId = ctx.row?.id ?? '';

  const report = useCallback((kind: 'hover' | 'focus', on: boolean) => {
    setGroupUi(g => (g[kind] === on ? g : { ...g, [kind]: on }));
  }, []);
  const groupValue = useMemo<GroupState | null>(() => (node.group ? { ...groupUi, report } : parentGroup), [node.group, groupUi, report, parentGroup]);
  const set = (kind: keyof Interaction, on: boolean) => {
    setUi(u => (u[kind] === on ? u : { ...u, [kind]: on }));
    if (kind !== 'active') groupValue?.report(kind, on);
  };

  // Opening search folds the route (home's hero) and pins the field at its top: the route starts
  // from its top again, as compiled Cinematic brought search up, whatever it was scrolled to.
  const searching = !!route && env.query !== '';
  useEffect(() => {
    if (searching) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [searching]);

  useEffect(() => {
    if (!node.pager || !fx.scrollX || !rowId) return;
    const view = scrollRef.current;
    if (view) pagers.set(rowId, { view, ...pagerMetrics.current });
    const frame = web && view ? requestAnimationFrame(() => {
      const element = view as unknown as HTMLElement;
      pagerMetrics.current.width = element.clientWidth;
      pagerMetrics.current.contentWidth = element.scrollWidth;
      const pager = pagers.get(rowId);
      if (pager) { pager.width = element.clientWidth; pager.contentWidth = element.scrollWidth; }
      host.setPager(rowId, { atStart: element.scrollLeft <= 1, atEnd: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
    }) : 0;
    return () => { if (frame) cancelAnimationFrame(frame); pagers.delete(rowId); };
  }, [node.pager, fx.scrollX, rowId, viewport.width]);

  if (fx.hidden) return null;

  // A focused control always shows it, but in its document's own focus look where it has one (a
  // card's lift, a button's fill): the shared ring is only for controls the document left without.
  const focusRing = ui.focus && (!!node.press || stop) && !focusLook(node) ? focusStyle(style.transform, env.still) : undefined;
  const vertical = !!route || (!!fx.scrollY && !fx.scrollX);
  const stops = Platform.isTV && vertical ? readingStops(node) : undefined;
  const children = node.children.map((child, i) => stops?.has(i)
    ? <ReadingStop.Provider key={i} value><SkinNode node={child} ctx={ctx} /></ReadingStop.Provider>
    : <SkinNode key={i} node={child} ctx={ctx} />);
  if (after) children.push(<SkinNode key="after" node={after} ctx={ctx} />);
  let content: ReactNode = children;
  if (fx.grid) {
    // A grid's cells are its drawn items: a repeat contributes one cell per item, as CSS grid
    // places each element a repeat draws.
    const repeat = node.children.length === 1 ? node.children[0] : undefined;
    if (web && typeof ResizeObserver !== 'undefined' && repeat?.kind === 'repeat' && repeat.over === 'library.items'
      && !repeat.when.length && (style.rowGap === undefined || typeof style.rowGap === 'number')) {
      const cards = env.library?.model?.items ?? [];
      const item = (i: number) => {
        const context = { ...ctx, card: cards[i]!, index: i };
        return <SkinNode key={itemKey(context, repeat.over)} node={repeat.item} ctx={context} />;
      };
      content = <WindowedGrid grid={fx.grid} rowGap={style.rowGap ?? 0}
        length={Math.min(cards.length, repeat.implicitLimit ? Infinity : repeat.limit)} getItem={item} />;
    } else {
      const items = node.children.flatMap((child, i) => child.kind === 'repeat'
        ? collection(child.over, ctx, env, child.limit).filter(c => holds(child.when, c, env)).map(c => <SkinNode key={`${i}:${itemKey(c, child.over)}`} node={child.item} ctx={c} />)
        : holds(child.when, ctx, env) ? [<SkinNode key={i} node={child} ctx={ctx} />] : []);
      content = <GridTrack grid={fx.grid} rowGap={style.rowGap} items={items} />;
    }
  }
  const layers = (
    <>
      {fx.backdropBlur ? <Backdrop blur={fx.backdropBlur} glass={style.backgroundColor !== undefined} /> : null}
      {fx.backgroundUrl ? <BackgroundImage src={fx.backgroundUrl} /> : null}
    </>
  );
  const drawn: Record<string, unknown> = { ...style, ...(web && swipe ? { touchAction: 'pan-y pinch-zoom' } : {}), ...(fx.backdropBlur ? { overflow: 'hidden' } : {}), ...motion, ...focusRing };
  if (!web) drawn.pointerEvents = pointer.box;
  // Sticky keeps the document's stacking order: CSS on web, our ScrollView wrapper natively.
  if (web && fx.sticky) drawn.position = 'sticky';
  // A masked box that only paints a colour draws the masked colour as a gradient fill.
  const filled = !!fx.maskedFill && node.children.length === 0;
  if (filled) {
    delete drawn.backgroundColor;
    drawn.backgroundImage = fx.maskedFill;
  }
  // A native mask wraps the box: the mask takes the box's geometry and the box fills it in flow,
  // so the mask is as large as the box's content. It renders the box offscreen at full size, which
  // a TV cannot afford across a home of masked rows (Basement was killed at 1.6 GB): on TV other
  // masks are left out and the box draws with hard edges.
  const masked = !filled && !Platform.isTV && !!(fx.mask || fx.radialMask);
  const [geometry, inner] = masked ? partition(drawn, GEOMETRY) : [{}, drawn];
  const boxStyleFinal = masked ? { ...inner, flexGrow: 1 } : drawn;
  const a11y = a11yProps(node, ctx, env);
  const hoverProps = web && (node.base.hover || node.group || node.states.some(s => s.layer.hover))
    ? { onMouseEnter: () => set('hover', true), onMouseLeave: () => set('hover', false) } : {};

  let element: ReactNode;
  if (route || fx.scrollX || fx.scrollY) {
    const horizontal = !route && !!fx.scrollX && !fx.scrollY;
    const [contentStyle, outerStyle] = partition(boxStyleFinal, route ? ROUTE_CONTENT : CONTENT);
    const sticky = web || horizontal ? undefined : node.children.flatMap((child, i) => (child.base.style.position === 'sticky' && holds(child.when, ctx, env) ? [i] : []));
    const onPagerScroll = node.pager && rowId ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      pagerMetrics.current = { x: contentOffset.x, width: layoutMeasurement.width, contentWidth: contentSize.width };
      const pager = pagers.get(rowId);
      if (pager) { pager.x = contentOffset.x; pager.width = layoutMeasurement.width; pager.contentWidth = contentSize.width; }
      host.setPager(rowId, { atStart: contentOffset.x <= 1, atEnd: contentOffset.x + layoutMeasurement.width >= contentSize.width - 1 });
    } : undefined;
    const onPagerLayout = node.pager && rowId ? (e: LayoutChangeEvent) => {
      pagerMetrics.current.width = e.nativeEvent.layout.width;
      const pager = pagers.get(rowId);
      if (pager) pager.width = pagerMetrics.current.width;
      const metrics = pager ?? pagerMetrics.current;
      if (metrics.contentWidth) host.setPager(rowId, { atStart: metrics.x <= 1, atEnd: metrics.x + metrics.width >= metrics.contentWidth - 1 });
    } : undefined;
    const onPagerContent = node.pager && rowId ? (width: number) => {
      pagerMetrics.current.contentWidth = width;
      const pager = pagers.get(rowId);
      if (pager) pager.contentWidth = width;
      const metrics = pager ?? pagerMetrics.current;
      host.setPager(rowId, { atStart: metrics.x <= 1, atEnd: metrics.x + metrics.width >= width - 1 });
    } : undefined;
    // Android TV: the route's offset, for keeping focused controls below the shell's bar.
    const onScroll = routeReveal ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetY.current = e.nativeEvent.contentOffset.y;
    } : onPagerScroll;
    element = (
      <AScroll ref={scrollRef as never} horizontal={horizontal} style={[route ? ROUTE_SCROLL : BOX_SCROLL, outerStyle as ViewStyle]}
        contentContainerStyle={contentStyle as ViewStyle} stickyHeaderIndices={sticky?.length ? sticky : undefined}
        refreshControl={route && host.refresh && Platform.OS !== 'web' && !Platform.isTV ? <RefreshControl refreshing={!!host.refreshing} onRefresh={host.refresh} /> : undefined}
        StickyHeaderComponent={NativeStickyHeader}
        showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={!horizontal && !Platform.isTV} onScroll={onScroll} scrollEventThrottle={64}
        onLayout={onPagerLayout} onContentSizeChange={onPagerContent}
        {...(web && horizontal && rowId ? { dataSet: { velaRow: rowId } } : {})}
        {...a11y}>
        {content}
      </AScroll>
    );
    if (horizontal && Platform.isTV) element = <RowGuide>{element as ReactElement<{ style: unknown }>}</RowGuide>;
  } else {
    // A press box is the schema's full-size transparent button over its content: the button takes
    // focus (keyboard, tvOS focus engine, D-pad) and carries the label; the box keeps its motion.
    // The button registers under the box's id, so Escape's returnFocus can land on it.
    const press = node.press;
    const registerButton = focusTarget(a11y.nativeID);
    const bindButton = (target: Focusable | null) => {
      // React Native Web's merged refs discard callback return values and detach with null.
      // Native React can call the returned cleanup instead. Both paths must release registrations.
      releaseButton.current?.();
      if (!target) return;
      buttonRef.current = target;
      const unregister = registerButton(target);
      const untrack = press ? trackButton(target, `${press.action}:${fill(press.arg, ctx, env)}`) : undefined;
      const arg = press ? fill(press.arg, ctx, env) : '';
      const kind = (node.id && fill(node.id, ctx, env).startsWith('episode-')) ? 'episode' : press?.action === 'select' && arg.includes('|season|') ? 'season' : press?.action === 'playExtra' ? 'extra' : undefined;
      const unepisode = kind && !disabled ? episodeNav?.register(target, kind, ctx.index) : undefined;
      if (press) routeFocus?.offer(target, press.action);
      const release = () => {
        if (releaseButton.current !== release) return;
        releaseButton.current = undefined;
        buttonRef.current = null;
        unregister?.();
        untrack?.();
        unepisode?.();
      };
      releaseButton.current = release;
      return release;
    };
    const pressArg = press ? fill(press.arg, ctx, env) : '';
    const href = press ? host.href?.(press.action, pressArg) : undefined;
    const onPress = press && ((event: GestureResponderEvent) => {
      if (web && href) {
        const click = event.nativeEvent as unknown as { button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
        if (click.button === 1 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
        event.preventDefault?.();
      }
      if (suppressPress.current) { suppressPress.current = false; return; }
      const arg = pressArg;
      const focus = press.focus ? fill(press.focus, ctx, env) : '';
      noteOpener(press.action, arg, buttonRef.current);
      notePress(buttonRef.current, `${press.action}:${arg}`);
      host.dispatch(press.action, arg);
      // press.focus: the element the action draws (a drawer's first row) takes focus once drawn.
      if (focus) requestAnimationFrame(() => focusElement(focus));
    });
    const button = press ? (
      <Pressable ref={bindButton as never} style={[StyleSheet.absoluteFill, NO_RING]} disabled={disabled}
        {...(href ? { href } : {})}
        pointerEvents={web ? undefined : pointer.content === 'none' ? 'none' : 'auto'}
        focusable={selectable(node)}
        {...(web ? { dataSet: { velaFocus: 'frame', ...(cardPrimary && rowId ? { velaRowItem: String(ctx.index) } : {}) }, onKeyDown: (event) => {
          const key = (event as unknown as { key: string }).key ?? (event.nativeEvent as unknown as { key: string }).key;
          if (cardPrimary && (key === 'ContextMenu' || (key === 'F10' && (event as unknown as { shiftKey?: boolean }).shiftKey))) {
            event.preventDefault(); event.stopPropagation(); openAnchoredMenu('keyboard'); return;
          }
          if (cardPrimary && moveWebRowFocus(event.currentTarget as unknown as HTMLElement, key)) {
            event.preventDefault(); event.stopPropagation(); return;
          }
          if (buttonRef.current) episodeNav?.key(buttonRef.current, { key, preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() });
        } } : {})}
        {...(web && a11y.accessibilityState?.selected !== undefined ? { 'aria-selected': a11y.accessibilityState.selected } : {})}
        onLongPress={cardPrimary ? () => openAnchoredMenu(Platform.isTV ? 'tv' : 'touch') : undefined}
        {...(web && cardPrimary ? { onContextMenu: (e: { preventDefault(): void; stopPropagation(): void; clientX?: number; clientY?: number; nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number } }) => {
          e.preventDefault(); e.stopPropagation();
          const x = e.clientX ?? e.nativeEvent?.clientX ?? e.nativeEvent?.pageX ?? 0;
          const y = e.clientY ?? e.nativeEvent?.clientY ?? e.nativeEvent?.pageY ?? 0;
          setCardMenu({ mode: 'pointer', anchor: { kind: 'point', point: { x, y } } });
        } } : {})}
        onPress={onPress}
        onFocus={event => {
          set('focus', isFocusVisible(event.currentTarget));
          routeFocus?.focused();
          if (buttonRef.current) episodeNav?.focused(buttonRef.current);
          if (reveal && buttonRef.current) reveal(buttonRef.current);
        }}
        onBlur={() => set('focus', false)}
        onPointerDown={() => set('focus', false)}
        onHoverIn={() => set('hover', true)} onHoverOut={() => set('hover', false)}
        onPressIn={() => set('active', true)} onPressOut={() => set('active', false)}
        accessibilityRole={a11y.accessibilityRole ?? (href ? 'link' : 'button')} accessibilityLabel={a11y.accessibilityLabel} accessibilityState={a11y.accessibilityState}
        testID={a11y.testID} />
    ) : null;
    const guide = node.press ? undefined : tvGuide(node, env.flags, band);
    // A reading stop takes focus without doing anything, so the remote can scroll to it.
    const stopProps = stop ? {
      focusable: true,
      onFocus: () => set('focus', true),
      onBlur: () => set('focus', false),
      // Screen readers read the section as one passage, by its label or else its text.
      accessible: true,
      accessibilityRole: 'summary' as const,
      accessibilityLabel: a11y.accessibilityLabel ?? sectionText(node, ctx, env),
    } : {};
    const barLayout = revealing && node.role === 'navigation'
      ? { onLayout: (e: LayoutChangeEvent) => noteTopBar(e.nativeEvent.layout.height, style.position === 'absolute') }
      : {};
    const Frame = (guide ? AGuide : frameFor(node)) as typeof AView;
    element = (
      <Frame ref={guide ? (guideRef as never) : undefined} style={boxStyleFinal as ViewStyle} {...(guide as object)}
        {...barLayout} {...swipe} {...hoverProps} {...(press ? { nativeID: a11y.nativeID } : a11y)} {...stopProps}>
        {layers}
        {content}
        {button}
      </Frame>
    );
  }
  if (node.press?.action === 'play') {
    const arg = fill(node.press.arg, ctx, env);
    const id = arg.split('|')[0];
    const resumable = (ctx.heroAct?.targetId === id && ctx.heroAct.progress > 0)
      || (ctx.card?.id === id && ctx.card.progressSeconds > 0)
      || (env.detail?.title[0]?.id === id && env.detail.resumeSeconds > 0);
    if (resumable && arg.split('|')[3] === undefined) {
      const [titleId, source = '', audio = ''] = arg.split('|');
      const restart = restartAction(node, secondaryPlayAction(host.doc.routes.title), `${titleId}|${source}|${audio}|0`, msg(ctx.heroAct ? 'ui.fromBeginning' : 'ui.playFromBeginning'));
      element = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>{element}<SkinNode node={restart} ctx={ctx} /></View>;
    }
    if (env.route === 'title' && id === env.detail?.title[0]?.id && arg.split('|')[3] === undefined) {
      element = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{element}<VersionsControl /></View>;
    }
  }
  if (cardMenu && cardPrimary && menuCard) element = <>{element}<CardContextMenu card={menuCard} primary={cardPrimary} anchor={cardMenu.anchor} mode={cardMenu.mode} opener={buttonRef.current} continueWatching={ctx.row?.purpose === 'continue'} close={() => setCardMenu(null)} /></>;
  if (masked) element = <Mask linear={fx.mask} radial={fx.radialMask} style={geometry}>{element}</Mask>;
  if (node.escape?.length) {
    const returnFocus = node.returnFocus ? fill(node.returnFocus, ctx, env) : undefined;
    element = (
      <EscapeScope flags={node.escape} returnFocus={returnFocus || undefined} guide={Platform.isTV ? guideRef : undefined}>
        {element}
      </EscapeScope>
    );
  }
  const direction = fx.grid || (fx.scrollX && !fx.scrollY) || String(style.flexDirection ?? 'column').startsWith('row') ? 'row' : 'column';
  return (
    <Inherited.Provider value={text}>
      <PointerInheritance.Provider value={web ? 'auto' : pointer.content}>
      <Group.Provider value={groupValue}>
        <Direction.Provider value={direction}>
          <Band.Provider value={Platform.isTV && (vertical || node.id === 'vela-library-alternative')}>
            <ReadingStop.Provider value={false}>
              {routeReveal ? <RevealContext.Provider value={routeReveal}>{element}</RevealContext.Provider> : element}
            </ReadingStop.Provider>
          </Band.Provider>
        </Direction.Provider>
      </Group.Provider>
      </PointerInheritance.Provider>
    </Inherited.Provider>
  );
}

/** On TV, the boxes the focus engine must treat as one region. A navigation bar or rail is one
 * destination: focus moving onto it from anywhere in line with the bar (a centred search field
 * under a bar whose items sit at its edges) lands on the item last focused there, else the first.
 * So is each band of a route or of a vertical scroll box (a direct child with something focusable
 * in it: home's hero copy, its search field, its rows; a title page's sections), so up and down
 * move band by band whatever the horizontal offsets. Bands are tvOS's alone: its focus engine only moves to what lies in line,
 * while Android's focus search takes the nearest item in the direction anyway, and there a band
 * around the sign-in card kept the first D-pad press from reaching its fields. An escape scope
 * (a menu, a drawer) is one too, and while open it keeps focus inside: moving off its edges stays
 * on its items rather than reaching the page behind. */
function tvGuide(node: Extract<RNode, { kind: 'box' }>, flags: string[], band: boolean) {
  if (!Platform.isTV) return undefined;
  const scope = !!node.escape?.length;
  const region = node.role === 'navigation' || (band && Platform.OS === 'ios' && focusableWithin(node));
  if (!scope && !region) return undefined;
  const trap = scope && scopeOpen(node.escape!, flags);
  return { autoFocus: true, trapFocusUp: trap, trapFocusDown: trap, trapFocusLeft: trap, trapFocusRight: trap };
}

/** Whether a subtree draws anything that takes focus. An empty guide must not exist: on Android
 * it would still be a destination, and focus moved onto it would go nowhere. */
const focusables = new WeakMap<RNode, boolean>();
/** Whether a press takes keyboard and TV focus. The logo is a pointer shortcut only (see
 * `brand`): Home sits in the navigation beside it, and a focusable logo is a stop that does
 * nothing new (on TV the engine's first pick on a page). It still answers a click or tap. */
function selectable(node: RNode): boolean {
  return !(node.kind === 'box' && node.brand);
}

function focusableWithin(node: RNode): boolean {
  const known = focusables.get(node);
  if (known !== undefined) return known;
  let found: boolean;
  switch (node.kind) {
    case 'box': found = (!!node.press && selectable(node)) || node.children.some(focusableWithin); break;
    case 'repeat': found = focusableWithin(node.item); break;
    case 'slot': found = node.slot === 'searchField'; break;
    case 'widget': found = FOCUSABLE_WIDGETS.has(node.widget); break;
    default: found = false;
  }
  focusables.set(node, found);
  return found;
}

/** The sections of a vertical scroll (by index) after its last focusable one: the remote moves
 * from control to control, so content below the last control (a cast list without actions, the
 * end of a synopsis) could never be scrolled to. On TV each such section in flow takes focus as a
 * reading stop and wears the focus ring; it does nothing when selected. */
function readingStops(node: Extract<RNode, { kind: 'box' }>): Set<number> {
  let last = -1;
  node.children.forEach((child, i) => {
    if (focusableWithin(child)) last = i;
  });
  const stops = new Set<number>();
  node.children.forEach((child, i) => {
    if (i > last && child.kind === 'box' && !child.hidden && child.base.style.position !== 'absolute') stops.add(i);
  });
  return stops;
}

/** The text a section draws, in order, for a reading stop's label (at most a few sentences). */
function sectionText(node: RNode, ctx: Ctx, env: Env): string {
  const parts: string[] = [];
  const visit = (n: RNode, c: Ctx) => {
    if (parts.join(' ').length > SECTION_TEXT_MAX) return;
    if (n.kind === 'repeat') {
      for (const item of collection(n.over, c, env, n.limit)) if (holds(n.when, item, env)) visit(n.item, item);
      return;
    }
    if (!holds(n.when, c, env) || n.hidden) return;
    if (n.kind === 'text') parts.push(fill(n.text, c, env));
    if (n.kind === 'box') n.children.forEach(child => visit(child, c));
  };
  visit(node, ctx);
  return parts.filter(Boolean).join(', ').slice(0, SECTION_TEXT_MAX);
}
const SECTION_TEXT_MAX = 600;

/** Whether the document gives a press box a look for focus: its focus look, else its hover look
 * (on TV focus shows the hover look), or a group whose members show its focus. */
function focusLook(node: RNode): boolean {
  if (node.group) return true;
  return [node.base, ...node.states.map(s => s.layer)].some(layer => layer.focus || layer.hover || layer.style.outline === 'auto');
}

/** The document's ui block, resolved once per document. */
const uis = new WeakMap<ResolvedDocument, ReturnType<typeof resolveUi>>();
function uiOf(doc: ResolvedDocument) {
  let ui = uis.get(doc);
  if (!ui) {
    ui = resolveUi(doc.document.ui);
    uis.set(doc, ui);
  }
  return ui;
}

/** A horizontal row on TV is one focus destination: moving up or down onto it from any card in
 * the next row lands on the card last focused in it, else its first. The guide takes the row's
 * place in the layout, and the row fills it. */
function RowGuide({ children }: { children: ReactElement<{ style: unknown }> }) {
  const flat = StyleSheet.flatten(children.props.style as ViewStyle) as Record<string, unknown>;
  const [geometry, rest] = partition(flat, GEOMETRY);
  return (
    <TVFocusGuideView autoFocus style={geometry as ViewStyle}>
      {cloneElement(children, { style: { ...rest, flexGrow: 1 } })}
    </TVFocusGuideView>
  );
}

/** A backdrop blur. Android draws no blur without a blur target, so there a box without a colour
 * of its own (a bar's scrim) is veiled in the document's page colour instead, enough to keep what
 * scrolls beneath it from showing through; a glass box (a pill, a badge) keeps just its colour. */
function Backdrop({ blur, glass }: { blur: number; glass: boolean }) {
  const { doc } = useHost();
  const android = Platform.OS === 'android';
  if (android && glass) return null;
  const page = android ? uiOf(doc).page : undefined;
  if (page) return <View style={[StyleSheet.absoluteFill, { backgroundColor: page, opacity: ANDROID_VEIL }]} />;
  return <BlurView intensity={Math.min(100, Math.round(blur * 2.5))} tint="dark" style={StyleSheet.absoluteFill} />;
}
const ANDROID_VEIL = 0.7;

/** A route's scroll fills the route. A box that scrolls is sized as CSS sizes it: React Native's
 * ScrollView grows by default, which would stretch a 232 px sidebar across its row. */
const ROUTE_SCROLL: ViewStyle = { flex: 1 };
const BOX_SCROLL: ViewStyle = { flexGrow: 0 };

const GRID_FIRST = 24;
const GRID_BATCH = 24;

function WindowedGrid(props: Omit<React.ComponentProps<typeof WebLibraryGrid>, 'drawn'>) {
  const layout = useContext(RouteLayout);
  useLayoutEffect(() => { if (props.length) layout?.grid(); }, [layout, props.length]);
  return <WebLibraryGrid {...props} drawn={layout?.drawn} />;
}

/** A grid's cells, in a track that fills the box's content width. The track measures that width
 * itself (a box's padding may be a percentage of its parent's width), and the columns divide it:
 * auto-fill takes as many columns as fit at the minimum, then stretches them to fill the row. */
function GridTrack({ grid, rowGap, items }: { grid: NonNullable<Effects['grid']>; rowGap: unknown; items: ReactElement[] }) {
  const [width, setWidth] = useState(0);
  // A library page is a hundred cards: the first screenful draws at once and the rest a batch a
  // frame, so switching to a grid answers at once rather than after every card has been made.
  const [drawn, setDrawn] = useState(GRID_FIRST);
  useEffect(() => {
    if (drawn >= items.length) return;
    const frame = requestAnimationFrame(() => setDrawn(count => count + GRID_BATCH));
    return () => cancelAnimationFrame(frame);
  }, [drawn, items.length]);
  const layout = useContext(RouteLayout);
  useLayoutEffect(() => { if (items.length) layout?.grid(); }, [layout, items.length]);
  const gap = grid.gap;
  const count = grid.count ?? Math.max(1, Math.floor((width + gap) / ((grid.min ?? 160) + gap)));
  // A pixel of slack, then rounded down to the hundredth, so a row's cells and gaps never sum past
  // the track and wrap: layout reports a rounded width (1325 for a 1324.81 px track on the web).
  const cell = Math.floor(((width - 1 - gap * (count - 1)) / count) * 100) / 100;
  const track = { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', rowGap, columnGap: gap } as ViewStyle;
  return (
    <View style={track} onLayout={e => {
      // Hidden retained sections report zero width. Keep their cells and scroll
      // extent mounted until a visible layout supplies the new usable width.
      const next = e.nativeEvent.layout.width;
      if (next > 0) setWidth(next);
      // An empty library has no first cell to release the skeleton. Its track's
      // committed layout is enough, including after a populated grid becomes empty.
      if (next > 0 && !items.length) layout?.drawn();
    }}>
      {width > 0 ? items.slice(0, drawn).map((item, index) => <View key={item.key} style={{ width: cell }} onLayout={index === 0 ? () => layout?.drawn() : undefined}>{item}</View>) : null}
    </View>
  );
}

// The guaranteed ring is drawn inside the frame; web focus-visible overrides the button too.
const NO_RING = (web ? { outlineStyle: 'none', outlineWidth: 0 } : { outlineWidth: 0 }) as ViewStyle;

interface MaskProps {
  linear?: Effects['mask'];
  radial?: Effects['radialMask'];
  style: Record<string, unknown>;
  children: ReactNode;
}

/** A native gradient mask with the box's geometry, around the box. */
function Mask({ linear, radial, style, children }: MaskProps) {
  return (
    <Masked pointerEvents="box-none" style={style as ViewStyle} maskElement={linear ? <LinearMask mask={linear} /> : <RadialMask mask={radial!} />}>
      {children}
    </Masked>
  );
}

function LinearMask({ mask }: { mask: NonNullable<Effects['mask']> }) {
  return (
    <LinearGradient
      colors={mask.colors as [string, string, ...string[]]}
      locations={mask.locations as [number, number, ...number[]]}
      start={mask.start}
      end={mask.end}
      style={StyleSheet.absoluteFill}
    />
  );
}

/** An elliptical radial mask, drawn with an SVG gradient stretched over the box. */
function RadialMask({ mask }: { mask: NonNullable<Effects['radialMask']> }) {
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <RadialGradient
          id="mask"
          cx={mask.centre.x * 100}
          cy={mask.centre.y * 100}
          rx={mask.radius.x * 100}
          ry={mask.radius.y * 100}
          gradientUnits="userSpaceOnUse"
        >
          {mask.colors.map((colour, i) => (
            <Stop key={i} offset={mask.locations[i]} stopColor={colour === 'transparent' ? '#000' : colour}
              stopOpacity={colour === 'transparent' ? 0 : 1} />
          ))}
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill="url(#mask)" />
    </Svg>
  );
}

function BackgroundImage({ src }: { src: string }) {
  const host = useHost();
  const source = host.image(src);
  return source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /> : null;
}

// ---- Leaves ----

const IDLE: Interaction = { hover: false, focus: false, active: false };

function useLeafStyle(node: RNode, ctx: Ctx, ui: Interaction = IDLE) {
  const { env, viewport, doc } = useHost();
  const parentText = useContext(Inherited);
  const group = useContext(Group);
  const rows = rowsFor(node, ctx, env, ui, group, false);
  const { own, inherited } = split(rows);
  const text = inheritFrom(parentText, inherited, viewport);
  const parentDirection = useContext(Direction);
  const { style, fx } = translatedBox(own, viewport, text.fontSize);
  const instant = useContext(InstantContent);
  const motion = animation(node.motion, doc.keyframes, env.still, ctx.index, node.stagger, instant, useContext(ScreenActive));
  const pointer = pointerPolicy(style.pointerEvents, useContext(PointerInheritance));
  return { own, text, style: { ...shrinkFor(style, own, parentDirection), ...motion,
    ...(!web && pointer.content === 'none' ? { pointerEvents: 'none' } : {}) } as Record<string, unknown>, fx };
}

function TextNode({ node, ctx }: { node: Extract<RNode, { kind: 'text' }>; ctx: Ctx }) {
  const { env, viewport } = useHost();
  const { own, text, style, fx } = useLeafStyle(node, ctx);
  const textKey = `t${viewport.width}x${viewport.height}|${text.fontSize}|${JSON.stringify(text.rows)}`;
  const drawn = cached(`${textKey}|${own['text-overflow'] ?? ''}|${own['line-clamp'] ?? ''}`,
    () => textStyle({ ...text.rows, ...pick(own, ['text-overflow', 'line-clamp']) }, measure(viewport, text.fontSize)));
  const Frame = frameFor(node);
  const Line = web || needsAnimatedFrame(node) ? AText : Text;
  if (fx.hidden) return null;
  const value = fill(node.text, ctx, env);
  const lines = { numberOfLines: drawn.numberOfLines, ellipsizeMode: drawn.ellipsize ? ('tail' as const) : undefined };
  if (node.summary && (env.route === 'title' || env.route === 'person')) {
    return <ExpandableSummary key={env.entry} value={value} lines={drawn.numberOfLines ?? 3}
      style={style as ViewStyle} textStyle={drawn.style} />;
  }

  // Natively a text view does not paint a gradient or a shadow (Android's never does): a text that
  // paints its box (an initial in a gradient disc) draws as that box with the text centred inside.
  if (!web && (style.backgroundImage || style.boxShadow)) {
    return (
      <Frame style={style as ViewStyle} {...a11yProps(node, ctx, env)}>
        <Text style={[drawn.style, centredLine(own, text.rows)]} {...lines}>{value}</Text>
      </Frame>
    );
  }
  return (
    <Line style={[drawn.style, style as TextStyle, centredBox(own, text.rows, style), tightLine(drawn.style, style, text.fontSize)]} {...lines} {...a11yProps(node, ctx, env)}>
      {value}
    </Line>
  );
}

/** A text drawn as a centring flex box (a badge, an initial in a circle) centres its line. */
function centredLine(own: Css, inherited: Css): TextStyle {
  return own['justify-content'] === 'center' && !inherited['text-align'] ? { textAlign: 'center' } : {};
}

/** As centredLine, and the line's height is the box's, so the text sits in the middle. */
function centredBox(own: Css, inherited: Css, style: Record<string, unknown>): TextStyle {
  const centred: TextStyle = { ...centredLine(own, inherited) };
  if (own['align-items'] === 'center' && typeof style.height === 'number' && !inherited['line-height']) {
    const top = Number(style.borderTopWidth ?? style.borderWidth) || 0;
    const bottom = Number(style.borderBottomWidth ?? style.borderWidth) || 0;
    return { ...centred, lineHeight: style.height - top - bottom };
  }
  return centred;
}

/**
 * CSS lets a line box shorter than its glyphs (a ranked shelf's numeral at 0.74, a display title
 * at 0.98) spill them evenly above and below. Natively the glyphs sit in the short line and lose their tops, and
 * the text rides high. Such a text gets a line its glyphs fit, and gives the difference back as
 * equal negative margins, so it takes the room CSS gives it and draws where CSS draws it.
 */
function tightLine(drawn: TextStyle, box: Record<string, unknown>, fontSize: number): TextStyle {
  const line = drawn.lineHeight;
  if (web || !line || line >= fontSize * 1.1) return {};
  const room = fontSize * 1.2;
  const give = (room - line) / 2;
  const margin = (side: 'Top' | 'Bottom') => Number(box[`margin${side}`] ?? box.marginVertical ?? box.margin ?? 0) || 0;
  return { lineHeight: room, marginTop: margin('Top') - give, marginBottom: margin('Bottom') - give };
}

function pick(rows: Css, keys: string[]): Css {
  return Object.fromEntries(keys.filter(k => rows[k] !== undefined).map(k => [k, rows[k]]));
}

function ImageNode({ node, ctx }: { node: Extract<RNode, { kind: 'image' }>; ctx: Ctx }) {
  const host = useHost();
  const { style, fx } = useLeafStyle(node, ctx);
  const Frame = frameFor(node);
  if (fx.hidden) return null;
  const source = host.image(fill(node.src, ctx, host.env));
  const alt = node.alt ? fill(node.alt, ctx, host.env) : '';
  // The box carries the node's style and motion; the image fills it.
  return (
    <Frame style={style as ViewStyle} pointerEvents="none" accessible={!!alt} accessibilityLabel={alt || undefined} accessibilityRole={alt ? 'image' : undefined}>
      {source ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit={fx.contentFit ?? 'fill'}
          blurRadius={fx.imageBlur}
          transition={node.fade ? 420 : 0}
        />
      ) : null}
    </Frame>
  );
}

function Icon({ node, ctx }: { node: Extract<RNode, { kind: 'icon' }>; ctx: Ctx }) {
  const { style, text, fx } = useLeafStyle(node, ctx);
  const Frame = frameFor(node);
  if (fx.hidden) return null;
  const symbol = node.symbol ? SYMBOLS[node.symbol] : undefined;
  const paths = node.paths ?? symbol?.paths ?? [];
  const color = textStyle(text.rows, { viewport: { width: 0, height: 0, insets: { top: 0, right: 0, bottom: 0, left: 0 } }, fontSize: text.fontSize, axis: 'x' }).style.color as string | undefined ?? '#fff';
  const size = text.fontSize;
  return (
    <Frame style={[{ width: size, height: size }, style as ViewStyle]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={node.viewBox ?? '0 0 24 24'}>
        {paths.map((d, i) => symbol?.stroke && !node.paths
          ? <Path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          : <Path key={i} d={d} fill={color} fillRule={node.fillRule ?? 'nonzero'} />)}
      </Svg>
    </Frame>
  );
}

function Slot({ node, ctx }: { node: Extract<RNode, { kind: 'slot' }>; ctx: Ctx }) {
  const host = useHost();
  const { style, text, fx } = useLeafStyle(node, ctx);
  const inner = node.inner ? translatedBox(split(filled(node.inner, ctx, host.env, false)).own, host.viewport, text.fontSize).style : undefined;
  const Frame = frameFor(node);
  if (fx.hidden) return null;
  const content = node.slot === 'children' ? host.children : <SearchField params={{}} ctx={ctx} />;
  const box = <View style={inner as ViewStyle}>{content}</View>;
  // The search field is centred and narrower than the page; the TV focus engine only moves to
  // what lies in line with the focused item, so a guide across the slot's full width hands
  // focus to the field from anywhere above or below it.
  const reachable = Platform.isTV && node.slot === 'searchField'
    ? <TVFocusGuideView autoFocus style={styles.searchGuide}>{box}</TVFocusGuideView>
    : box;
  return (
    <Inherited.Provider value={text}>
      <Frame style={style as ViewStyle}>{reachable}</Frame>
    </Inherited.Provider>
  );
}

/** A widget draws inside its node's box. The widget reports its own hover and focus
 * (useWidgetInteraction), and the box shows the node's hover and focus looks for them. */
function Widget({ node, ctx }: { node: Extract<RNode, { kind: 'widget' }>; ctx: Ctx }) {
  const [ui, setUi] = useState<Interaction>({ hover: false, focus: false, active: false });
  const group = useContext(Group);
  const routeFocus = useRouteFocusContext();
  const episodeNav = useContext(EpisodeNavigation);
  const interaction = useMemo(() => ({
    report(kind: 'hover' | 'focus', on: boolean) {
      setUi(u => (u[kind] === on ? u : { ...u, [kind]: on }));
      group?.report(kind, on);
      // A widget taking focus (a text field) settles the route's first focus.
      if (kind === 'focus' && on) routeFocus?.focused();
    },
  }), [group, routeFocus]);
  const { style, text, fx } = useLeafStyle(node, ctx, ui);
  const Part = WIDGETS[node.widget];
  const Frame = frameFor(node);
  if (fx.hidden || !Part) return null;
  return (
    <Inherited.Provider value={text}>
      <WidgetInteractionContext.Provider value={interaction}>
        <Frame style={style as ViewStyle}><Part params={node.params} ctx={ctx} /></Frame>
      </WidgetInteractionContext.Provider>
    </Inherited.Provider>
  );
}

/** Move a row's pager by a page: max(200, width - 2 x inset - peek). */
export function page(rowId: string, direction: 1 | -1, inset = 0, peek = 0): void {
  const pager = pagers.get(rowId);
  if (!pager) return;
  const step = Math.max(200, pager.width - 2 * inset - peek);
  pager.view.scrollTo({ x: Math.max(0, pager.x + direction * step), animated: true });
}


const styles = StyleSheet.create({
  searchGuide: { alignSelf: 'stretch', alignItems: 'center' },
});
