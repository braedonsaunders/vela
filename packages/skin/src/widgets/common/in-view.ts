// Whether a view is on screen, within a margin past the screen's edge: an IntersectionObserver
// on the web; on native, the view's window position checked while the app is in front. A view
// counts as coming into range only while the app is in the foreground; leaving is always reported.
import { useEffect, useRef, type RefObject } from 'react';
import { AppState, Dimensions, Platform, type HostInstance } from 'react-native';

/** How far past the screen's edge counts as in range: below for a page, beyond the end for a row. */
export interface Reach {
  below: number;
  after: number;
}

const NATIVE_CHECK_MS = 400;

/** Reports each change of the view's visibility: true when it comes into range, false when it leaves. */
export function useVisibility(
  ref: RefObject<HostInstance | null>,
  reach: Reach,
  onChange: (visible: boolean) => void,
): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const change = (visible: boolean) => latest.current(visible);
    return Platform.OS === 'web'
      ? observeWeb(node as unknown as Element, reach, change)
      : pollNative(node, reach, change);
  }, [ref, reach.below, reach.after]);
}

/** Calls `onEnter` each time the view comes into range. */
export function useInView(ref: RefObject<HostInstance | null>, reach: Reach, onEnter: () => void): void {
  const latest = useRef(onEnter);
  latest.current = onEnter;
  useVisibility(ref, reach, visible => {
    if (visible) latest.current();
  });
}

function observeWeb(element: Element, reach: Reach, change: (visible: boolean) => void): () => void {
  let inside = false;
  const observer = new IntersectionObserver(
    entries => {
      const now = entries.some(entry => entry.isIntersecting);
      if (now && document.visibilityState !== 'visible') return;
      if (now !== inside) change(now);
      inside = now;
    },
    { rootMargin: `0px ${reach.after}px ${reach.below}px 0px` },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

function pollNative(node: HostInstance, reach: Reach, change: (visible: boolean) => void): () => void {
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
      if (now !== inside) change(now);
      inside = now;
    });
  };
  check();
  const timer = setInterval(check, NATIVE_CHECK_MS);
  return () => clearInterval(timer);
}
