// One of your servers on Connect: its name, kind and state; choosing it switches to it, and a
// server other than the current one can be removed.
import { View } from 'react-native';
import { msg } from '../../../../../../client/foundation/i18n';
import { APressable, Glyph, NO_RING, overlaid, useInteraction, Words } from '../../common/controls';
import { useLook } from '../../common/look';
import type { ServerOption } from './model';

const FOCUS = { 'box-shadow': '0px 0px 0px 2px $ui.accent' };

/** The line under a server's name: its kind with who is signed in, or why it is not ready. */
export function serverDetail(server: ServerOption): string {
  if (server.status === 'ready') return server.viewer ? `${server.kindLabel} · ${server.viewer}` : server.kindLabel;
  const why = server.message || (server.status === 'signed-out' ? msg('connect.signedOut') : msg('server.unreachable'));
  return `${server.kindLabel} · ${why}`;
}

export function ServerRow({ server, busy, onSelect, onRemove }: {
  server: ServerOption;
  busy: boolean;
  onSelect(id: string): void;
  onRemove(id: string): void;
}) {
  const look = useLook();
  const pick = useInteraction();
  const remove = useInteraction();
  const rows = overlaid({
    flex: '1',
    'min-width': '0px',
    'min-height': '56px',
    padding: '8px 14px',
    'border-radius': '14px',
    border: '1px solid $ui.glassEdge',
    'background-color': server.selected ? '$ui.controlHover' : '$ui.control',
    transition: 'background-color 180ms linear',
  }, pick.state, { hover: { 'background-color': '$ui.controlHover' }, focus: FOCUS });
  const removeRows = overlaid({
    width: '40px',
    height: '40px',
    'border-radius': '20px',
    'align-items': 'center',
    'justify-content': 'center',
    'background-color': '$ui.control',
  }, remove.state, { hover: { 'background-color': '$ui.controlHover' }, focus: FOCUS }, busy);
  const disabled = busy && !server.selected;
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <APressable onPress={() => { if (!server.selected) onSelect(server.id); }} disabled={disabled}
        accessibilityRole="button" accessibilityState={{ selected: server.selected, disabled }} testID={`server-${server.id}`}
        style={[look.box(rows), { flexDirection: 'row', alignItems: 'center', gap: 12 }, NO_RING]} {...pick.handlers}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Words rows={{ 'font-size': '15px', 'font-weight': '600' }} lines={1}>{server.name}</Words>
          <Words rows={{ 'font-size': '12px', color: server.status === 'ready' ? '$ui.inkQuiet' : '$ui.accent' }} lines={1}>
            {serverDetail(server)}
          </Words>
        </View>
        {server.selected ? <Glyph symbol="checkmark" size={14} color={look.ui.accent} /> : null}
      </APressable>
      {server.selected ? null : (
        <APressable onPress={() => onRemove(server.id)} disabled={busy} accessibilityRole="button"
          accessibilityLabel={msg('connect.remove', { name: server.name })} style={[look.box(removeRows), NO_RING]} {...remove.handlers}>
          <Glyph symbol="close" size={14} color={look.ui.ink} />
        </APressable>
      )}
    </View>
  );
}
