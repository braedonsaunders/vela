// One route drawn by the active document: the shell's tree around the route's tree. A document
// that fails to resolve says so; nothing half-draws. A route with a page model of its own (a
// library, a collection) adds it to the host with `page`.
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Platform, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { ScreenActive, SkinRoot, SkinRoute, SkinLibraryViews, focusElement, useReturnFocus, type RouteName, type SkinHost } from '@vela/skin';
import type { RNode } from '@vela/skin/src/resolve';
import { useVela } from './vela';
import { useSectionFocus } from './section-focus';
import { SECTION_SLIDE_MS, slideInForward, slideInBackward, slideOutForward, slideOutBackward } from './section-motion';

interface Props {
  route: RouteName;
  entry: string;
  page?: (host: SkinHost) => SkinHost;
  sharedShell?: boolean;
}

export function DocumentScreen({ route, entry, page, sharedShell = false }: Props) {
  const vela = useVela();
  const app = vela.host(route, entry);
  const host = useMemo(() => app && page ? page(app) : app, [app, page]);
  const season = route === 'title' ? host?.env.season : '';
  useEffect(() => {
    if (season) void vela.store.catalogue.title(season);
  }, [season, vela.store]);
  // On TV, focus returns to the card or button that opened the route above when it closes.
  const navigationFocused = useIsFocused();
  const sectionFocused = useSectionFocus();
  useReturnFocus(sectionFocused ?? navigationFocused);
  const isCurrent = sectionFocused ?? navigationFocused;
  const focusSearch = !!host?.env.flags.includes('focus-search-on-home');
  const setFlag = host?.setFlag;
  useEffect(() => {
    if (route !== 'home' || !isCurrent || !focusSearch || !setFlag) return;
    let frame = 0, attempts = 0;
    const focus = () => {
      if (focusElement('vela-search')) setFlag('focus-search-on-home', false);
      else if (++attempts < 120) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [route, isCurrent, focusSearch, setFlag]);
  if (vela.docError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: '#f5f1e9', fontSize: 18 }}>{vela.docError}</Text>
      </View>
    );
  }
  const tree = vela.doc?.routes[route];
  if (!host || !tree) return <View style={{ flex: 1 }} />;
  // Search draws in home's view, after home's nodes, while a query is open (docs/skin-schema.md).
  const search = route === 'home' && host.env.query !== '' ? vela.doc?.routes.search : undefined;
  const content = route === 'library' ? <LibraryScenes host={host} node={tree} /> : <SkinRoute host={host} node={tree} after={search} />;
  const shell = route === 'title' || sharedShell ? undefined : vela.doc?.shell;
  // The transparent navigator modal fills the viewport, including the section shell's header.
  // Keep the scrim outside the skin's scrolling/frame geometry on web and native hosts alike.
  if (route === 'title') return (
    <ScreenActive.Provider value={isCurrent}>
      {/* On TV the title page is presented in the app's root view, so it stays in the tree under
          the player: while covered it must take no focus (no interaction, which the focus engine
          honours), or the remote's arrows move focus into it and never reach the player. */}
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.75)' }} accessibilityViewIsModal
        pointerEvents={isCurrent ? 'auto' : 'none'}>
        {content}
      </View>
    </ScreenActive.Provider>
  );
  return (
    <ScreenActive.Provider value={isCurrent}>
      {shell ? <SkinRoot host={{ ...host, children: content }} node={shell} /> : content}
    </ScreenActive.Provider>
  );
}

