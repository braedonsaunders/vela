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
/** A server's line: its row and, for another server, the remove button beside it. It spans the
 * menu's rows as ROW does on its own, and the row inside it fills what the button leaves. */
const SERVER_LINE = { 'flex-direction': 'row', 'align-items': 'center', margin: '0px -10px', gap: '4px' };
const LOOKS = { hover: { 'background-color': '$ui.control' }, focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' } };

export function ServerSwitcher({ params }: WidgetProps) {
  const switcher = useServerSwitch();
  const host = useHost();
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [returnTo, setReturnTo] = useState('');
  const selecting = useRef(false);
  const look = useLook();
  const busy = pending !== '';
  if (!switcher) return null;
  const selectServer = (id: string) => switcher.selectServer?.(id) ?? switcher.actions.select(id);
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
      const outcome = await selectServer(server.id);
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
    <View style={look.box({ gap: '2px' })} accessibilityRole="menu" accessibilityLabel={title}>
      {switcher.openDownloads ? <Row label="Downloads" testID="server-downloads" icon="download" onPress={() => {
        host.setFlag('menu', false);
        switcher.openDownloads?.();
      }} disabled={busy} /> : null}
      {switcher.openLibraries ? <Row label="Manage libraries" testID="server-libraries" icon="library" onPress={() => {
        host.setFlag('menu', false);
        switcher.openLibraries?.();
      }} disabled={busy} /> : null}
      <Words rows={{ ...eyebrow, 'font-size': '12px', color: '$ui.inkQuiet' }} style={look.box({ 'padding-top': '4px', 'padding-bottom': '4px' })}>
        {title}
      </Words>
      {switcher.servers.list.map(server => {
        const removable = !server.selected && server.id !== switcher.servers.selectedId;
        const confirming = removable && confirmId === server.id;
        return (
          <View key={server.id}>
            {/* Spans the menu's rows (their margin), in the document's lengths: a raw -10 drew the
                row 8 px left of the others on Android TV, which scales the document's px. */}
            <View style={look.box(SERVER_LINE)}>
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
                icon="close"
                iconOnly
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
              <View style={look.box({ gap: '4px', 'padding-top': '6px', 'padding-bottom': '6px' })}>
                <Words rows={{ 'font-size': '13px' }}>{msg('connect.removeConfirm', { name: server.name })}</Words>
                <View style={look.box({ 'flex-direction': 'row', 'justify-content': 'flex-end', gap: '8px' })}>
                  <Row label={msg('ui.cancel')} onPress={() => { setReturnTo(server.id); setConfirmId(''); }} disabled={busy}
                    testID="server-remove-cancel" inline compact preferFocus />
                  <Row label={msg('connect.removeAction')} accessibilityLabel={msg('connect.remove', { name: server.name })}
                    onPress={() => void remove(server)} disabled={busy} busy={pending === server.id}
                    testID="server-remove-confirm" inline compact destructive />
                </View>
              </View>
            ) : null}
            {server.etherOrigin ? <Row label="Ether available" testID={`server-ether-${server.id}`} disabled={busy} onPress={() => void (async () => { const result = await switcher.actions.add('ether', server.name, server.etherOrigin!); if (result.error) setError(result.error); else { const selected = await selectServer(result.id); if (selected.error) setError(selected.error); } })()} /> : null}
          </View>
        );
      })}
      <Row label={params.addLabel || msg('connect.add')} onPress={switcher.openConnect} disabled={busy} testID="server-add" />
      {error ? <Alert>{error}</Alert> : null}
    </View>
  );
}

function Row({
  label,
  iconOnly = false,
  destructive = false,
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
  label?: string;
  iconOnly?: boolean;
  destructive?: boolean;
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
  const rows = destructive ? { ...ROW, 'background-color': '#a32638' }
    : iconOnly ? { ...ROW, 'justify-content': 'center', width: '44px', padding: '0px' }
    : compact ? { ...ROW, 'background-color': '$ui.control' } : ROW;
  const looks = destructive ? { ...LOOKS, hover: { 'background-color': '#b83143' } } : LOOKS;
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
      style={[look.box(overlaid(rows, state, looks, disabled)), inline && { marginLeft: 0, marginRight: 0, flex: compact ? undefined : 1 }, NO_RING]}
      {...handlers}
    >
      {icon ? <Glyph symbol={icon} size={17} color={look.ui.ink} /> : null}
      {iconOnly ? null : <View style={[look.box({ gap: '2px' }), { flex: compact ? undefined : 1, minWidth: 0 }]}>
        <Words rows={{ 'font-size': '14px', ...(destructive ? { color: '#ffffff' } : {}) }} style={face ? { fontFamily: face } : undefined} lines={1}>
          {label}
        </Words>
        {detail ? (
          <Words rows={{ 'font-size': '12px', color: ready ? '$ui.inkQuiet' : '$ui.accent' }} lines={1}>
            {detail}
          </Words>
        ) : null}
      </View>}
      {busy ? <ActivityIndicator size="small" color={look.ui.accent} /> : selected ? <Glyph symbol="checkmark" size={14} color={look.ui.accent} /> : null}
    </APressable>
  );
}
