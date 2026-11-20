import { router, useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import { backFromNavigation, useBackHeld } from '@vela/skin/src/menu-key';
import { DocumentScreen } from '../../src/screen';
import { useVela } from '../../src/vela';

export default function Title() {
  const { id, library } = useLocalSearchParams<{ id: string; library?: string }>();
  const { openTitle } = useVela();
  // tvOS Menu also reaches the native stack. Close an open description/menu first.
  usePreventRemove(useBackHeld(), backFromNavigation);
  useEffect(() => (id ? openTitle(id) : undefined), [id, openTitle]);
  useFocusEffect(useCallback(() => {
    const back = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
    if (Platform.OS !== 'web') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
      return () => subscription.remove();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); back(); }
    };
    // A click on the dimmed page around the frame closes it, like Escape. Sheets and menus the
    // page opens are drawn outside the route (portals), so clicks in them never count as outside.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented || !(event.target instanceof Element)) return;
      if (event.target.closest('[data-testid="detail-route"]') && !event.target.closest('[data-testid="detail-frame"]')) back();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', onClick); };
  }, []));
  return <DocumentScreen route="title" entry={id ?? ''} library={library} />;
}
