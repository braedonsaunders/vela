import { Navigator, useIsFocused, usePathname } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, useWindowDimensions, View } from 'react-native';
import { SkinRoot } from '@vela/skin';
import Reanimated from 'react-native-reanimated';
import { useVela } from '../../src/vela';
import { SectionFocusContext } from '../../src/section-focus';

const slideInForward = { from: { transform: [{ translateX: '100%' }] }, to: { transform: [{ translateX: '0%' }] } };
const slideInBackward = { from: { transform: [{ translateX: '-100%' }] }, to: { transform: [{ translateX: '0%' }] } };
const slideOutForward = { from: { transform: [{ translateX: '0%' }] }, to: { transform: [{ translateX: '-100%' }] } };
const slideOutBackward = { from: { transform: [{ translateX: '0%' }] }, to: { transform: [{ translateX: '100%' }] } };

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
  const focused = useIsFocused();
  const section = useRef<Section>({ route: 'home', entry: 'home' });
  section.current = sectionForPath(pathname) ?? section.current;
  const vela = useVela();
  const routeHost = vela.host(section.current.route, section.current.entry);
  const host = routeHost && section.current.route === 'library'
    ? { ...routeHost, env: { ...routeHost.env, section: section.current.entry } }
    : routeHost;
  const shell = vela.doc?.shell;
  const { width } = useWindowDimensions();
  const [reducedMotion, setReducedMotion] = useState(false);
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
    transition.current = { key, direction: order >= previousOrder.current ? 1 : -1, animated: !reducedMotion };
  }

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' && previous.current !== null && previous.current !== key && !reducedMotion) {
      const direction = order >= previousOrder.current ? 1 : -1;
      offset.setValue(direction * width);
      outgoingOffset.setValue(0);
      Animated.parallel([
        Animated.timing(offset, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(outgoingOffset, { toValue: -direction * width, duration: 260, useNativeDriver: true }),
      ]).start();
    } else {
      offset.setValue(0);
      outgoingOffset.setValue(0);
    }
    previous.current = key;
    previousOrder.current = order;
  }, [key, offset, outgoingOffset, order, reducedMotion, width]);

  const content = (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <Navigator>
        <SectionScenes focused={focused} sectionKey={key} offset={offset} outgoingOffset={outgoingOffset} reducedMotion={reducedMotion} transition={transition.current} />
      </Navigator>
    </View>
  );
  if (!host || !shell) return content;
  return <SkinRoot host={{ ...host, children: content }} node={shell} />;
}

/** Retain the previous navigator descriptor briefly so both pages move together. */
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
  const current = route ? descriptors[route.key]?.render() : null;
  const last = useRef<{ key: string; content: ReactNode } | null>(null);
  const outgoing = useRef<{ key: string; content: ReactNode } | null>(null);
  const [, refresh] = useState(0);
  if (route && last.current?.key !== sectionKey) {
    outgoing.current = reducedMotion ? null : last.current;
    last.current = { key: sectionKey, content: current };
  } else if (route) {
    last.current = { key: sectionKey, content: current };
  }
  useEffect(() => {
    if (!outgoing.current) return;
    const timer = setTimeout(() => {
      outgoing.current = null;
      refresh(value => value + 1);
    }, 260);
    return () => clearTimeout(timer);
  }, [sectionKey, reducedMotion]);
  const scenes = [outgoing.current, last.current].filter(
    (scene): scene is { key: string; content: ReactNode } => scene !== null,
  );
  return (
    <View style={{ flex: 1 }}>
      {scenes.map(scene => {
        const isCurrent = scene.key === sectionKey;
        const webAnimation = Platform.OS === 'web' && transition.animated && !reducedMotion
          ? {
            animationName: isCurrent
              ? transition.direction > 0 ? slideInForward : slideInBackward
              : transition.direction > 0 ? slideOutForward : slideOutBackward,
            animationDuration: 260,
            animationTimingFunction: 'ease-in-out' as const,
            animationFillMode: 'both' as const,
          }
          : undefined;
        const SceneView = Platform.OS === 'web' ? Reanimated.View : Animated.View;
        return (
          <SceneView
            key={scene.key}
            pointerEvents={isCurrent ? 'auto' : 'none'}
            accessibilityElementsHidden={!isCurrent}
            importantForAccessibility={isCurrent ? 'auto' : 'no-hide-descendants'}
            style={{
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
