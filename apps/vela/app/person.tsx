import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useVela, useVelaState } from '@vela/core/react';
import type { Card } from '@vela/core';
import type { SkinHost } from '@vela/skin';
import { DocumentScreen } from '../src/screen';

/** A person's server-provided filmography, drawn by the active skin. */
export default function PersonPage() {
  const { id = '', title = '', name = '', library = '' } = useLocalSearchParams<{ id?: string; title: string; name: string; library?: string }>();
  const store = useVela();
  const detail = useVelaState(state => state.titles[title]);
  const castPerson = detail?.value?.castPeople.find(p => p.name === name);
  const person = id ? { id, name, canOpen: true, portrait: '', role: '' } : castPerson;
  const [items, setItems] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [profile, setProfile] = useState<{ name: string; portrait: string; knownFor: string; biography: string; birthday: string }>();
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
  useEffect(() => {
    if (!person?.canOpen || !person.id) return;
    let active = true;
    void store.catalogue.personDetails(person.id).then(value => { if (active) setProfile(value); }).catch(() => {});
    return () => { active = false; };
  }, [store, person?.id, person?.canOpen]);
  useFocusEffect(useCallback(() => {
    const back = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
    if (Platform.OS !== 'web') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
      return () => subscription.remove();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); back(); }
      if (event.key === 'ArrowDown' && !event.defaultPrevented) {
        const current = document.activeElement as HTMLElement | null;
        const id = current?.getAttribute('data-testid');
        if (id !== 'detail-close' && id !== 'detail-summary-more') return;
        const visible = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element => !element.closest('[aria-hidden="true"]') && element.getBoundingClientRect().height > 0);
        const next = id === 'detail-close' ? visible('[data-testid="detail-summary-more"]') ?? visible('[data-testid^="title-"]') : visible('[data-testid^="title-"]');
        if (next) { event.preventDefault(); next.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []));
  const page = useCallback((host: SkinHost): SkinHost => ({
    ...host,
    env: { ...host.env, load: failed ? 'failed' : loading && !items.length ? 'loading' : 'ready',
      personPage: { name: profile?.name ?? name, portrait: profile?.portrait || person?.portrait || '', role: profile?.knownFor || person?.role || '', biography: profile?.biography ?? '', birthday: profile?.birthday ?? '', items, more: !!cursor, loading } },
    dispatch: (action, arg) => {
      if (action === 'personMore') { if (cursor && !loading) void load(cursor); }
      else if (action === 'retry') void load();
      else host.dispatch(action, arg);
    },
  }), [name, person?.portrait, person?.role, profile, items, cursor, loading, failed, load]);
  return <DocumentScreen route="person" entry={title} library={library} page={page} />;
}
