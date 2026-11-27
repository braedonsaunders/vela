import { Navigator, useIsFocused, usePathname } from 'expo-router';
import { router } from '../../src/router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';
import { useVelaState } from '@vela/core/react';
import { ScreenActive, SkinRoot, SkipToContent, type SkinHost } from '@vela/skin';
import { useVela } from '../../src/vela';
import { retainedHost } from '../../src/retained-host';
import Home from './index';
import { LibrarySection } from './library/[id]';
import type { LibraryParams } from '../../src/browse/library-query';
import { FocusBoundary } from '../../src/focus-boundary';
import { SectionFocusContext, SectionShellHostContext } from '../../src/section-focus';
import { SectionScene } from '../../src/section-scene';
import { SECTION_SLIDE_MS, sectionDirection, type SectionDirection } from '../../src/section-motion';
import { trimSectionCache } from '../../src/section-cache';
import { sectionBack, sectionRoute, sectionIsActive, type SectionRoute as Section } from '../../src/section-route';
import { switchSection } from '../../src/browse/open';
import { holdBack } from '@vela/skin/src/menu-key';
import { screenDestinationId } from '../../src/plugin-screens';

export default function SectionsLayout() {
  // A skin change or host update must not replace the navigator that owns section history.
  return <Navigator><SectionsContent /></Navigator>;
}

function SectionsContent() {
  const { state } = Navigator.useContext();
  const activeRoute = state.routes[state.index];
  const pathname = usePathname();
  const navigationFocused = useIsFocused();
  const focused = sectionIsActive(pathname, navigationFocused, Platform.isTV);
  const section = useRef<Section>({ route: 'home', entry: 'home' });
  section.current = sectionRoute(activeRoute?.name, (activeRoute?.params as { id?: unknown } | undefined)?.id) ?? section.current;
  const vela = useVela();
  const routeHost = vela.host(section.current.route, section.current.entry);
  const [pageHost, setPageHost] = useState<SkinHost | null>(null);
  const publishShellHost = useCallback((page: SkinHost, active: boolean) => {
    setPageHost(current => active ? page : current === page ? null : current);
  }, []);
  const host = routeHost?.env.small && pageHost?.env.route === section.current.route
    && pageHost.env.section === section.current.entry ? pageHost : routeHost;
  const held = useRef(host);
  held.current = retainedHost(held.current, host, focused);
  const shellHost = held.current;
  const shell = vela.doc?.shell;
  // A TV switches sections at once, as with Reduce Motion: the remote moves focus along the nav
  // and each press would otherwise start a slide over the last one.
  const [reducedMotionSetting, setReducedMotion] = useState(false);
  const reducedMotion = reducedMotionSetting || Platform.isTV;
  const libraries = host?.env.libraries ?? [];
  const key = `${section.current.route}:${section.current.entry}`;
  const order = section.current.route === 'home'
    ? 0
    : section.current.route === 'live'
      ? libraries.findIndex(library => library.kind === 'live') + 1 || libraries.length + 1
      : section.current.route === 'screen'
        ? libraries.findIndex(library => library.id === screenDestinationId(section.current.entry)) + 1 || libraries.length + 2
        : libraries.findIndex(library => library.id === section.current.entry) + 1;
  const previousOrder = useRef(order);
  const transition = useRef<{ key: string; direction: SectionDirection; animated: boolean }>({ key, direction: 1, animated: false });
  if (transition.current.key !== key) {
    transition.current = { key, direction: sectionDirection(order, previousOrder.current), animated: !reducedMotion && !Platform.isTV };
  }

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);

  useLayoutEffect(() => {
    previousOrder.current = order;
  }, [key, order]);

  // tvOS gives Menu to the app only while something holds it (menu-key.ts); otherwise Menu leaves
  // Vela for the system's Home, from any section. Android TV's Back goes to Vela's Home first, so on
  // tvOS each section but Home holds it too, as a fallback for whatever else is open (a menu, Now
  // Playing, a music page going back a page): Menu on a page inside the section goes back, on the
  // section's root to Home, and on Home it leaves Vela.
  // A plugin section opened by a deep link may have no Home in its Android history.
  const menuBack = focused && (Platform.isTV && Platform.OS === 'ios' || Platform.OS === 'android' && section.current.route === 'screen')
    ? sectionBack(state.routes, state.index) : null;
  useEffect(() => {
    if (!menuBack) return;
    return holdBack(() => {
      if (menuBack === 'back' && router.canGoBack()) router.back();
      else switchSection(options => router.dismissTo('/', options));
      return true;
    }, { fallback: true });
  }, [menuBack]);

  const session = useVelaState(state => state.auth.revision);
  const content = useMemo(() => (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <SectionScenes key={session} focused={focused} sectionKey={key} reducedMotion={reducedMotion} reducedMotionSetting={reducedMotionSetting} transition={transition.current} />
    </View>
  ), [session, focused, key, reducedMotion, reducedMotionSetting, transition.current]);
  const framedHost = useMemo(() => shellHost ? { ...shellHost, children: content } : null, [shellHost, content]);
  if (!framedHost || !shell) return content;
  // Skip to content comes before the shell's navigation, so it is the first tab stop.
  const drawn = <SectionShellHostContext.Provider value={publishShellHost}><ScreenActive.Provider value={focused}><SkipToContent /><SkinRoot host={framedHost} node={shell} /></ScreenActive.Provider></SectionShellHostContext.Provider>;
  return Platform.isTV && Platform.OS === 'android'
    ? <FocusBoundary active={focused} style={{ flex: 1 }}>{drawn}</FocusBoundary>
    : drawn;
}

