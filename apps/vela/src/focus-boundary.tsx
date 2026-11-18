import { useEffect, useRef, type ComponentProps, type ComponentType, type Ref } from 'react';
import { Platform, TVFocusGuideView, View, type ViewProps } from 'react-native';

type Focusable = { requestTVFocus(): void };
// RN's generated TV guide declarations omit the ref that its implementation forwards.
const NativeFocusGuide = TVFocusGuideView as ComponentType<ComponentProps<typeof TVFocusGuideView> & { ref?: Ref<Focusable> }>;

type Props = Omit<ViewProps, 'safePadding'> & {
  active: boolean;
  enterWhenReady?: boolean;
  /** Android TV: the boundary is a guide that is entered (a page or modal). Off, Android keeps a plain view. */
  entered?: boolean;
};

/** pointerEvents only gates touch: a covered route must also leave the TV focus engine. On tvOS a
 * plain view stays focusable whatever its pointerEvents (react-native-tvos answers YES to
 * isUserInteractionEnabled for any view but a focus guide), so a covered home or title page kept
 * the remote's presses under the page or player above it. A focus guide that is not focusable takes
 * its whole subtree out; an active route is a plain view again, so its own focus requests stand. */
export function FocusBoundary({ active, enterWhenReady = false, entered: guided = true, ...props }: Props) {
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
  if (!Platform.isTV) return <View {...common} />;
  if (Platform.OS === 'android') {
    return guided ? <NativeFocusGuide ref={guide} autoFocus {...common} focusable={active} /> : <View {...common} />;
  }
  return <NativeFocusGuide {...common} focusable={active ? undefined : false} />;
}
