import { useMemo, useRef } from 'react';
import { PanResponder, Platform, type GestureResponderEvent } from 'react-native';
import { heroSwipe } from './hero-swipe-logic';

/** Touch-only: leave mouse hover, keyboard and TV focus to their existing handlers. */
export function useHeroSwipe(enabled: boolean, count: number, index: number, dispatch: (action: 'pickHero', arg: string) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const consumed = useRef(false);
  const latest = useRef({ count, index, dispatch });
  latest.current = { count, index, dispatch };
  const captured = useRef({ dx: 0, dy: 0 });
  const native = useMemo(() => PanResponder.create({
    // Claim only a deliberate horizontal drag. Taps reach hero buttons and vertical drags
    // remain with the page ScrollView. Capture cancels an already pressed child button.
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      const claim = gesture.numberActiveTouches === 1 && heroSwipe(gesture.dx, gesture.dy, 0, 2) !== null;
      if (claim) captured.current = { dx: gesture.dx, dy: gesture.dy };
      return claim;
    },
    onPanResponderRelease: (_event, gesture) => {
      const { count, index, dispatch } = latest.current;
      // PanResponder resets dx/dy when it grants capture; retain the opening drag.
      const next = heroSwipe(captured.current.dx + gesture.dx, captured.current.dy + gesture.dy, index, count);
      if (next !== null) dispatch('pickHero', String(next));
    },
  }), []);
  if (!enabled || Platform.isTV || count < 2) return undefined;
  if (Platform.OS !== 'web') return native.panHandlers;
  return {
    onTouchStart(event: GestureResponderEvent) {
      consumed.current = false;
      const touches = event.nativeEvent.touches;
      start.current = touches.length === 1 ? { x: touches[0].pageX, y: touches[0].pageY } : null;
    },
    onTouchMove(event: GestureResponderEvent) {
      const touches = event.nativeEvent.touches;
      if (touches.length !== 1) { start.current = null; return; }
      if (!start.current) return;
      const dx = touches[0].pageX - start.current.x;
      const dy = touches[0].pageY - start.current.y;
      // Once a vertical scroll wins, it cannot turn into a carousel gesture.
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) start.current = null;
    },
    onTouchEnd(event: GestureResponderEvent) {
      const origin = start.current;
      start.current = null;
      const end = event.nativeEvent.changedTouches[0];
      if (!origin || !end) return;
      const next = heroSwipe(end.pageX - origin.x, end.pageY - origin.y, index, count);
      if (next === null) return;
      consumed.current = true;
      dispatch('pickHero', String(next));
    },
    onTouchCancel() { start.current = null; },
    onClickCapture(event: { preventDefault(): void; stopPropagation(): void }) {
      if (consumed.current) { event.preventDefault(); event.stopPropagation(); consumed.current = false; }
    },
  };
}