/** Keep visited sections mounted; only the active and briefly outgoing scenes are visible. */
function SectionScenes({ focused, sectionKey, reducedMotion, reducedMotionSetting, transition }: {
  focused: boolean;
  sectionKey: string;
  reducedMotion: boolean;
  reducedMotionSetting: boolean;
  transition: { direction: SectionDirection; animated: boolean };
}) {
  const { state, descriptors } = Navigator.useContext();
  const route = state.routes[state.index];
  const libraryId = sectionKey.startsWith('library:') ? sectionKey.slice('library:'.length) : '';
  // Render data sections directly: Expo descriptors carry replaceable route identities
  // and navigation activity boundaries, which otherwise remount a revisited library.
  const current = libraryId
    ? <LibrarySection id={libraryId} params={(route?.params as { id?: string })?.id === libraryId ? route.params as LibraryParams : {}} />
    : sectionKey === 'home:home' ? <Home /> : route ? descriptors[route.key]?.render() : null;
  const retained = useRef(new Map<string, { key: string; content: ReactNode }>());
  const last = useRef<{ key: string; content: ReactNode } | null>(null);
  const outgoing = useRef<{ key: string; content: ReactNode } | null>(null);
  const [, refresh] = useState(0);
  if (route && last.current?.key !== sectionKey) {
    outgoing.current = reducedMotion || Platform.isTV ? null : last.current;
    last.current = { key: sectionKey, content: current };
  } else if (route) {
    last.current = { key: sectionKey, content: current };
  }
  useEffect(() => {
    if (!outgoing.current) return;
    const timer = setTimeout(() => {
      outgoing.current = null;
      refresh(value => value + 1);
    }, SECTION_SLIDE_MS);
    return () => clearTimeout(timer);
  }, [sectionKey, reducedMotion]);
  if (last.current) retained.current.set(sectionKey, last.current);
  if (Platform.OS === 'android' && !Platform.isTV) trimSectionCache(retained.current, sectionKey, outgoing.current?.key);
  const scenes = [...retained.current.values()];
  return (
    <View style={{ flex: 1 }}>
      {scenes.map(scene => {
        const isCurrent = scene.key === sectionKey;
        const visible = isCurrent || scene.key === outgoing.current?.key;
        return (
          <SectionScene
            key={scene.key}
            testID={`section-${scene.key}`}
            current={isCurrent}
            visible={visible}
            animated={transition.animated && !reducedMotion}
            fade={Platform.isTV && !reducedMotionSetting}
            direction={transition.direction}
            transitionKey={sectionKey}
          >
            <SectionFocusContext.Provider value={focused && isCurrent}>
              {scene.content}
            </SectionFocusContext.Provider>
          </SectionScene>
        );
      })}
    </View>
  );
}
