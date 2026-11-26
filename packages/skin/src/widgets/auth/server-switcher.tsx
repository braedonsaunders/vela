// Widget `serverSwitcher` (the profile menu): your servers, the current one checked, each with
// its kind and state; choosing another switches to it, and "Add a server" opens Connect. Its text
// takes the node's inherited rows; the quiet lines and the check take the document's `ui` inks.
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { msg } from '@vela/core';
import { eyebrow } from '../../resolve/vela-base/look';
import { useHost, useInheritedText, type WidgetProps } from '../../host';
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
  'min-height': '44px',
  padding: '8px 10px',
  margin: '0px -10px',
  'border-radius': '10px',
};
const LOOKS = { hover: { 'background-color': '$ui.control' }, focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' } };

export function ServerSwitcher({ params }: WidgetProps) {
  const switcher = useServerSwitch();
  const host = useHost();
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [returnTo, setReturnTo] = useState('');
  const selecting = useRef(false);
  const busy = pending !== '';
  if (!switcher) return null;
  const pick = async (server: ServerOption) => {
    if (server.selected || selecting.current) return;
    setConfirmId('');
    setReturnTo('');
    selecting.current = true;
    setPending(server.id);
    setError('');
    try {
      // Let the pressed row paint its progress before selection updates the app's models.
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const outcome = await switcher.actions.select(server.id);
      if (outcome.error) setError(outcome.error);
    } finally {
      selecting.current = false;
      setPending('');
    }
  };
  const remove = async (server: ServerOption) => {
    if (server.selected || server.id === switcher.servers.selectedId || selecting.current) return;
    selecting.current = true;
    setPending(server.id);
    setError('');
    try {
      const outcome = await switcher.actions.remove(server.id);
      if (outcome.error) setError(outcome.error);
      else setConfirmId('');
    } finally {
      selecting.current = false;
      setPending('');
    }
  };
  const title = params.label || msg('connect.servers');
  return (
    <View style={{ gap: 2 }} accessibilityRole="menu" accessibilityLabel={title}>
      {switcher.openDownloads ? <Row label="Downloads" testID="server-downloads" icon="download" onPress={() => {
        host.setFlag('menu', false);
        switcher.openDownloads?.();
      }} disabled={busy} /> : null}
      <Words rows={{ ...eyebrow, 'font-size': '12px', color: '$ui.inkQuiet' }} style={{ paddingVertical: 4 }}>
        {title}
      </Words>
      {switcher.servers.list.map(server => {
        const removable = !server.selected && server.id !== switcher.servers.selectedId && server.id !== 'ether';
        const confirming = removable && confirmId === server.id;
        return (
          <View key={server.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: -10, gap: 4 }}>
              <Row
                label={server.selected && switcher.brandingName ? switcher.brandingName : server.name}
                detail={pending === server.id && !confirming ? msg('ui.connectingToYourLibrary') : serverDetail(server)}
                busy={pending === server.id && !confirming}
                ready={server.status === 'ready'}
                selected={server.selected}
                disabled={busy}
                onPress={() => pick(server)}
                testID={`server-${server.id}`}
                inline
              />
              {removable && !confirming ? <Row
                label={msg('connect.removeAction')}
                accessibilityLabel={msg('connect.remove', { name: server.name })}
                onPress={() => { setError(''); setReturnTo(''); setConfirmId(server.id); }}
                disabled={busy}
                preferFocus={returnTo === server.id}
                testID={`server-remove-${server.id}`}
                inline
                compact
              /> : null}
            </View>
            {confirming ? (
              <View style={{ gap: 4, paddingVertical: 6 }}>
                <Words rows={{ 'font-size': '13px' }}>{msg('connect.removeConfirm', { name: server.name })}</Words>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                  <Row label={msg('ui.cancel')} onPress={() => { setReturnTo(server.id); setConfirmId(''); }} disabled={busy}
                    testID="server-remove-cancel" inline compact preferFocus />
                  <Row label={msg('connect.removeAction')} accessibilityLabel={msg('connect.remove', { name: server.name })}
                    onPress={() => void remove(server)} disabled={busy} busy={pending === server.id}
                    testID="server-remove-confirm" inline compact />
                </View>
              </View>
            ) : null}
            {server.etherOrigin ? <Row label="Ether available" testID={`server-ether-${server.id}`} disabled={busy} onPress={() => void (async () => { const result = await switcher.actions.add('ether', server.name, server.etherOrigin!); if (result.error) setError(result.error); else { const selected = await switcher.actions.select(result.id); if (selected.error) setError(selected.error); } })()} /> : null}
          </View>
        );
      })}
      <Row label={params.addLabel || msg('connect.add')} onPress={switcher.openConnect} disabled={busy} testID="server-add" />
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
  busy = false,
  onPress,
  href,
  icon,
  testID,
  accessibilityLabel,
  inline = false,
  compact = false,
  preferFocus = false,
}: {
  label: string;
  detail?: string;
  ready?: boolean;
  selected?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onPress?(): void;
  href?: string;
  icon?: string;
  testID: string;
  accessibilityLabel?: string;
  inline?: boolean;
  compact?: boolean;
  preferFocus?: boolean;
}) {
  const look = useLook();
  // The menu's own face, where the document sets one.
  const face = useInheritedText().style.fontFamily;
  const { state, handlers } = useInteraction();
  const button = useRef<ComponentRef<typeof APressable>>(null);
  useEffect(() => {
    if (Platform.OS === 'web' && preferFocus && !disabled) button.current?.focus();
  }, [preferFocus, disabled]);
  const rows = compact ? { ...ROW, 'background-color': '$ui.control' } : ROW;
  return (
    <APressable
      ref={button}
      onPress={onPress}
      disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={Platform.isTV && preferFocus}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={href ? 'link' : 'menuitem'}
      {...(href && Platform.OS === 'web' ? { href } : {})}
      accessibilityState={{ selected, disabled, busy }}
      testID={testID}
      style={[look.box(overlaid(rows, state, LOOKS, disabled)), inline && { marginLeft: 0, marginRight: 0, flex: compact ? undefined : 1 }, NO_RING]}
      {...handlers}
    >
      {icon ? <Glyph symbol={icon} size={17} color={look.ui.ink} /> : null}
      <View style={{ flex: compact ? undefined : 1, minWidth: 0, gap: 2 }}>
        <Words rows={{ 'font-size': '14px' }} style={face ? { fontFamily: face } : undefined} lines={1}>
          {label}
        </Words>
        {detail ? (
          <Words rows={{ 'font-size': '12px', color: ready ? '$ui.inkQuiet' : '$ui.accent' }} lines={1}>
            {detail}
          </Words>
        ) : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={look.ui.accent} /> : selected ? <Glyph symbol="checkmark" size={14} color={look.ui.accent} /> : null}
    </APressable>
  );
}
