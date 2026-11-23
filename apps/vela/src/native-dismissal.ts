// tvOS can dismiss a containedModal screen in UIKit (a keyboard Escape, or a Menu press the screen
// did not claim) without React Navigation removing its route: the screen stays mounted, unseen,
// and the navigator still counts it as on top. The route's closing transition says it went; when
// that transition ends with the route still focused, the navigator catches up. A route React
// removed itself is no longer focused by then. Multiview handles its own (app/multiview.tsx).
import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

export function useNativeDismissal(): void {
  const navigation = useNavigation();
  useEffect(() => {
    const listen = navigation.addListener as (event: string, listener: (event: { data?: { closing?: boolean } }) => void) => () => void;
    return listen('transitionEnd', event => {
      if (event.data?.closing && navigation.isFocused() && navigation.canGoBack()) navigation.goBack();
    });
  }, [navigation]);
}
