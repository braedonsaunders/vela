// Create a playlist, or edit one's name and description: a drawer from the right on wide layouts,
// a sheet from the bottom on phones, centred on a TV. Delete lives here too, behind a confirm.
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { msg } from '@vela/core';
import { useVela } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { DismissScope } from '../../escape';
import { SheetModal } from '../common/sheet-modal';
import { NO_RING } from '../common/controls';
import { alpha, useMediaLook } from '../media/parts';
import { useMusic } from './context';
import { compactMusic } from './layout';
import { transition } from './parts';

export type PlaylistDrawerRequest = { mode: 'create' } | { mode: 'edit'; id: string; name: string; summary: string };

export function PlaylistDrawer({ request, close }: { request: PlaylistDrawerRequest | null; close(): void }) {
  const store = useVela();
  const app = useMusic();
  const m = useMediaLook();
  const [shown, setShown] = useState(request);
  useEffect(() => { if (request) setShown(request); }, [request]);
  const editing = shown?.mode === 'edit' ? shown : null;
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const first = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (!request) return;
    setName(request.mode === 'edit' ? request.name : '');
    setSummary(request.mode === 'edit' ? request.summary : '');
    setConfirmDelete(false);
    const frame = requestAnimationFrame(() => first.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [request]);
  const compact = compactMusic(m);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    if (editing) {
      if (await store.playlists.edit(editing.id, { name, summary })) close();
    } else {
      const id = await store.playlists.create(name);
      if (id && summary.trim()) await store.playlists.edit(id, { name, summary });
      if (id) { close(); app.go({ kind: 'playlist', id }); }
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!editing) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    if (await store.playlists.delete(editing.id)) { close(); app.go({ kind: 'library' }); }
    setBusy(false);
  };
  const panel = m.box({ 'background-color': '$ui.popover', border: '1px solid $ui.glassEdge', 'box-shadow': '0px 30px 90px rgba(0,0,0,0.6)' });
  const field = (rows: Record<string, string>) => m.text({ 'font-size': '16px', color: '$ui.ink', ...rows });
  return (
    <DismissScope open={!!request} dismiss={close}>
      <SheetModal open={!!request} scrim="rgba(3,5,8,0.6)" onRequestClose={close}>
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', justifyContent: compact ? 'center' : 'flex-end', alignItems: compact ? 'flex-end' : 'stretch' }, Platform.isTV ? { justifyContent: 'center', alignItems: 'center' } : {}]} accessibilityViewIsModal>
          <Pressable accessible={false} focusable={false} onPress={close} style={StyleSheet.absoluteFill} />
          <View testID="playlist-drawer" style={[panel, { width: compact ? '100%' : 440, padding: 28, gap: 18, borderRadius: compact ? 24 : 0, borderTopLeftRadius: 24, borderBottomLeftRadius: compact ? 0 : 24 },
            Platform.isTV ? { borderRadius: 24, width: 640 } : {}]}>
            <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '30px', color: '$ui.ink' })}>{editing ? msg('music.editDetails') : msg('music.newPlaylist')}</Text>
            <View style={{ gap: 8 }}>
              <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{msg('music.playlistName')}</Text>
              <TextInput ref={first} testID="playlist-drawer-name" value={name} onChangeText={setName} maxLength={200} placeholder={msg('music.playlistNamePlaceholder')} placeholderTextColor={m.ui.inkQuiet}
                onSubmitEditing={() => void save()} returnKeyType="done" accessibilityLabel={msg('music.playlistName')}
                style={[field({}), { minHeight: 50, borderRadius: 12, paddingHorizontal: 14, backgroundColor: alpha(m.ui.ink, 0.06), borderWidth: 1, borderColor: m.ui.glassEdge }, NO_RING]} />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{msg('music.playlistDescription')}</Text>
              <TextInput testID="playlist-drawer-summary" value={summary} onChangeText={setSummary} maxLength={1000} multiline placeholder={msg('music.playlistDescriptionPlaceholder')} placeholderTextColor={m.ui.inkQuiet}
                accessibilityLabel={msg('music.playlistDescription')}
                style={[field({ 'line-height': '1.4' }), { minHeight: 110, borderRadius: 12, padding: 14, textAlignVertical: 'top', backgroundColor: alpha(m.ui.ink, 0.06), borderWidth: 1, borderColor: m.ui.glassEdge }, NO_RING]} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
              {editing ? (
                <Pressable onPress={() => void remove()} testID="playlist-drawer-delete" accessibilityRole="button" style={[NO_RING, { paddingHorizontal: 14, height: 44, justifyContent: 'center', borderRadius: 22 }]}>
                  <Text style={m.text({ 'font-size': '14px', 'font-weight': '700', color: confirmDelete ? m.ui.live : '$ui.inkSecondary' })}>{confirmDelete ? msg('music.deleteConfirm') : msg('music.deletePlaylist')}</Text>
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }} />
              <Pressable onPress={close} accessibilityRole="button" style={[NO_RING, { paddingHorizontal: 18, height: 44, justifyContent: 'center', borderRadius: 22 }]}>
                <Text style={m.text({ 'font-size': '15px', 'font-weight': '700', color: '$ui.inkSecondary' })}>{msg('ui.cancel')}</Text>
              </Pressable>
              <Pressable onPress={() => void save()} disabled={!name.trim() || busy} testID="playlist-drawer-save" accessibilityRole="button"
                style={[NO_RING, { paddingHorizontal: 22, height: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: m.ui.accent, opacity: !name.trim() || busy ? 0.5 : 1 }, transition('opacity', 120)]}>
                <Text style={m.text({ 'font-size': '15px', 'font-weight': '750', color: m.ui.onAccent })}>{editing ? msg('music.save') : msg('music.create')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SheetModal>
    </DismissScope>
  );
}
