import { Platform, TVFocusGuideView, View, type ViewProps } from 'react-native';

/** Android's pointerEvents only gates touch. A covered route must also block native
 * descendant focus, or the D-pad can operate the shell and catalogue behind its modal. */
export function FocusBoundary({ active, ...props }: Omit<ViewProps, 'safePadding'> & { active: boolean }) {
  const common = { ...props, pointerEvents: active ? 'auto' as const : 'none' as const };
  return Platform.isTV && Platform.OS === 'android'
    ? <TVFocusGuideView autoFocus {...common} focusable={active} />
    : <View {...common} />;
}
