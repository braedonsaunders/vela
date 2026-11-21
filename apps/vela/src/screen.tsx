import { retainedHost } from './retained-host';
// One route drawn by the active document: the shell's tree around the route's tree. A document
// that fails to resolve says so; nothing half-draws. A route with a page model of its own (a
// library, a collection) adds it to the host with `page`.
import { useIsFocused, usePathname } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, Text, View } from 'react-native';
import { ScreenActive, SkinRoot, SkinRoute, SkinLibraryViews, SkipToContent, focusElement, useReturnFocus, type RouteName, type SkinHost } from '@vela/skin';
import type { RNode } from '@vela/skin/src/resolve';
import { useSideInsets, useVela } from './vela';
import { FocusBoundary } from './focus-boundary';
import { documentIsVisible } from './visible-route';
import { SectionShellHostContext, useSectionFocus } from './section-focus';
import { SectionScene, sectionSlide } from './section-scene';
import Reanimated from 'react-native-reanimated';
import { MODAL_ENTER_KEYFRAMES, MODAL_ENTER_MS, MODAL_TEST_ID } from './modal-motion';
import { SECTION_SLIDE_MS, sectionDirection, type SectionDirection } from './section-motion';

interface Props {
  route: RouteName;
  entry: string;
  library?: string;
  page?: (host: SkinHost) => SkinHost;
  sharedShell?: boolean;
  /** A tree drawn in place of the document's own for the route (a media title's page). */
  node?: RNode;
}

export function DocumentScreen({ route, entry, library, page, sharedShell = false, node }: Props) {
  const vela = useVela();
  const sides = useSideInsets();
  const app = vela.host(route, entry, library);
  const host = useMemo(() => app && page ? page(app) : app, [app, page]);
  const season = route === 'title' ? host?.env.season : '';
  useEffect(() => {
    if (season) void vela.store.catalogue.title(season);
  }, [season, vela.store]);
  // On TV, focus returns to the card or button that opened the route above when it closes.
  const navigationFocused = useIsFocused();
  const pathname = usePathname();
  const sectionFocused = useSectionFocus();
  const visibleRoute = !(Platform.isTV && Platform.OS === 'android') || documentIsVisible(route, entry, pathname);
  const isCurrent = (sectionFocused ?? navigationFocused) && visibleRoute;
  useReturnFocus(isCurrent);
  const held = useRef(host);
  held.current = retainedHost(held.current, host, isCurrent);
  const contentHost = held.current;
  const publishShellHost = useContext(SectionShellHostContext);
  // LibraryState's wrapper/actions are recreated on render. Publish only when the base host or
  // memoized page model changes, so publishing into the shell cannot trigger itself again.
  const shellHost = useMemo(() => host, [app, host?.env.library]);
  useLayoutEffect(() => {
    if (!sharedShell || !isCurrent || !shellHost || !publishShellHost) return;
    publishShellHost(shellHost, true);
    return () => publishShellHost(shellHost, false);
  }, [sharedShell, isCurrent, shellHost, publishShellHost]);
  const focusSearch = !!host?.env.flags.includes('focus-search-on-home');
  const setFlag = host?.setFlag;
  useEffect(() => {
    if (route !== 'home' || !isCurrent || !focusSearch || !setFlag) return;
    let frame = 0, attempts = 0;
    const focus = () => {
      if (focusElement('vela-search')) setFlag('focus-search-on-home', false);
      else if (++attempts < 120) frame = requestAnimationFrame(focus);
    };
    // Android can focus an input during a native slide without opening its keyboard.
    const timer = Platform.OS === 'android' && !Platform.isTV
      ? setTimeout(() => { frame = requestAnimationFrame(focus); }, SECTION_SLIDE_MS + 50)
      : undefined;
    if (timer === undefined) frame = requestAnimationFrame(focus);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [route, isCurrent, focusSearch, setFlag]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !isCurrent || (route !== 'title' && route !== 'person') || host?.env.load !== 'ready') return;
    let frame = 0, attempts = 0;
    const focus = () => {
      if (!focusElement('detail-close') && ++attempts < 120) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [route, isCurrent, host?.env.load, entry]);
  if (vela.docError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: '#f5f1e9', fontSize: 18 }}>{vela.docError}</Text>
      </View>
    );
  }
  const tree = node ?? vela.doc?.routes[route];
  if (!host || !contentHost || !tree) return <View style={{ flex: 1 }} />;
  // Search draws in home's view, after home's nodes, while a query is open (docs/skin-schema.md).
  const search = route === 'home' && contentHost.env.query !== '' ? vela.doc?.routes.search : undefined;
  const content = route === 'library' ? <LibraryScenes host={contentHost} node={tree} /> : <SkinRoute host={contentHost} node={tree} after={search} />;
  const shell = route === 'title' || route === 'person' || sharedShell ? undefined : vela.doc?.shell;
  const mainId = `vela-main-${route}-${library ?? 'all'}`.replace(/[^a-z0-9_-]/gi, '-');
  const main = <View nativeID={mainId} accessibilityRole="main" {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})} style={{ flex: 1 }}>{content}</View>;
  // The transparent navigator modal fills the viewport, including the section shell's header.
  // Keep the scrim outside the skin's scrolling/frame geometry on web and native hosts alike.
  if (route === 'title' || route === 'person') return (
    <ScreenActive.Provider value={isCurrent}>
      {/* The web's scrim dissolves in as the frame rises (modal-motion.ts); native hosts fade
          the whole modal in with the navigator. */}
      <ModalView still={host.env.still}>
        {/* On TV the title page is presented in the app's root view, so it stays in the tree under
            the player: while covered it must take no focus (no interaction, which the focus engine
            honours), or the remote's arrows move focus into it and never reach the player. */}
        <FocusBoundary active={isCurrent} enterWhenReady={host.env.load === 'ready'} style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.75)', paddingLeft: sides.paddingLeft, paddingRight: sides.paddingRight }} accessibilityViewIsModal>
          {content}
        </FocusBoundary>
      </ModalView>
    </ScreenActive.Provider>
  );
  return (
    <ScreenActive.Provider value={isCurrent}>
      {/* On TV a covered screen (home under a title page, a section behind another) takes no focus. */}
      <FocusBoundary active={isCurrent} entered={false} style={{ flex: 1 }}>
        {/* A shared section shell draws its own first, before its navigation. */}
        {!sharedShell && <SkipToContent target={mainId} />}
        {shell ? <SkinRoot host={{ ...host, children: main }} node={shell} /> : main}
      </FocusBoundary>
    </ScreenActive.Provider>
  );
}

