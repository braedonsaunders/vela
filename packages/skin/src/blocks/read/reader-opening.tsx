// The book opening (web): the cover grows out of the card it was pressed on into a standing book,
// waits there for the pages if they are still coming, then swings open on its spine while the
// page beneath grows to fill the window and becomes the reader. Leaving runs it backwards: the
// page gathers into the book, the cover swings shut, and the book returns to its card. The cover
// keeps its shape throughout (one scale), drawn from the book's own cover image when that is
// sharper than the server's. Under reduced motion there is no opening; the reader is simply there.
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';
import { useHost } from '../../host';
import { useMediaLook } from '../media/parts';
import { bookFrom, bookRect, pageFill, type Rect } from './reader-origin';

/** The phases, in order. `grow`: out of the card; `wait`: standing until the pages are ready;
 * `open`: the cover swings open; `fill`: the page fills the window; `done`: the reader alone. */
export type OpeningPhase = 'grow' | 'wait' | 'open' | 'fill' | 'done';

export const OPENING_MS = { grow: 560, open: 760, fillAt: 420, fill: 460 } as const;
/** Leaving, on one timeline: the page gathers into the book, the cover swings shut, the book returns. */
export const CLOSING_MS = { gather: 220, shutAt: 80, shut: 340, returnAt: 400, return: 300 } as const;
/** The whole leaving motion, after which the route goes. */
export const CLOSING_TOTAL = CLOSING_MS.returnAt + CLOSING_MS.return;

const GROW = cubicBezier(0.2, 0, 0, 1);
const SWING = cubicBezier(0.45, 0.05, 0.2, 1);
const SETTLE = cubicBezier(0.16, 1, 0.3, 1);
const GATHER = cubicBezier(0.4, 0, 1, 1);
/** Where in the swing (a share of its time, under SWING) the cover passes edge-on: its art gives way
 * to the endpaper there. A face swap rather than backface culling, which flattened layers lose. */
const EDGE_OPENING = 0.364;
const EDGE_CLOSING = 0.36;

/** A face of the cover shown before (or after) the cover passes edge-on. */
const face = (shownFirst: boolean, edge: number, duration: number, delay = 0): ViewStyle => {
  const before = { opacity: shownFirst ? 1 : 0 }, after = { opacity: shownFirst ? 0 : 1 };
  const at = Math.round(edge * 1000) / 10;
  return { animationName: { from: before, [`${at}%`]: before, [`${Math.min(100, at + 0.5)}%`]: after, to: after }, animationDuration: duration,
    animationDelay: delay, animationTimingFunction: 'linear', animationFillMode: 'both' } as unknown as ViewStyle;
};

