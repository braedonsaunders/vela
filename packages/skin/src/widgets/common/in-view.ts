// Whether a view is on screen, within a margin past the screen's edge: an IntersectionObserver
// on the web; on native, the view's window position checked while the app is in front. Reports
// each time the view comes into range, never while the app is in the background.
import { useEffect, useRef, type RefObject } from 'react';
import { AppState, Dimensions, Platform, type HostInstance } from 'react-native';

/** How far past the screen's edge counts as in range: below for a page, beyond the end for a row. */
export interface Reach {
  below: number;
  after: number;
}

const NATIVE_CHECK_MS = 400;

export function useInView(ref: RefObject<HostInstance | null>, reach: Reach, onEnter: () => void): void {
  const latest = useRef(onEnter);
  latest.current = onEnter;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const enter = () => latest.current();
    return Platform.OS === 'web'
      ? observeWeb(node as unknown as Element, reach, enter)
      : pollNative(node, reach, enter);
  }, [ref, reach.below, reach.after]);
}

function observeWeb(element: Element, reach: Reach, enter: () => void): () => void {
  const observer = new IntersectionObserver(
    entries => {
      if (document.visibilityState !== 'visible') return;
      if (entries.some(entry => entry.isIntersecting)) enter();
    },
    { rootMargin: `0px ${reach.after}px ${reach.below}px 0px` },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

function pollNative(node: HostInstance, reach: Reach, enter: () => void): () => void {
  let inside = false;
  const check = () => {
    if (AppState.currentState !== 'active') return;
    node.measureInWindow((x, y, width, height) => {
      const screen = Dimensions.get('window');
      const visible = width > 0 || height > 0;
      const now =
        visible &&
        x < screen.width + reach.after &&
        x + width > 0 &&
        y < screen.height + reach.below &&
        y + height > 0;
      if (now && !inside) enter();
      inside = now;
    });
  };
  check();
  const timer = setInterval(check, NATIVE_CHECK_MS);
  return () => clearInterval(timer);
}
