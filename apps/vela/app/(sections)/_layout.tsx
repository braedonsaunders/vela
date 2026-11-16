import { Navigator, usePathname } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, useWindowDimensions, View } from 'react-native';
import { SkinRoot } from '@vela/skin';
import { useVela } from '../../src/vela';

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
  const section = useRef<Section>({ route: 'home', entry: 'home' });
  section.current = sectionForPath(pathname) ?? section.current;
  const vela = useVela();
  const host = vela.host(section.current.route, section.current.entry);
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

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);

  useLayoutEffect(() => {
    if (previous.current !== null && previous.current !== key && !reducedMotion) {
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
        <SectionScenes offset={offset} outgoingOffset={outgoingOffset} reducedMotion={reducedMotion} />
      </Navigator>
    </View>
  );
  if (!host || !shell) return content;
  return <SkinRoot host={{ ...host, children: content }} node={shell} />;
}

/** Retain the previous navigator descriptor briefly so both pages move together. */
function SectionScenes({ offset, outgoingOffset, reducedMotion }: {
  offset: Animated.Value;
  outgoingOffset: Animated.Value;
  reducedMotion: boolean;
}) {
  const { state, descriptors } = Navigator.useContext();
  const route = state.routes[state.index];
  const current = route ? descriptors[route.key]?.render() : null;
  const last = useRef<{ key: string; content: ReactNode } | null>(null);
  const outgoing = useRef<{ key: string; content: ReactNode } | null>(null);
  const [, refresh] = useState(0);
  if (route && last.current?.key !== route.key) {
    outgoing.current = reducedMotion ? null : last.current;
    last.current = { key: route.key, content: current };
  } else if (route) {
    last.current = { key: route.key, content: current };
  }
  useEffect(() => {
    if (!outgoing.current) return;
    const timer = setTimeout(() => {
      outgoing.current = null;
      refresh(value => value + 1);
    }, 260);
    return () => clearTimeout(timer);
  }, [route?.key, reducedMotion]);
  return (
    <View style={{ flex: 1 }}>
      {outgoing.current && (
        <Animated.View
          key={outgoing.current.key}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
            transform: [{ translateX: outgoingOffset }] }}
        >
          {outgoing.current.content}
        </Animated.View>
      )}
      <Animated.View key={route?.key} style={{ flex: 1, transform: [{ translateX: offset }] }}>
        {current}
      </Animated.View>
    </View>
  );
}
