import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '@vela/skin/src/focus';
import { DismissScope } from '@vela/skin/src/escape';
import { SheetModal } from '@vela/skin/src/widgets/common/sheet-modal';

/** The single app-owned sheet opened by the shared title and card action definitions. */
/** `open`: it stays drawn while it leaves, then the app lets it go. */
export function AddToPlaylist({ titleId, titleKind, open, close }: { titleId: string; titleKind?: string; open: boolean; close(): void }) {
  const store = useVela();
  const memberships = useVelaState(state => state.playlists.memberships[titleId]);
  const notice = useVelaState(state => state.playlists.notice);
  const available = useVelaState(state => state.home.value?.playlistsAvailable === true);
  const [name, setName] = useState('');
  const first = useRef<ComponentRef<typeof Pressable> | null>(null);
  useEffect(() => { void Promise.all([store.playlists.load(), store.playlists.memberships(titleId, true)]); }, [store, titleId]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => (first.current as unknown as { focus?(): void; requestTVFocus?(): void } | null)?.focus?.());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (!available) return null;
  const dismiss = () => { store.playlists.clearNotice(); close(); };
  return <DismissScope open={open} dismiss={dismiss}>
    <SheetModal open={open} scrim={SCRIM} onRequestClose={dismiss}>
      <View style={styles.scrim} accessibilityViewIsModal>
        <Pressable accessible={false} focusable={false} onPress={dismiss} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.title}>Add to playlist</Text>
            {titleKind === 'show' || titleKind === 'season' ? <Text style={styles.hint}>All episodes will be added.</Text> : null}</View>
            <Pressable ref={first} accessibilityRole="button" accessibilityLabel="Close" onPress={dismiss} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          {notice ? <Text accessibilityRole="alert" style={styles.error}>{notice}</Text> : null}
          {memberships?.load === 'loading' && !memberships.value ? <Text style={styles.muted}>Loading playlists…</Text> : null}
          {memberships?.load === 'failed' && !memberships.value ? <Pressable accessibilityRole="button" onPress={() => void store.playlists.memberships(titleId, true)} style={styles.retry}><Text style={styles.buttonText}>Try again</Text></Pressable> : null}
          <ScrollView style={styles.list} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {(memberships?.value ?? []).map(item => {
              const checked = item.entryIds.length > 0;
              return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: item.smart }} disabled={item.smart}
                onPress={() => void store.playlists.setMembership(titleId, item.id, !checked)} style={[styles.row, item.smart && styles.disabled]}>
                <Text style={styles.check}>{checked ? '✓' : ''}</Text><Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
                {item.smart ? <Text style={styles.smart}>SMART · READ ONLY</Text> : null}
              </Pressable>;
            })}
          </ScrollView>
          <View style={styles.newRow}>
            <TextInput testID="new-playlist-name" accessibilityLabel="New playlist name" value={name} onChangeText={setName}
              placeholder="New playlist name" placeholderTextColor="#8f939c" returnKeyType="done" onSubmitEditing={() => {
                const next = name; setName(''); void store.playlists.create(next, titleId);
              }} style={styles.input} />
            <Pressable accessibilityRole="button" testID="create-playlist" disabled={!name.trim()} onPress={() => { const next = name; setName(''); void store.playlists.create(next, titleId); }} style={[styles.create, !name.trim() && styles.disabled]}><Text style={styles.buttonText}>Create</Text></Pressable>
          </View>
        </View>
      </View>
    </SheetModal>
  </DismissScope>;
}

const SCRIM = 'rgba(3,5,8,.72)';
const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: Platform.isTV ? 'center' : 'flex-end', padding: 20 },
  sheet: { width: '100%', maxWidth: 600, maxHeight: '82%', backgroundColor: '#171a20', borderColor: '#353943', borderWidth: 1, borderRadius: 24, padding: 22, gap: 14, boxShadow: '0 30px 90px rgba(0,0,0,.6)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 }, title: { color: '#f6f1e8', fontSize: 25, fontWeight: '700' },
  hint: { color: '#b7bbc4', marginTop: 5, fontSize: 14 }, close: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#282c34', alignItems: 'center', justifyContent: 'center' }, closeText: { color: '#fff', fontSize: 26 },
  list: { minHeight: 90, maxHeight: 360 }, row: { minHeight: 54, borderRadius: 14, paddingHorizontal: 14, backgroundColor: '#22262e', flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { width: 22, height: 22, borderWidth: 1, borderColor: '#777e8c', borderRadius: 6, color: '#17191d', backgroundColor: '#d4a977', textAlign: 'center', lineHeight: 20, fontWeight: '900' }, rowName: { color: '#f7f3ec', fontSize: 16, flex: 1 }, smart: { color: '#aeb3bf', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  newRow: { flexDirection: 'row', gap: 10 }, input: { flex: 1, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: '#454b57', color: '#fff', paddingHorizontal: 14, fontSize: 16 }, create: { minWidth: 94, borderRadius: 13, backgroundColor: '#9f653f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { color: '#fff', fontWeight: '700' }, disabled: { opacity: .48 }, muted: { color: '#b7bbc4' }, error: { color: '#ffd0c9', backgroundColor: '#512a2a', borderRadius: 10, padding: 10 }, retry: { alignSelf: 'flex-start', backgroundColor: '#824f35', padding: 12, borderRadius: 10 },
});
