import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useVela, useVelaState } from '@vela/core/react';
import type { Card } from '@vela/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A server person and their library's filmography. Ether falls back to catalogue name search. */
export default function PersonPage() {
  const { title = '', name = '', library = '' } = useLocalSearchParams<{ title: string; name: string; library?: string }>();
  const store = useVela();
  const detail = useVelaState(state => state.titles[title]);
  const person = detail?.value?.castPeople.find(p => p.name === name);
  const [items, setItems] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [fallback, setFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const insets = useSafeAreaInsets();
  const load = useCallback(async (next?: string) => {
    setLoading(true); setFailed(false);
    try {
      const result = await store.catalogue.personTitles(person?.id, name, library || undefined, next);
      setItems(previous => next ? [...previous, ...result.items] : result.items);
      setCursor(result.cursor); setFallback(result.fallback);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [store, person?.id, name, library]);
  useEffect(() => { if (title && !detail) void store.catalogue.title(title); }, [store, title, detail]);
  useEffect(() => { if (detail?.value || detail?.load === 'failed' || !title) void load(); }, [load, detail?.value, detail?.load, title]);
  return <ScrollView style={{ flex: 1, backgroundColor: '#101218' }} contentContainerStyle={{ paddingTop: insets.top + 22, paddingHorizontal: 24, paddingBottom: insets.bottom + 48, gap: 24 }}>
    <FocusButton label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
      {person?.portrait ? <Image source={{ uri: person.portrait }} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#323843', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: 'white', fontSize: 30 }}>{name.slice(0, 1)}</Text></View>}
      <Text style={{ color: 'white', fontSize: 30, fontWeight: '700', flexShrink: 1 }}>{name}</Text>
    </View>
    <Text style={{ color: '#c7cbd3', fontSize: 18, fontWeight: '600' }}>{fallback ? 'Search results' : 'Filmography'}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      {items.map(card => <FocusButton key={`${card.kind}:${card.id}`} label={card.name} image={card.poster} onPress={() => router.push({ pathname: '/title/[id]', params: { id: card.id, library } })} />)}
    </View>
    {loading ? <ActivityIndicator color="white" /> : failed ? <FocusButton label="Try again" onPress={() => void load(cursor)} /> : !items.length ? <Text style={{ color: '#c7cbd3' }}>No titles found.</Text> : cursor ? <FocusButton label="Show more" onPress={() => void load(cursor)} /> : null}
  </ScrollView>;
}

function FocusButton({ label, image, onPress }: { label: string; image?: string; onPress(): void }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={{ alignSelf: 'flex-start', width: image ? 140 : undefined, padding: 6, borderRadius: 8, borderWidth: 3, borderColor: focused ? '#fff' : 'transparent' }}>
    {image ? <Image source={{ uri: image }} style={{ width: 122, height: 183, borderRadius: 5, backgroundColor: '#323843' }} /> : null}
    <Text style={{ color: 'white', fontSize: 16, marginTop: image ? 8 : 0 }}>{label}</Text>
  </Pressable>;
}
