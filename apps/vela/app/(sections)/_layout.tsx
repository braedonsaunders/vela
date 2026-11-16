import { Slot, usePathname } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
      offset.setValue(order >= previousOrder.current ? width : -width);
      Animated.timing(offset, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();
    } else {
      offset.setValue(0);
    }
    previous.current = key;
    previousOrder.current = order;
  }, [key, offset, order, reducedMotion, width]);

  const content = (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: offset }] }}>
        <Slot />
      </Animated.View>
    </View>
  );
  if (!host || !shell) return content;
  return <SkinRoot host={{ ...host, children: content }} node={shell} />;
}