/** A library view slides like a section: the previous answer leaves as the new one enters. */
function LibraryScenes({ host, node }: { host: SkinHost; node: RNode }) {
  const request = host.env.library?.viewRequest ?? '';
  const view = host.env.library?.view ?? 'library';
  const order = ['recommended', 'library', 'collections', 'genres'];
  const still = host.env.still || Platform.isTV;
  const current = useRef({ request, view, host });
  const outgoing = useRef<{ request: string; view: string; host: SkinHost } | null>(null);
  const transition = useRef({ request, direction: 1, active: false });
  const incomingOffset = useRef(new Animated.Value(0)).current;
  const outgoingOffset = useRef(new Animated.Value(0)).current;
  const frame = useRef<HTMLElement | null>(null);
  const fixedNav = useRef<{ top: number; left: number; width: number } | null>(null);
  const restoreTab = useRef('');
  const [, refresh] = useState(0);
  if (current.current.request !== request) {
    const previous = current.current;
    const active = !still && previous.view !== view;
    const pinned = fixedNav.current;
    fixedNav.current = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const selected = document.activeElement;
      restoreTab.current = selected?.getAttribute('role') === 'tab' ? view : '';
      const nav = document.getElementById('vela-library-views');
      const parent = frame.current;
      if (active && pinned) fixedNav.current = pinned;
      else if (active && nav && parent?.getBoundingClientRect) {
        const bounds = nav.getBoundingClientRect(), root = parent.getBoundingClientRect();
        fixedNav.current = { top: bounds.top - root.top, left: bounds.left - root.left, width: bounds.width };
      }
    }
    outgoing.current = active ? previous : null;
    transition.current = { request, direction: order.indexOf(view) >= order.indexOf(previous.view) ? 1 : -1, active };
  }
  current.current = { request, view, host };
  useLayoutEffect(() => {
    if (!transition.current.active || still || Platform.OS === 'web') return;
    const direction = transition.current.direction;
    incomingOffset.setValue(direction * host.viewport.width);
    outgoingOffset.setValue(0);
    Animated.parallel([
      Animated.timing(incomingOffset, { toValue: 0, duration: SECTION_SLIDE_MS, useNativeDriver: true }),
      Animated.timing(outgoingOffset, { toValue: -direction * host.viewport.width, duration: SECTION_SLIDE_MS, useNativeDriver: true }),
    ]).start();
  }, [request, still, host.viewport.width, incomingOffset, outgoingOffset]);
  useEffect(() => {
    const complete = () => {
      outgoing.current = null; fixedNav.current = null; transition.current.active = false; refresh(value => value + 1);
      const tab = restoreTab.current;
      restoreTab.current = '';
      if (tab) requestAnimationFrame(() => focusElement(`vela-library-view-${tab}`));
    };
    if (!outgoing.current) { if (restoreTab.current) requestAnimationFrame(complete); return; }
    const timer = setTimeout(complete, SECTION_SLIDE_MS);
    return () => clearTimeout(timer);
  }, [request, still]);
  const scene = (sceneHost: SkinHost, isCurrent: boolean) => {
    const active = transition.current.active && !still;
    const webAnimation = Platform.OS === 'web' && active ? {
      animationName: isCurrent ? transition.current.direction > 0 ? slideInForward : slideInBackward : transition.current.direction > 0 ? slideOutForward : slideOutBackward,
      animationDuration: SECTION_SLIDE_MS, animationTimingFunction: 'ease-in-out' as const, animationFillMode: 'both' as const,
    } : undefined;
    const Scene = Platform.OS === 'web' ? Reanimated.View : Animated.View;
    return <Scene key={isCurrent ? `current:${request}` : `outgoing:${outgoing.current?.request}`} pointerEvents={isCurrent ? 'auto' : 'none'}
      accessibilityElementsHidden={!isCurrent} importantForAccessibility={isCurrent ? 'auto' : 'no-hide-descendants'}
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, ...(Platform.OS === 'web' ? webAnimation : { transform: [{ translateX: active ? isCurrent ? incomingOffset : outgoingOffset : 0 }] }) }}>
      <SkinRoute host={sceneHost} node={node} hideLibraryViews={!!fixedNav.current && active} />
    </Scene>;
  };
  return <View ref={frame as never} style={{ flex: 1, overflow: 'hidden' }}>
    {outgoing.current && !still ? scene(outgoing.current.host, false) : null}
    {scene(host, true)}
    {fixedNav.current && transition.current.active && !still ? <View style={{ position: 'absolute', ...fixedNav.current, zIndex: 20 }}><SkinLibraryViews host={host} /></View> : null}
  </View>;
}
