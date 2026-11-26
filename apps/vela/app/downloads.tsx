import { formatDownloadBytes, isPlayableDownload, type DownloadRecord } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { resolveUi } from '@vela/skin/src/resolve/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVela as useApp } from '../src/vela';

const transferStatus: Record<DownloadRecord['status'], string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Available offline',
  failed: 'Download failed',
};

export default function Downloads() {
  const store = useVela();
  const { doc } = useApp();
  const ui = resolveUi(doc?.document.ui);
  const { items, usedBytes, hydrated, error } = useVelaState(state => state.downloads);
  const online = useVelaState(state => state.auth.phase === 'signed-in');
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState('');
  const perform = async (id: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(id);
    setFailure('');
    store.downloads.clearError();
    try { await action(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not update download'); }
    finally { setBusy(undefined); }
  };
  const remove = (item: DownloadRecord) => Alert.alert(
    'Delete download?',
    item.title.name,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void perform(item.titleId, () => store.downloads.remove(item.titleId)) },
    ],
  );
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: ui.control, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
      <Text style={[styles.actionText, { color: ui.ink }]}>{label}</Text>
    </Pressable>
  );
  return (
    <SafeAreaView style={[styles.page, { backgroundColor: ui.page }]}>
      <ScrollView contentContainerStyle={styles.content} testID="downloads-screen">
        <View style={styles.header}>
          {button('Back', () => {
            if (router.canGoBack()) router.back();
            else router.replace(online ? '/' : '/sign-in');
          })}
          <Text accessibilityRole="header" style={[styles.heading, { color: ui.ink }]}>Downloads</Text>
          {hydrated ? <Text style={[styles.secondary, { color: ui.inkSecondary }]}>{formatDownloadBytes(usedBytes)} used on this device</Text> : null}
        </View>
        {failure || error ? <Text accessibilityRole="alert" style={[styles.secondary, { color: ui.ink }]}>{failure || error}</Text> : null}
        {!items.length ? <Text style={[styles.secondary, { color: ui.inkSecondary }]}>{hydrated ? 'No downloaded titles' : 'Loading downloads…'}</Text> : null}
        {items.map(item => {
          const { title, titleId, status, bytesWritten, byteLength } = item;
          const playable = isPlayableDownload(item);
          const percent = byteLength && byteLength > 0 ? Math.min(100, Math.round(100 * bytesWritten / byteLength)) : undefined;
          const subtitle = [title.showName, item.versionLabel].filter(Boolean).join(' · ');
          return (
            <View key={titleId} style={[styles.row, { backgroundColor: ui.control }]} testID={`download-${titleId}`}>
              <Text accessibilityRole="header" style={[styles.title, { color: ui.ink }]}>{title.name}</Text>
              {subtitle ? <Text style={[styles.secondary, { color: ui.inkSecondary }]}>{subtitle}</Text> : null}
              <Text style={[styles.secondary, { color: ui.inkSecondary }]}>
                {transferStatus[status]} · {formatDownloadBytes(bytesWritten)}
                {status !== 'completed' && percent !== undefined ? ` of ${formatDownloadBytes(byteLength!)} · ${percent}%` : ''}
              </Text>
              {status === 'downloading' && percent !== undefined ? (
                <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}
                  style={[styles.track, { backgroundColor: ui.page }]}>
                  <View style={{ width: `${percent}%`, height: '100%', backgroundColor: ui.accent }} />
                </View>
              ) : null}
              {item.error ? <Text style={[styles.secondary, { color: ui.ink }]}>{item.error}</Text> : null}
              <View style={styles.actions}>
                {playable ? button('Play', () => router.push({ pathname: '/watch/[id]', params: { id: titleId } }), busy === titleId) : null}
                {status === 'queued' || status === 'downloading' ? button('Pause', () => void perform(titleId, () => store.downloads.pause(titleId)), !!busy) : null}
                {online && (status === 'paused' || status === 'failed') ? button(status === 'paused' ? 'Resume' : 'Retry', () => void perform(titleId, () => store.downloads.resume(titleId)), !!busy) : null}
                {button('Delete', () => remove(item), !!busy)}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { width: '100%', maxWidth: 800, alignSelf: 'center', padding: 24, gap: 16 },
  header: { alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  heading: { fontSize: 32, fontWeight: '700' },
  title: { fontSize: 19, fontWeight: '600' },
  secondary: { fontSize: 15 },
  action: { borderRadius: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  actionText: { fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { padding: 16, borderRadius: 12, gap: 8 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
