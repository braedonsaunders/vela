// The `?` sheet: the music app's keyboard shortcuts, in the document's look.
import { StyleSheet, Text, View } from 'react-native';
import { msg } from '@vela/core';
import { FocusPressable as Pressable } from '@vela/skin/src/focus';
import { DismissScope } from '@vela/skin/src/escape';
import { SheetModal } from '@vela/skin/src/widgets/common/sheet-modal';
import { useMediaLook } from '@vela/skin/src/widgets/media';
import { MUSIC_KEYS } from './keys';

export function MusicKeysSheet({ open, close }: { open: boolean; close(): void }) {
  const m = useMediaLook();
  return (
    <DismissScope open={open} dismiss={close}>
      <SheetModal open={open} scrim="rgba(3,5,8,0.6)" onRequestClose={close}>
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} accessibilityViewIsModal>
          <Pressable accessible={false} focusable={false} onPress={close} style={StyleSheet.absoluteFill} />
          <View testID="music-keys" style={[{ width: 460, maxWidth: '92%', padding: 28, borderRadius: 24, gap: 6 }, m.box({ 'background-color': '$ui.popover', border: '1px solid $ui.glassEdge', 'box-shadow': '0px 30px 90px rgba(0,0,0,0.6)' })]}>
            <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '28px', color: '$ui.ink' }), { marginBottom: 10 }]}>{msg('music.keyboard')}</Text>
            {MUSIC_KEYS.map(row => (
              <View key={row.keys} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, gap: 16 }}>
                <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>{msg(row.label)}</Text>
                <View style={[{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }, m.box({ 'background-color': '$ui.control', border: '1px solid $ui.glassEdge' })]}>
                  <Text style={m.text({ 'font-size': '13px', 'font-weight': '700', color: '$ui.ink', 'font-variant-numeric': 'tabular-nums' })}>{row.keys}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </SheetModal>
    </DismissScope>
  );
}