/** The title or person modal's own view: on the web, the scrim's dissolve in and the element
 * closeModal fades out. */
function ModalView({ still, children }: { still: boolean; children: ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <Reanimated.View testID={MODAL_TEST_ID} style={{ flex: 1, ...(still ? {} : {
      animationName: MODAL_ENTER_KEYFRAMES, animationDuration: MODAL_ENTER_MS, animationTimingFunction: 'ease-out', animationFillMode: 'both',
    }) }}>
      {children}
    </Reanimated.View>
  );
}

/** A library view slides like a section: the previous answer leaves as the new one enters. */
function LibraryScenes({ host, node }: { host: SkinHost; node: RNode }) {
  const request = host.env.library?.viewRequest ?? '';
  const view = host.env.library?.view ?? 'library';
  const order: string[] = host.env.library?.model?.tabs?.map(tab => tab.kind) ?? ['recommended', 'library', 'collections', 'genres'];
  const still = host.env.still || Platform.isTV;
  const current = useRef({ request, view, host });
  const outgoing = useRef<{ request: string; view: string; host: SkinHost } | null>(null);
  const transition = useRef<{ request: string; direction: SectionDirection; active: boolean }>({ request, direction: 1, active: false });
  const incomingOffset = useRef(new Animated.Value(0)).current;
  const outgoingOffset = useRef(new Animated.Value(0)).current;
  const frame = useRef<HTMLElement | null>(null);
  const fixedNav = useRef<{ top: number; left: number; width: number; surface: Record<string, string | number> } | null>(null);
  const restoreTab = useRef('');
  const [, refresh] = useState(0);
  if (current.current.request !== request) {
    const previous = current.current;
    const active = !still && previous.view !== view;
    const pinned = fixedNav.current;
    fixedNav.current = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const selected = document.activeElement;
      restoreTab.current = selected?.getAttribute('role') === 'tab' ? host.env.library?.tabId ?? view : '';
      const nav = document.querySelector<HTMLElement>('[data-testid="library-toolbar"]');
      const parent = frame.current;
      if (active && pinned) fixedNav.current = pinned;
      else if (active && nav && parent?.getBoundingClientRect) {
        const bounds = nav.getBoundingClientRect(), root = parent.getBoundingClientRect();
        let surface = nav.parentElement;
        while (surface && surface !== parent && getComputedStyle(surface).position !== 'sticky') surface = surface.parentElement;
        if (!surface || surface === parent) {
          surface = nav.parentElement;
          while (surface && surface !== parent && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement;
        }
        const drawn = surface && surface !== parent ? getComputedStyle(surface) : null;
        // libraryViews owns the document's horizontal gutter. Pin its full-width frame at the
        // toolbar's vertical position; using the measured inner left/width applies that gutter twice.
        fixedNav.current = { top: bounds.top - root.top, left: 0, width: root.width, surface: drawn ? {
          backgroundColor: drawn.backgroundColor,
          backdropFilter: drawn.backdropFilter,
          borderBottomColor: drawn.borderBottomColor,
          borderBottomWidth: drawn.borderBottomWidth,
          borderBottomStyle: drawn.borderBottomStyle,
          boxShadow: drawn.boxShadow,
        } : {} };
      }
    }
    outgoing.current = active ? previous : null;
    transition.current = { request, direction: sectionDirection(order.indexOf(view), order.indexOf(previous.view)), active };
  }
  current.current = { request, view, host };
  const complete = useCallback(() => {
    outgoing.current = null; fixedNav.current = null; transition.current.active = false; refresh(value => value + 1);
    const tab = restoreTab.current;
    restoreTab.current = '';
    if (tab) requestAnimationFrame(() => focusElement(`vela-library-view-${tab}`));
  }, []);
  // Natively the slide ends the transition when it finishes: a timer ran out first whenever the
  // JS thread was busy drawing the new view, and the scene was left where the slide had got to.
  useLayoutEffect(() => {
    if (!transition.current.active || still || Platform.OS === 'web') return;
    const direction = transition.current.direction;
    const slide = sectionSlide(incomingOffset, outgoingOffset, direction, host.viewport.width);
    slide.start(({ finished }) => { if (finished) complete(); });
    return () => { slide.stop(); incomingOffset.setValue(0); };
  }, [request, still, host.viewport.width, incomingOffset, outgoingOffset, complete]);
  useEffect(() => {
    if (Platform.OS !== 'web' && !still) {
      if (!outgoing.current && restoreTab.current) requestAnimationFrame(complete);
      return;
    }
    if (!outgoing.current) { if (restoreTab.current) requestAnimationFrame(complete); return; }
    const timer = setTimeout(complete, SECTION_SLIDE_MS);
    return () => clearTimeout(timer);
  }, [request, still, complete]);
  const scene = (sceneHost: SkinHost, isCurrent: boolean) => {
    const active = transition.current.active && !still;
    // Keyed by the request alone: the view that was current stays mounted as it leaves, rather
    // than being drawn again from nothing alongside the view coming in.
    return <SectionScene key={`scene:${isCurrent ? request : outgoing.current?.request}`} current={isCurrent}
      animated={active} direction={transition.current.direction} offset={isCurrent ? incomingOffset : outgoingOffset}>
      <SkinRoute host={sceneHost} node={node} hideLibraryViews={!!fixedNav.current && active} />
    </SectionScene>;
  };
  return <View ref={frame as never} style={{ flex: 1, overflow: 'hidden' }}>
    {outgoing.current && !still ? scene(outgoing.current.host, false) : null}
    {scene(host, true)}
    {fixedNav.current && transition.current.active && !still ? <View style={[{ position: 'absolute', top: fixedNav.current.top, left: fixedNav.current.left,
      width: fixedNav.current.width, zIndex: 20 }, fixedNav.current.surface as never]}><SkinLibraryViews host={host} /></View> : null}
  </View>;
}
