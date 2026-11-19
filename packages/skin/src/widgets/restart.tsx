import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { msg } from '@vela/core';
import { FocusPressable } from '../focus';
import { useHost } from '../host';
import { useLook } from './common/look';

/** Shared secondary action, adjacent to every resumable document play control. */
export function Restart({ arg, hero = false, onPlay }: { arg: string; hero?: boolean; onPlay?(): void }) {
  const host = useHost();
  const look = useLook();
  const [focused, focus] = useState(false);
  const [id, source = '', audio = ''] = arg.split('|');
  return <FocusPressable accessibilityRole="button" accessibilityLabel={msg('ui.playFromBeginning')}
    onFocus={() => focus(true)} onBlur={() => focus(false)}
    onPress={() => { onPlay?.(); host.dispatch('play', `${id}|${source}|${audio}|0`); }}
    style={{ padding: 12, minHeight: 44, justifyContent: 'center', borderRadius: 9999, backgroundColor: focused ? look.ui.ink : look.ui.control }}>
    <Text style={look.text({ 'font-size': '14px', color: focused ? '$ui.inkInverse' : '$ui.ink' })}>{msg(hero ? 'ui.fromBeginning' : 'ui.playFromBeginning')}</Text>
  </FocusPressable>;
}

export function RestartMenu({ id, close }: { id: string; close(): void }) {
  const host = useHost();
  const look = useLook();
  return <Modal visible transparent onRequestClose={close}>
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: look.ui.scrim }}>
      <View style={{ padding: 24, gap: 12, backgroundColor: look.ui.page, borderRadius: 16 }}>
        <FocusPressable accessibilityRole="button" onPress={() => { close(); host.dispatch('play', id); }}><Text style={look.text({})}>{msg('ui.resumeWatching')}</Text></FocusPressable>
        <Restart arg={id} onPlay={close} />
        <FocusPressable accessibilityRole="button" onPress={close}><Text style={look.text({})}>{msg('ui.close')}</Text></FocusPressable>
      </View>
    </View>
  </Modal>;
}
