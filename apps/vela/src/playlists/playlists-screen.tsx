import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '@vela/skin/src/focus';
import { useVela } from '../vela';
import { openCollection } from '../browse/open';
import { useReducedMotion } from 'react-native-reanimated';
import { Arrive } from '@vela/skin/src/presence';

export function PlaylistsScreen() {
  const { store } = useVela();
  const list = useVelaState(state => state.playlists.list);
  const available = useVelaState(state => state.home.value?.playlistsAvailable === true);
  const notice = useVelaState(state => state.playlists.notice);
  const still = useReducedMotion();
  const [name, setName] = useState('');
  useEffect(() => { if (available) void store.playlists.load(); }, [available, store]);
  if (!available) return <View style={styles.page}><Text style={styles.title}>Playlists aren’t available on this server.</Text><Pressable onPress={() => router.back()} style={styles.button}><Text style={styles.buttonText}>Back</Text></Pressable></View>;
  return <View style={styles.page}>
    <View style={styles.top}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.round}><Text style={styles.roundText}>‹</Text></Pressable>
      <View style={{ flex: 1 }}><Text style={styles.eyebrow}>YOUR LIBRARY</Text><Text style={styles.title}>Playlists</Text></View>
      <TextInput accessibilityLabel="New playlist name" value={name} onChangeText={setName} placeholder="New playlist" placeholderTextColor="#878d98" style={styles.input}
        onSubmitEditing={() => { const value = name; setName(''); void store.playlists.create(value); }} />
      <Pressable accessibilityRole="button" disabled={!name.trim()} onPress={() => { const value = name; setName(''); void store.playlists.create(value); }} style={[styles.button, !name.trim() && { opacity: .45 }]}><Text style={styles.buttonText}>New</Text></Pressable>
    </View>
    {notice ? <Arrive key={notice} still={still}><Text accessibilityRole="alert" style={styles.error}>{notice}</Text></Arrive> : null}
    {list.load === 'loading' && !list.value ? <ActivityIndicator color="#d5a676" size="large" /> : null}
    {list.load === 'failed' && !list.value ? <Pressable onPress={() => void store.playlists.load()} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable> : null}
    <FlatList data={list.value ?? []} keyExtractor={item => item.id} numColumns={3} contentContainerStyle={styles.grid} columnWrapperStyle={styles.columns}
      ListEmptyComponent={list.load === 'ready' ? <Text style={styles.empty}>Create a playlist to collect films and episodes.</Text> : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => openCollection(item.id, 'playlist')} style={styles.card}>
        <View style={styles.art}>{item.poster ? <Image source={{ uri: item.poster }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Text style={styles.placeholder}>♫</Text>}
          {item.smart ? <Text style={styles.badge}>SMART</Text> : null}</View>
        <Text numberOfLines={1} style={styles.cardName}>{item.name}</Text><Text style={styles.count}>{item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}</Text>
      </Pressable>} />
  </View>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#0d0f13', paddingHorizontal: 30, paddingTop: 30 }, top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 }, eyebrow: { color: '#b9865f', fontSize: 10, fontWeight: '800', letterSpacing: 2 }, title: { color: '#f5f0e8', fontSize: 34, fontWeight: '700' },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#242830', alignItems: 'center', justifyContent: 'center' }, roundText: { color: '#fff', fontSize: 36, lineHeight: 38 }, input: { width: 210, height: 46, borderWidth: 1, borderColor: '#3d424d', borderRadius: 13, color: '#fff', paddingHorizontal: 14 }, button: { alignSelf: 'center', minHeight: 44, backgroundColor: '#915b3b', borderRadius: 12, justifyContent: 'center', paddingHorizontal: 18 }, buttonText: { color: '#fff', fontWeight: '700' },
  grid: { paddingBottom: 40 }, columns: { gap: 20 }, card: { flex: 1, maxWidth: 280, minWidth: 160, marginBottom: 26 }, art: { aspectRatio: 2 / 3, borderRadius: 16, overflow: 'hidden', backgroundColor: '#252a33', alignItems: 'center', justifyContent: 'center' }, placeholder: { color: '#c6956d', fontSize: 45 }, badge: { position: 'absolute', right: 9, top: 9, color: '#fff', fontWeight: '800', fontSize: 9, letterSpacing: 1, backgroundColor: 'rgba(20,22,28,.85)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 }, cardName: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 10 }, count: { color: '#aeb3bd', marginTop: 3 }, empty: { color: '#aeb3bd', fontSize: 17, marginTop: 50 }, error: { color: '#ffd0c9', backgroundColor: '#512a2a', padding: 10, borderRadius: 10, marginBottom: 16 } });
