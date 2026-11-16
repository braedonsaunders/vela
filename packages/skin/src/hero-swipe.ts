import { useRef } from 'react';
import { Platform, type GestureResponderEvent } from 'react-native';
import { heroSwipe } from './hero-swipe-logic';

/** Touch-only: leave mouse hover, keyboard and TV focus to their existing handlers. */
export function useHeroSwipe(enabled: boolean, count: number, index: number, dispatch: (action: 'pickHero', arg: string) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const consumed = useRef(false);
  if (!enabled || Platform.OS !== 'web' || count < 2) return undefined;
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
