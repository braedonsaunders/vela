// Widget `serverSwitcher` (the profile menu): your servers, the current one checked, each with
// its kind and state; choosing another switches to it, and "Add a server" opens Connect. Its text
// takes the node's inherited rows; the quiet lines and the check take the document's `ui` inks.
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { msg } from '@vela/core';
import { eyebrow } from '../../resolve/vela-base/look';
import { useInheritedText, type WidgetProps } from '../../host';
import { serverDetail } from './connect/server-row';
import type { ServerOption } from './connect/model';
import { Alert, APressable, Glyph, NO_RING, overlaid, useInteraction, Words } from '../common/controls';
import { useLook } from '../common/look';
import { useServerSwitch } from './servers';

const ROW = {
  'flex-direction': 'row',
  'align-items': 'center',
  'justify-content': 'space-between',
  gap: '10px',
  padding: '8px 10px',
  margin: '0px -10px',
  'border-radius': '10px',
};
const LOOKS = { hover: { 'background-color': '$ui.control' }, focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' } };

export function ServerSwitcher({ params }: WidgetProps) {
  const switcher = useServerSwitch();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!switcher) return null;
  const pick = async (server: ServerOption) => {
    if (server.selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const outcome = await switcher.actions.select(server.id);
      if (outcome.error) setError(outcome.error);
    } finally {
      setBusy(false);
    }
  };
  const title = params.label || msg('connect.servers');
  return (
    <View style={{ gap: 2 }} accessibilityRole="menu" accessibilityLabel={title}>
      <Words rows={{ ...eyebrow, 'font-size': '10px', color: '$ui.inkQuiet' }} style={{ paddingVertical: 4 }}>
        {title}
      </Words>
      {switcher.servers.list.map(server => (
        <View key={server.id}><Row
          label={server.name}
          detail={serverDetail(server)}
          ready={server.status === 'ready'}
          selected={server.selected}
          disabled={busy && !server.selected}
          onPress={() => pick(server)}
          testID={`server-${server.id}`}
        />{server.etherOrigin ? <Row label="Ether available" testID={`server-ether-${server.id}`} onPress={() => void (async () => { const result = await switcher.actions.add('ether', server.name, server.etherOrigin!); if (result.error) setError(result.error); else { const selected = await switcher.actions.select(result.id); if (selected.error) setError(selected.error); } })()} /> : null}</View>
      ))}
      <Row label={params.addLabel || msg('connect.add')} onPress={switcher.openConnect} testID="server-add" />
      {switcher.consoleUrl && Platform.OS === 'web' ? (
        <Row label={msg('server.backToEther')} href={switcher.consoleUrl} testID="back-to-ether" />
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </View>
  );
}

function Row({
  label,
  detail,
  ready = true,
  selected = false,
  disabled = false,
  onPress,
  href,
  testID,
}: {
  label: string;
  detail?: string;
  ready?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress?(): void;
  href?: string;
  testID: string;
}) {
  const look = useLook();
  // The menu's own face, where the document sets one.
  const face = useInheritedText().style.fontFamily;
  const { state, handlers } = useInteraction();
  return (
    <APressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={href ? 'link' : 'menuitem'}
      {...(href && Platform.OS === 'web' ? { href } : {})}
      accessibilityState={{ selected, disabled }}
      testID={testID}
      style={[look.box(overlaid(ROW, state, LOOKS, disabled)), NO_RING]}
      {...handlers}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Words rows={{ 'font-size': '14px' }} style={face ? { fontFamily: face } : undefined} lines={1}>
          {label}
        </Words>
        {detail ? (
          <Words rows={{ 'font-size': '11px', color: ready ? '$ui.inkQuiet' : '$ui.accent' }} lines={1}>
            {detail}
          </Words>
        ) : null}
      </View>
      {selected ? <Glyph symbol="checkmark" size={14} color={look.ui.accent} /> : null}
    </APressable>
  );
}
