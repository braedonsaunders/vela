// Linking a Plex server: a PIN entered at plex.tv/link (one tile per character), then the
// account's servers to choose from, the recommended one marked. Only the chosen server's own
// token is kept (the session store's concern); this view only starts, chooses and cancels.
import { Linking, Platform, View } from 'react-native';
import { msg } from '@vela/core';
import {
  APressable,
  Alert,
  CodeTiles,
  Label,
  NO_RING,
  overlaid,
  Pill,
  useInteraction,
  Waiting,
  Words,
} from '../../common/controls';
import { useLook } from '../../common/look';
import type { PlexChoice, PlexLink } from './model';

export function PlexStep({
  link,
  busy,
  starting,
  error,
  onStart,
  onChoose,
  onCancel,
}: {
  link: PlexLink | null;
  busy: boolean;
  /** A code was asked for and has not arrived yet. */
  starting: boolean;
  error: string;
  onStart(): void;
  onChoose(id: string): void;
  onCancel(): void;
}) {
  const waiting = starting || link?.state === 'waiting';
  return (
    <View style={{ gap: 18 }}>
      {waiting ? (
        <View style={{ gap: 18, alignItems: 'center' }}>
          {link?.code ? <CodeTiles code={link.code} testID="plex-code" /> : null}
          {link?.linkUrl ? <LinkLine url={link.linkUrl} /> : null}
          <Waiting>{msg('connect.plex.waiting')}</Waiting>
          <Pill label={msg('ui.cancel')} height={46} align="center" onPress={onCancel} />
        </View>
      ) : link?.state === 'linked' ? (
        <View style={{ gap: 8 }}>
          <Label>{msg('connect.plex.choose')}</Label>
          {link.choices.length === 0 ? <Waiting>{msg('connect.plex.finding')}</Waiting> : null}
          {link.choices.map(choice => (
            <Choice key={choice.id} choice={choice} busy={busy} onChoose={onChoose} />
          ))}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {link?.state === 'expired' ? <Alert>{msg('connect.plex.expired')}</Alert> : null}
          {link?.state === 'failed' ? <Alert>{msg('connect.plex.failed')}</Alert> : null}
          <Pill
            primary
            label={msg('connect.plex.start')}
            onPress={onStart}
            disabled={busy}
            busy={busy}
            testID="plex-start"
          />
        </View>
      )}
      {error ? <Alert>{error}</Alert> : null}
    </View>
  );
}

/** "Enter this code at plex.tv/link": a link where a browser can open it, the address on a TV. */
function LinkLine({ url }: { url: string }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const canOpen = !Platform.isTV;
  const rows = { 'font-size': '15px', 'font-weight': '650' };
  return (
    <View
      style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline', justifyContent: 'center', flexWrap: 'wrap' }}
    >
      <Words rows={{ 'font-size': '15px', color: '$ui.inkSecondary' }}>{msg('connect.plex.enterAt')}</Words>
      {canOpen ? (
        <APressable
          onPress={() => Linking.openURL(url)}
          accessibilityRole="link"
          testID="plex-link"
          {...handlers}
          style={[
            look.box(
              overlaid({ 'border-radius': '4px' }, state, { focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' } }),
            ),
            NO_RING,
          ]}
        >
          <Words rows={rows} style={{ textDecorationLine: 'underline' }}>
            {msg('connect.plex.linkLabel')}
          </Words>
        </APressable>
      ) : (
        <Words rows={rows}>{msg('connect.plex.linkLabel')}</Words>
      )}
    </View>
  );
}

function Choice({ choice, busy, onChoose }: { choice: PlexChoice; busy: boolean; onChoose(id: string): void }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid(
    {
      'min-height': '60px',
      padding: '10px 16px',
      'border-radius': '16px',
      border: '1px solid $ui.glassEdge',
      'background-color': '$ui.control',
      transition: 'background-color 180ms linear',
    },
    state,
    { hover: { 'background-color': '$ui.controlHover' }, focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' } },
    busy,
  );
  return (
    <APressable
      onPress={() => onChoose(choice.id)}
      disabled={busy}
      accessibilityRole="button"
      testID={`plex-server-${choice.id}`}
      style={[look.box(rows), { flexDirection: 'row', alignItems: 'center', gap: 12 }, NO_RING]}
      {...handlers}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Words rows={{ 'font-size': '16px', 'font-weight': '600' }} lines={1}>
          {choice.name}
        </Words>
        <Words rows={{ 'font-size': '12px', color: '$ui.inkQuiet' }} lines={1}>
          {choice.connectionLabel}
        </Words>
      </View>
      {choice.recommended ? (
        <View style={look.box({ padding: '4px 8px', 'border-radius': '6px', 'background-color': '$ui.accent' })}>
          <Words
            rows={{ 'font-size': '11px', 'font-weight': '650', 'letter-spacing': '0.06em', color: '$ui.onAccent' }}
          >
            {msg('connect.plex.recommended')}
          </Words>
        </View>
      ) : null}
    </APressable>
  );
}
