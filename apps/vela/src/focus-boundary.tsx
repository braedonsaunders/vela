import { useEffect, useRef, type ComponentProps, type ComponentType, type Ref } from 'react';
import { Platform, TVFocusGuideView, View, type ViewProps } from 'react-native';

type Focusable = { requestTVFocus(): void };
// RN's generated TV guide declarations omit the ref that its implementation forwards.
const NativeFocusGuide = TVFocusGuideView as ComponentType<ComponentProps<typeof TVFocusGuideView> & { ref?: Ref<Focusable> }>;

type Props = Omit<ViewProps, 'safePadding'> & { active: boolean; enterWhenReady?: boolean };

/** pointerEvents only gates touch. Covered Android routes must also block native focus. */
export function FocusBoundary({ active, enterWhenReady = false, ...props }: Props) {
  const guide = useRef<Focusable>(null);
  const entered = useRef(false);
  useEffect(() => {
    if (!Platform.isTV || Platform.OS !== 'android' || !active || !enterWhenReady || entered.current) return;
    // A slow catalogue response can outlive the skin's opening-focus window. Blocking the
    // covered route does not clear its already focused child; explicitly enter the new guide.
    // Do this once: Back must restore the opener, rather than restarting at the first control.
    const frame = requestAnimationFrame(() => {
      entered.current = true;
      guide.current?.requestTVFocus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, enterWhenReady]);
  const common = { ...props, pointerEvents: active ? 'auto' as const : 'none' as const };
  return Platform.isTV && Platform.OS === 'android'
    ? <NativeFocusGuide ref={guide} autoFocus {...common} focusable={active} />
    : <View {...common} />;
}