/** The opening's phase over time: `ready` is when the pages are drawn (or failed, or cannot be). */
export function useOpening(active: boolean, ready: boolean): OpeningPhase {
  const [phase, setPhase] = useState<OpeningPhase>(active ? 'grow' : 'done');
  useEffect(() => {
    if (phase !== 'grow') return;
    const timer = setTimeout(() => setPhase('wait'), OPENING_MS.grow);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (phase === 'wait' && ready) setPhase('open');
    if (phase === 'wait' && !ready) {
      // Pages slow to arrive: the cover opens anyway onto the waiting page.
      const timer = setTimeout(() => setPhase('open'), 2400);
      return () => clearTimeout(timer);
    }
    if (phase === 'open') {
      const timer = setTimeout(() => setPhase('fill'), OPENING_MS.fillAt);
      return () => clearTimeout(timer);
    }
    if (phase === 'fill') {
      const timer = setTimeout(() => setPhase('done'), OPENING_MS.fill);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, ready]);
  return phase;
}

/** How visible the reader itself is in each phase, and how it gets there. */
export function readerLayerStyle(opening: OpeningPhase, closing: boolean): ViewStyle {
  if (closing) return { opacity: 0, transitionProperty: ['opacity'], transitionDuration: CLOSING_MS.gather, transitionTimingFunction: GATHER } as ViewStyle;
  if (opening === 'grow' || opening === 'wait' || opening === 'open') return { opacity: 0 };
  return { opacity: 1, transitionProperty: ['opacity'], transitionDuration: OPENING_MS.fill, transitionTimingFunction: SETTLE } as ViewStyle;
}

const animate = (from: ViewStyle, to: ViewStyle, duration: number, easing: unknown, delay = 0): ViewStyle => ({
  animationName: { from, to }, animationDuration: duration, animationTimingFunction: easing, animationFillMode: 'both', animationDelay: delay,
} as unknown as ViewStyle);

export function BookOpening({ cover, sharper, title, byline, accent, origin, paper, endpaper, opening, closing }: {
  cover: string;
  /** The book's own cover (an object URL), used when it arrives. */
  sharper?: string;
  title: string;
  byline?: string;
  accent?: string;
  origin: Rect | null;
  paper: string;
  endpaper: string;
  opening: OpeningPhase;
  closing: boolean;
}) {
  const m = useMediaLook();
  const host = useHost();
  // The window at opening; a resize mid-motion must not move the book.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const viewport = useMemo(() => ({ width: m.width, height: m.height }), []);
  const book = useMemo(() => bookRect(viewport), [viewport]);
  const from = origin ? bookFrom(origin, book) : null;
  const fill = pageFill(book, viewport);
  const [failed, setFailed] = useState(false);
  const source = sharper ? { uri: sharper } : cover && !failed ? host.image(cover) : undefined;

  // One animation per element per stage, kept stable across renders (a re-render must never restart
  // a motion): each element's delay places it on the stage's timeline.
  const stage = closing ? 'closing' : opening === 'open' || opening === 'fill' ? 'opening' : opening;
  const motion = useMemo(() => {
    const placed: ViewStyle = { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }], opacity: 1 };
    const away: ViewStyle = from
      ? { transform: [{ translateX: from.x }, { translateY: from.y }, { scale: from.scale }], opacity: 1 }
      : { transform: [{ translateX: 0 }, { translateY: 16 }, { scale: 0.86 }], opacity: 0 };
    const shut = { transform: [{ perspective: 2400 }, { rotateY: '0deg' }], opacity: 1 } as ViewStyle;
    const swung = { transform: [{ perspective: 2400 }, { rotateY: '-178deg' }], opacity: 0 } as ViewStyle;
    const sheet = { transform: [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] } as ViewStyle;
    const full = { transform: [{ translateX: fill.x }, { translateY: fill.y }, { scaleX: fill.scaleX }, { scaleY: fill.scaleY }] } as ViewStyle;
    if (stage === 'closing') return {
      // The page gathers into the book, the cover swings shut over it, the book returns to its card.
      page: animate(full, sheet, CLOSING_MS.gather, GATHER),
      leaf: { animationName: { from: swung, '30%': { opacity: 1 }, to: shut }, animationDuration: CLOSING_MS.shut, animationDelay: CLOSING_MS.shutAt, animationTimingFunction: SWING, animationFillMode: 'both' } as unknown as ViewStyle,
      book: animate(placed, from ? away : { ...away, opacity: 0 }, CLOSING_MS.return, GATHER, CLOSING_MS.returnAt),
      front: face(false, EDGE_CLOSING, CLOSING_MS.shut, CLOSING_MS.shutAt),
      back: face(true, EDGE_CLOSING, CLOSING_MS.shut, CLOSING_MS.shutAt),
    };
    if (stage === 'opening') return {
      // The cover swings open on its spine, fading as it passes the reader's eye; the page beneath
      // grows to the window from part-way through the swing.
      leaf: { animationName: { from: { ...shut }, '72%': { opacity: 1 }, to: swung }, animationDuration: OPENING_MS.open, animationTimingFunction: SWING, animationFillMode: 'both' } as unknown as ViewStyle,
      page: animate(sheet, full, OPENING_MS.fill, SETTLE, OPENING_MS.fillAt),
      book: placed,
      front: face(true, EDGE_OPENING, OPENING_MS.open),
      back: face(false, EDGE_OPENING, OPENING_MS.open),
    };
    return {
      leaf: shut,
      page: sheet,
      book: stage === 'grow' ? animate(away, placed, from ? OPENING_MS.grow : 360, from ? GROW : SETTLE) : placed,
      front: { opacity: 1 } as ViewStyle,
      back: { opacity: 0 } as ViewStyle,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);
  if (opening === 'done' && !closing) return null;

  const radius = Math.max(3, Math.round(book.width / 90));
  const art = source
    ? <Image source={source} contentFit="cover" transition={sharper ? 240 : 0} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors />
    : <View style={{ flex: 1, padding: book.width / 12, justifyContent: 'space-between', backgroundColor: accent || '#2b2f36' }}>
        <Text numberOfLines={4} style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': `${Math.round(book.width / 9)}px`, color: '#f7f2e8', 'line-height': '1.1' })}>{title}</Text>
        {byline ? <Text numberOfLines={1} style={m.text({ 'font-size': `${Math.round(book.width / 18)}px`, color: '#f7f2e8cc', 'letter-spacing': '0.08em', 'text-transform': 'uppercase' })}>{byline}</Text> : null}
      </View>;
  return (
    // Beneath the reader (drawn first): the reader dissolves in over the page as it fills the window.
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} testID="reader-opening" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ position: 'absolute', left: book.x, top: book.y, width: book.width, height: book.height }, motion.book]} testID="reader-opening-book">
        {/* The first page, under the cover. */}
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: paper, borderRadius: radius },
          m.box({ 'box-shadow': '0px 30px 60px -20px rgba(0, 0, 0, 0.55), 0px 2px 8px rgba(0, 0, 0, 0.2)' }), motion.page]} />
        {/* The cover, hinged at its spine: art on the front, the endpaper on the back. */}
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, transformOrigin: 'left center' } as ViewStyle, motion.leaf]} testID="reader-opening-cover">
          <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, overflow: 'hidden' },
            m.box({ 'box-shadow': '0px 30px 60px -20px rgba(0, 0, 0, 0.6), 0px 2px 8px rgba(0, 0, 0, 0.25)' }), motion.front]}>
            {art}
            <View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: Math.max(8, book.width * 0.06) },
              m.box({ 'background-image': 'linear-gradient(90deg, rgba(0, 0, 0, 0.36) 0%, rgba(255, 255, 255, 0.22) 30%, rgba(0, 0, 0, 0.16) 60%, rgba(0, 0, 0, 0) 100%)' })]} />
          </Animated.View>
          {/* The endpaper: the cover's inside, seen once it passes edge-on. */}
          <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, backgroundColor: endpaper }, motion.back]} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
