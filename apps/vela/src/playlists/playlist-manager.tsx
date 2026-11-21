import { createElement, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '@vela/skin/src/focus';
import { SheetModal } from '@vela/skin/src/widgets/common/sheet-modal';
import { useVela } from '../vela';

const DraggableRow = View as unknown as (props: Record<string, unknown>) => React.JSX.Element;

export function PlaylistManager({ playlistId }: { playlistId: string }) {
  const { store } = useVela();
  const model = useVelaState(state => state.collections[playlistId]?.value);
  const notice = useVelaState(state => state.playlists.notice);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState('');
  const [confirming, setConfirming] = useState(false);
  const touchDragging = useRef('');
  const webDragging = useRef('');
  const rows = useRef(new Map<string, ComponentRef<typeof View>>());
  if (model?.kind !== 'playlist') return null;
  const close = () => { setOpen(false); store.playlists.clearNotice(); };
  const move = (entryId: string, direction: -1 | 1) => {
    const index = model.items.findIndex(item => item.entryId === entryId); if (index < 0) return;
    const after = direction < 0 ? (index <= 1 ? null : model.items[index - 2]?.entryId ?? null) : model.items[index + 1]?.entryId;
    if (direction > 0 && !after) return;
    void store.playlists.moveEntry(playlistId, entryId, after ?? null);
  };
  const dropBefore = (targetId: string, movingId = dragging) => {
    if (!movingId || movingId === targetId) return;
    const without = model.items.filter(item => item.entryId !== movingId);
    const target = without.findIndex(item => item.entryId === targetId);
    void store.playlists.moveEntry(playlistId, movingId, target <= 0 ? null : without[target - 1]?.entryId ?? null); setDragging('');
  };
  const finishTouchDrag = (movingId: string, pageY: number) => {
    const candidates = model.items.flatMap(item => item.entryId ? [item.entryId] : []);
    let pending = candidates.length, target = '';
    if (!pending) return;
    for (const entryId of candidates) rows.current.get(entryId)?.measureInWindow((_x, y, _width, height) => {
      if (pageY >= y && pageY <= y + height) target = entryId;
      if (--pending === 0) { if (target) dropBefore(target, movingId); else setDragging(''); }
    });
  };
  return <>
    <Pressable testID="manage-playlist" accessibilityRole="button" onPress={() => { setName(model.name); setOpen(true); }} style={styles.entry}><Text style={styles.entryText}>{model.smart ? 'Smart playlist' : 'Manage playlist'}</Text></Pressable>
    <SheetModal open={open} scrim={SCRIM} onRequestClose={close}>
      <View style={styles.scrim} accessibilityViewIsModal><Pressable accessible={false} focusable={false} onPress={close} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.title}>{model.name}</Text><Text style={styles.sub}>{model.items.length} entries{model.smart ? ' · Smart playlist · Read only' : ''}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={styles.icon}><Text style={styles.iconText}>×</Text></Pressable></View>
          {notice ? <Text accessibilityRole="alert" style={styles.error}>{notice}</Text> : null}
          {!model.smart ? <View style={styles.rename}><TextInput accessibilityLabel="Playlist name" value={name} onChangeText={setName} style={styles.input} />
            <Pressable accessibilityRole="button" disabled={!name.trim() || name.trim() === model.name} onPress={() => void store.playlists.rename(playlistId, name)} style={styles.save}><Text style={styles.buttonText}>Rename</Text></Pressable></View> : null}
          <ScrollView style={styles.list} contentContainerStyle={{ gap: 7 }}>
            {model.items.map((item, index) => {
              return <DraggableRow key={item.entryId ?? item.id} ref={(value: ComponentRef<typeof View> | null) => { if (item.entryId && value) rows.current.set(item.entryId, value); }} style={[styles.row, dragging === item.entryId && styles.dragging]}>
              {!model.smart ? Platform.OS === 'web'
                ? createElement('div', {
                    draggable: true, 'aria-label': `Reorder ${item.name}`,
                    onDragStart: () => { webDragging.current = item.entryId ?? ''; setDragging(item.entryId ?? ''); },
                    onDragOver: (event: DragEvent) => event.preventDefault(),
                    onDrop: () => { dropBefore(item.entryId ?? '', webDragging.current); webDragging.current = ''; },
                    onDragEnd: () => { webDragging.current = ''; setDragging(''); },
                    style: { cursor: 'grab', userSelect: 'none' },
                  }, <Text style={styles.grip}>⠿</Text>)
                : <Pressable accessibilityRole="button" accessibilityLabel={`Reorder ${item.name}`} delayLongPress={250}
                    onLongPress={() => { touchDragging.current = item.entryId ?? ''; setDragging(item.entryId ?? ''); }}
                    onPressOut={(event) => { const movingId = touchDragging.current; touchDragging.current = ''; if (movingId) finishTouchDrag(movingId, event.nativeEvent.pageY); }}><Text style={styles.grip}>⠿</Text></Pressable>
              : null}<View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.episodeContext || item.facts}</Text></View>
              {!model.smart ? <><Pressable accessibilityRole="button" accessibilityLabel={`Move ${item.name} up`} disabled={index === 0} onPress={() => move(item.entryId!, -1)} style={[styles.small, index === 0 && styles.disabled]}><Text style={styles.smallText}>↑</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Move ${item.name} down`} disabled={index === model.items.length - 1} onPress={() => move(item.entryId!, 1)} style={[styles.small, index === model.items.length - 1 && styles.disabled]}><Text style={styles.smallText}>↓</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name} from playlist`} onPress={() => void store.playlists.removeEntry(playlistId, item.entryId!)} style={styles.remove}><Text style={styles.removeText}>Remove</Text></Pressable></> : null}
              </DraggableRow>;
            })}
          </ScrollView>
          {!model.smart && !confirming ? <Pressable accessibilityRole="button" testID="delete-playlist" onPress={() => setConfirming(true)} style={styles.delete}><Text style={styles.deleteText}>Delete playlist</Text></Pressable> : null}
          {confirming ? <View style={styles.confirm}><Text style={styles.confirmText}>Delete “{model.name}”? This can’t be undone.</Text>
            <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.smallConfirm}><Text style={styles.buttonText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" testID="confirm-delete-playlist" onPress={() => void store.playlists.delete(playlistId).then(done => { if (done) router.back(); })} style={styles.confirmDelete}><Text style={styles.buttonText}>Delete</Text></Pressable></View> : null}
        </View>
      </View>
    </SheetModal>
  </>;
}

