import { useState } from 'react';
import { Text } from 'react-native';
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
  return <FocusPressable accessibilityRole="button" accessibilityLabel={msg('ui.restart')}
    onFocus={() => focus(true)} onBlur={() => focus(false)}
    onPress={() => { onPlay?.(); host.dispatch('play', `${id}|${source}|${audio}|0`); }}
    style={{ padding: 12, minHeight: 44, justifyContent: 'center', borderRadius: 9999, backgroundColor: focused ? look.ui.ink : look.ui.control }}>
    <Text style={look.text({ 'font-size': '14px', color: focused ? '$ui.inkInverse' : '$ui.ink' })}>{msg('ui.restart')}</Text>
  </FocusPressable>;
}
