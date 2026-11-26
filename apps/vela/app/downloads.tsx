import { isPlayableDownload } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

export default function Downloads() {
  const { items, supported } = useVelaState(state => state.downloads);
  const offline = useVelaState(state => state.auth.phase === 'offline');
  const playable = items.filter(isPlayableDownload);
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace(offline ? '/sign-in' : '/');
      }}><Text style={styles.action}>Back</Text></Pressable>
      <Text accessibilityRole="header" style={styles.heading}>Downloads</Text>
      {!supported || !playable.length ? <Text style={styles.text}>No downloaded titles</Text> : null}
      {playable.map(item => (
        <Pressable
          key={item.titleId}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/watch/[id]', params: { id: item.titleId } })}
          style={styles.row}
        >
          <Text style={styles.text}>{item.title.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#13161c' },
  content: { padding: 24, gap: 16 },
  heading: { color: '#fff', fontSize: 32, fontWeight: '700' },
  text: { color: '#fff', fontSize: 17 },
  action: { color: '#b6d6ff', fontSize: 17, paddingVertical: 10 },
  row: { backgroundColor: '#222831', padding: 16, borderRadius: 12 },
});