const SCRIM = 'rgba(3,5,8,.76)';
const styles = StyleSheet.create({ entry: { position: 'absolute', right: 32, bottom: 28, zIndex: 20, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#eee5da' }, entryText: { color: '#15171b', fontWeight: '800' },
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }, sheet: { width: '100%', maxWidth: 780, maxHeight: '88%', borderRadius: 22, borderWidth: 1, borderColor: '#363b45', backgroundColor: '#15181e', padding: 22, gap: 14 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12 }, title: { color: '#f5f0e9', fontSize: 26, fontWeight: '700' }, sub: { color: '#aeb4bf', marginTop: 4 }, icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#292d35' }, iconText: { color: '#fff', fontSize: 26 },
  rename: { flexDirection: 'row', gap: 10 }, input: { flex: 1, borderWidth: 1, borderColor: '#464c58', borderRadius: 12, color: '#fff', paddingHorizontal: 13, minHeight: 46 }, save: { backgroundColor: '#8f593a', borderRadius: 12, justifyContent: 'center', paddingHorizontal: 16 }, buttonText: { color: '#fff', fontWeight: '700' }, list: { minHeight: 120, maxHeight: 500 }, row: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#22262d', borderRadius: 12, padding: 10 }, dragging: { opacity: .55, borderWidth: 1, borderColor: '#d5a676' }, grip: { color: '#9ba1ad', fontSize: 22, paddingHorizontal: 4 }, name: { color: '#fff', fontSize: 15, fontWeight: '600' }, meta: { color: '#9ea4af', marginTop: 2, fontSize: 12 }, small: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#353a44', alignItems: 'center', justifyContent: 'center' }, smallText: { color: '#fff', fontSize: 19 }, remove: { height: 38, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 10, backgroundColor: '#432b2b' }, removeText: { color: '#ffc7bd', fontWeight: '700', fontSize: 12 }, disabled: { opacity: .3 }, delete: { alignSelf: 'flex-start', padding: 10 }, deleteText: { color: '#ff9e91', fontWeight: '700' }, confirm: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#352425', borderRadius: 12, padding: 10 }, confirmText: { color: '#ffd7d1', flex: 1 }, smallConfirm: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 10, backgroundColor: '#3b404a' }, confirmDelete: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 10, backgroundColor: '#8c3f3a' }, error: { color: '#ffd0c9', backgroundColor: '#512a2a', padding: 10, borderRadius: 10 } });
