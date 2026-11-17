import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useVela, useVelaState } from '@vela/core/react';
import type { Card } from '@vela/core';
import type { SkinHost } from '@vela/skin';
import { DocumentScreen } from '../src/screen';

/** A person's server-provided filmography, drawn by the active skin. */
export default function PersonPage() {
  const { title = '', name = '', library = '' } = useLocalSearchParams<{ title: string; name: string; library?: string }>();
  const store = useVela();
  const detail = useVelaState(state => state.titles[title]);
  const person = detail?.value?.castPeople.find(p => p.name === name);
  const [items, setItems] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async (next?: string) => {
    if (!person?.canOpen) { setLoading(false); setFailed(true); return; }
    setLoading(true); setFailed(false);
    try {
      const result = await store.catalogue.personTitles(person.id, library || undefined, next);
      setItems(previous => next ? [...previous, ...result.items] : result.items);
      setCursor(result.cursor);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [store, person?.id, person?.canOpen, name, library]);
  useEffect(() => { if (title && !detail) void store.catalogue.title(title); }, [store, title, detail]);
  useEffect(() => { if (detail?.value || detail?.load === 'failed' || !title) void load(); }, [load, detail?.value, detail?.load, title]);
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
  const page = useCallback((host: SkinHost): SkinHost => ({
    ...host,
    env: { ...host.env, load: failed ? 'failed' : loading && !items.length ? 'loading' : 'ready',
      personPage: { name, portrait: person?.portrait ?? '', role: person?.role ?? '', items, more: !!cursor, loading } },
    dispatch: (action, arg) => {
      if (action === 'personMore') { if (cursor && !loading) void load(cursor); }
      else if (action === 'retry') void load();
      else host.dispatch(action, arg);
    },
  }), [name, person?.portrait, person?.role, items, cursor, loading, failed, load]);
  return <DocumentScreen route="person" entry={title} library={library} page={page} />;
}
