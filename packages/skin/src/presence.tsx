// Things that come and go: a bar, a sheet, a panel, a menu. One motion vocabulary for all of them,
// matched to the section slide (260 ms) and the title frame's velaOpen: in with velaOpen's easing,
// out a little quicker with an ease-in. Each runs as Reanimated CSS transitions, on the UI thread
// on native and as CSS transitions on the web, animating only opacity and transform. A thing that
// leaves stays drawn until its exit has run. Under reduced motion every state is instant.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';

const web = Platform.OS === 'web';

/** The shared timings, ms. */
export const MOTION = {
  /** A thing arriving: the section slide's length. */
  enter: 260,
  /** A thing leaving: quicker, the viewer has already decided. */
  exit: 200,
  /** A small thing (a menu, a panel, a line of status). */
  quick: 160,
} as const;
/** velaOpen's easing: a long, soft settle. */
export const EASE_OUT = cubicBezier(0.16, 1, 0.3, 1);
/** Leaving: gathers speed as it goes. */
export const EASE_IN = cubicBezier(0.4, 0, 1, 1);

/** Where a thing is while hidden: transparent and moved by these. */
export interface Offstage { opacity?: number; x?: number; y?: number; scale?: number }

/** Mounted while shown and while its exit runs; `visible` is the state the motion heads to. A newly
 * shown thing is drawn hidden for one frame, then made visible, so its entry always runs. */
export function usePresence(shown: boolean, exitMs: number, still: boolean): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(shown);
  const [visible, setVisible] = useState(shown && still);
  const first = useRef(true);
  useEffect(() => {
    let frame = 0, second = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (shown) {
      setMounted(true);
      if (still) setVisible(true);
      // Two frames: the hidden state must be committed and painted before the visible one.
      else frame = requestAnimationFrame(() => { second = requestAnimationFrame(() => setVisible(true)); });
    } else {
      setVisible(false);
      if (still || first.current) setMounted(false);
      else timer = setTimeout(() => setMounted(false), exitMs);
    }
    first.current = false;
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(second); if (timer) clearTimeout(timer); };
  }, [shown, still, exitMs]);
  return { mounted: mounted || shown, visible: visible && shown };
}

/** The style a thing has while visible or offstage, and the transition between them. */
export function presenceStyle(visible: boolean, offstage: Offstage, still: boolean, enterMs: number = MOTION.enter, exitMs: number = MOTION.exit): ViewStyle {
  const hidden = { opacity: offstage.opacity ?? 0, x: offstage.x ?? 0, y: offstage.y ?? 0, scale: offstage.scale ?? 1 };
  const at = visible ? { opacity: 1, x: 0, y: 0, scale: 1 } : hidden;
  return {
    opacity: at.opacity,
    transform: [{ translateX: at.x }, { translateY: at.y }, { scale: at.scale }],
    ...(still ? {} : {
      transitionProperty: ['opacity', 'transform'],
      transitionDuration: visible ? enterMs : exitMs,
      transitionTimingFunction: visible ? EASE_OUT : EASE_IN,
    }),
  } as ViewStyle;
}

/** A thing that comes and goes with the shared motion. While leaving it takes no presses. */
export function Presence({ shown, still, offstage = { y: 12 }, enterMs = MOTION.enter, exitMs = MOTION.exit, style, children, testID, pointerEvents = 'box-none' }: {
  shown: boolean;
  still: boolean;
  offstage?: Offstage;
  enterMs?: number;
  exitMs?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
  pointerEvents?: 'box-none' | 'auto';
}) {
  const { mounted, visible } = usePresence(shown, exitMs, still);
  if (!mounted) return null;
  return (
    <Animated.View testID={testID} pointerEvents={shown ? pointerEvents : 'none'}
      style={[style, presenceStyle(visible, offstage, still, enterMs, exitMs), web && !visible ? ({ willChange: 'opacity, transform' } as ViewStyle) : null]}>
      {children}
    </Animated.View>
  );
}

/** A thing that arrives each time its key changes (a list swapped for another): it rises in; the
 * one it replaces is gone at once, so nothing is drawn twice. */
export function Arrive({ still, offstage = { y: 8 }, ms = MOTION.enter, style, children }: {
  still: boolean; offstage?: Offstage; ms?: number; style?: StyleProp<ViewStyle>; children: ReactNode;
}) {
  if (still) return <Animated.View style={style}>{children}</Animated.View>;
  const from = { opacity: offstage.opacity ?? 0, transform: [{ translateX: offstage.x ?? 0 }, { translateY: offstage.y ?? 0 }, { scale: offstage.scale ?? 1 }] };
  const to = { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
  return (
    <Animated.View style={[style, { animationName: { from, to }, animationDuration: ms, animationTimingFunction: EASE_OUT, animationFillMode: 'both' } as ViewStyle]}>
      {children}
    </Animated.View>
  );
}


/** Keep the last value a thing was shown with, so it can still be drawn while it leaves. */
export function useLast<T>(value: T | undefined | null): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (value !== undefined && value !== null) last.current = value;
  return last.current;
}
