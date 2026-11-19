import { useAuthLayout } from '../layout-context';
// Connect's first step: an address, checked as it is typed (before any credential is sent);
// the server it found, with its kind, name and version; and your servers, to switch or remove.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { msg } from '@vela/core';
import { display, eyebrow } from '../../../resolve/vela-base/look';
import { Alert, Field, Label, Pill, Waiting, Words } from '../../common/controls';
import { useLook } from '../../common/look';
import type { ServerOption, ServerProbe } from './model';
import { useLatest } from './pending';
import { ServerRow } from './server-row';

const PROBE_DELAY_MS = 350;
const FAILED = new Set(['invalid', 'unreachable', 'unsupported', 'insecure']);

/** A Plex server has no name until it is linked; its kind stands in. */
export const foundName = (probe: ServerProbe) => probe.name || probe.kindLabel;

export function AddressStep({
  servers,
  busy,
  probe,
  onAdd,
  onSelect,
  onRemove,
  onPlex,
  error,
}: {
  servers: ServerOption[];
  busy: boolean;
  probe(url: string): Promise<ServerProbe>;
  onAdd(found: ServerProbe): void;
  onSelect(id: string): void;
  onRemove(id: string): void;
  /** Sign in with a Plex account instead: its servers are found through plex.tv, no address needed. */
  onPlex?(): void;
  error: string;
}) {
  const layout = useAuthLayout();
  const look = useLook();
  const [address, setAddress] = useState('');
  const checked = useLatest(probe, PROBE_DELAY_MS);
  const found = checked.answer?.state === 'found' ? checked.answer : null;
  const edit = (value: string) => {
    setAddress(value);
    const waiting: ServerProbe | null = value.trim()
      ? {
          url: value,
          state: 'checking',
          kind: '',
          kindLabel: '',
          name: '',
          version: '',
          normalizedUrl: '',
          message: '',
        }
      : null;
    checked.ask(value, waiting);
  };
  const add = () => {
    if (found && !busy) onAdd(found);
  };
  return (
    <View style={{ gap: layout?.gap ?? 26, minHeight: 0, flexShrink: 1 }}>

      <Field
        label={msg('connect.address')}
        value={address}
        onChangeText={edit}
        onSubmit={add}
        kind="url"
        placeholder={msg('connect.addressHint')}
        testID="connect-address"
      />
      {checked.answer?.state === 'checking' ? <Waiting>{msg('connect.checking')}</Waiting> : null}
      {found ? (
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[
            look.box({
              gap: '14px',
              padding: '18px',
              'border-radius': '18px',
              'background-color': '$ui.raised',
              border: '1px solid $ui.glassEdge',
            }),
            look.motion('velaEnter0'),
          ]}
        >
          <View style={{ gap: 4 }}>
            <Words rows={{ ...eyebrow, 'font-size': '10px', color: '$ui.accent' }}>{found.kindLabel}</Words>
            <Words rows={{ ...display, 'font-size': '28px' }} lines={2}>
              {foundName(found)}
            </Words>
            {found.version ? (
              <Words rows={{ 'font-size': '12px', color: '$ui.inkQuiet' }}>{found.version}</Words>
            ) : null}
          </View>
          <Pill
            primary
            height={50}
            label={msg('connect.continue')}
            onPress={add}
            disabled={busy}
            busy={busy}
            testID="connect-continue"
          />
        </Animated.View>
      ) : null}
      {checked.answer && FAILED.has(checked.answer.state) ? <Alert>{checked.answer.message}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {onPlex && !found ? (
        <Pill label={msg('connect.plex.signIn')} height={46} onPress={onPlex} disabled={busy} testID="connect-plex" />
      ) : null}
      {servers.length > 0 ? (
        <View style={{ gap: 8, minHeight: 0, flexShrink: 1 }}>
          <Label>{msg('connect.yours')}</Label>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
          {servers.map(server => (
            <ServerRow key={server.id} server={server} busy={busy} onSelect={onSelect} onRemove={onRemove} />
          ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
