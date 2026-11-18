import { Navigator, useIsFocused, usePathname } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, useWindowDimensions, View } from 'react-native';
import { useVelaState } from '@vela/core/react';
import { SkinRoot } from '@vela/skin';
import Reanimated from 'react-native-reanimated';
import { useVela } from '../../src/vela';
import Home from './index';
import { LibrarySection } from './library/[id]';
import type { LibraryParams } from '../../src/browse/library-query';
import { FocusBoundary } from '../../src/focus-boundary';
import { SectionFocusContext } from '../../src/section-focus';
import { SECTION_SLIDE_MS, slideInForward, slideInBackward, slideOutForward, slideOutBackward } from '../../src/section-motion';

type Section = { route: 'home' | 'library' | 'live'; entry: string };

function sectionForPath(path: string): Section | null {
  if (path === '/') return { route: 'home', entry: 'home' };
  if (path === '/live') return { route: 'live', entry: 'live' };
  if (path.startsWith('/library/')) {
    return { route: 'library', entry: decodeURIComponent(path.slice('/library/'.length)) };
  }
  return null;
}

export default function SectionsLayout() {
  const pathname = usePathname();
  const navigationFocused = useIsFocused();
  const focused = navigationFocused && (!(Platform.isTV && Platform.OS === 'android') || sectionForPath(pathname) !== null);
  const section = useRef<Section>({ route: 'home', entry: 'home' });
  section.current = sectionForPath(pathname) ?? section.current;
  const vela = useVela();
  const routeHost = vela.host(section.current.route, section.current.entry);
  const host = routeHost;
  const shell = vela.doc?.shell;
  const { width } = useWindowDimensions();
  // A TV switches sections at once, as with Reduce Motion: the remote moves focus along the nav
  // and each press would otherwise start a slide over the last one.
  const [reducedMotionSetting, setReducedMotion] = useState(false);
  const reducedMotion = reducedMotionSetting || Platform.isTV;
  const offset = useRef(new Animated.Value(0)).current;
  const previous = useRef<string | null>(null);
  const outgoingOffset = useRef(new Animated.Value(0)).current;
  const libraries = host?.env.libraries ?? [];
  const key = `${section.current.route}:${section.current.entry}`;
  const order = section.current.route === 'home'
    ? 0
    : section.current.route === 'live'
      ? libraries.findIndex(library => library.kind === 'live') + 1 || libraries.length + 1
      : libraries.findIndex(library => library.id === section.current.entry) + 1;
  const previousOrder = useRef(order);
  const transition = useRef({ key, direction: 1, animated: false });
  if (transition.current.key !== key) {
    transition.current = { key, direction: order >= previousOrder.current ? 1 : -1, animated: !reducedMotion && !Platform.isTV };
  }

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);

  useLayoutEffect(() => {
    if (!Platform.isTV && Platform.OS !== 'web' && previous.current !== null && previous.current !== key && !reducedMotion) {
      const direction = order >= previousOrder.current ? 1 : -1;
      offset.setValue(direction * width);
      outgoingOffset.setValue(0);
      Animated.parallel([
        Animated.timing(offset, { toValue: 0, duration: SECTION_SLIDE_MS, useNativeDriver: true }),
        Animated.timing(outgoingOffset, { toValue: -direction * width, duration: SECTION_SLIDE_MS, useNativeDriver: true }),
      ]).start();
    } else {
      offset.setValue(0);
      outgoingOffset.setValue(0);
    }
    previous.current = key;
    previousOrder.current = order;
  }, [key, offset, outgoingOffset, order, reducedMotion, width]);

  const session = useVelaState(state => state.auth.revision);
  const content = (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <Navigator>
        <SectionScenes key={session} focused={focused} sectionKey={key} offset={offset} outgoingOffset={outgoingOffset} reducedMotion={reducedMotion} transition={transition.current} />
      </Navigator>
    </View>
  );
  if (!host || !shell) return content;
  const drawn = <SkinRoot host={{ ...host, children: content }} node={shell} />;
  return Platform.isTV && Platform.OS === 'android'
    ? <FocusBoundary active={focused} style={{ flex: 1 }}>{drawn}</FocusBoundary>
    : drawn;
}

/** Keep visited sections mounted; only the active and briefly outgoing scenes are visible. */
function SectionScenes({ focused, sectionKey, offset, outgoingOffset, reducedMotion, transition }: {
  focused: boolean;
  sectionKey: string;
  offset: Animated.Value;
  outgoingOffset: Animated.Value;
  reducedMotion: boolean;
  transition: { direction: number; animated: boolean };
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
  const scenes = [...retained.current.values()];
  return (
    <View style={{ flex: 1 }}>
      {scenes.map(scene => {
        const isCurrent = scene.key === sectionKey;
        const visible = isCurrent || scene.key === outgoing.current?.key;
        const webAnimation = visible && Platform.OS === 'web' && transition.animated && !reducedMotion
          ? {
            animationName: isCurrent
              ? transition.direction > 0 ? slideInForward : slideInBackward
              : transition.direction > 0 ? slideOutForward : slideOutBackward,
            animationDuration: SECTION_SLIDE_MS,
            animationTimingFunction: 'ease-in-out' as const,
            animationFillMode: 'both' as const,
          }
          : undefined;
        const SceneView = Platform.OS === 'web' ? Reanimated.View : Animated.View;
        return (
          <SceneView
            key={scene.key}
            testID={`section-${scene.key}`}
            pointerEvents={isCurrent ? 'auto' : 'none'}
            accessibilityElementsHidden={!isCurrent}
            importantForAccessibility={isCurrent ? 'auto' : 'no-hide-descendants'}
            style={{
              display: visible ? 'flex' : 'none',
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              ...(Platform.OS === 'web' ? webAnimation : {
                transform: [{ translateX: isCurrent ? offset : outgoingOffset }],
              }),
            }}
          >
            <SectionFocusContext.Provider value={focused && isCurrent}>
              {scene.content}
            </SectionFocusContext.Provider>
          </SceneView>
        );
      })}
    </View>
  );
}
