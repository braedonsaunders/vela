import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import { DocumentScreen } from '../../src/screen';
import { useVela } from '../../src/vela';

export default function Title() {
  const { id, library } = useLocalSearchParams<{ id: string; library?: string }>();
  const { openTitle } = useVela();
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []));
  return <DocumentScreen route="title" entry={id ?? ''} library={library} />;
}
