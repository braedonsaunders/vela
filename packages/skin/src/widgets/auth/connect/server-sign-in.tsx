// Signing in to one server: which server it is (its name, kind and address, so it never reads as
// the app itself), and the ways in, Plex first wherever the server offers it. A username and
// password are a choice the viewer makes ("Sign in with a username instead"), never the first
// thing a Plex household sees; a quick-connect code is the quiet third way.
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Alert, Pill, Words } from '../../common/controls';
import { useAuthLayout } from '../layout-context';
import { DISPLAY_LINE_HEIGHT } from '../layout';
import { StepFrame } from '../step';
import { Credentials } from './credentials';
import { PlexMark } from './plex-mark';
import { signInOptions } from './steps';
import { TextAction } from './text-action';

export interface ServerIdentity {
  name: string;
  kindLabel: string;
  /** The server's address as the viewer would type it (no scheme), or empty. */
  address: string;
}

/** "Sign in to" over the server's name, its kind and address under it. */
export function ServerHeading({ server }: { server: ServerIdentity }) {
  const layout = useAuthLayout();
  const size = layout?.headingSize ?? 40;
  const line = [server.kindLabel ? `${server.kindLabel} server` : '', server.address].filter(Boolean).join(' · ');
  return (
    <View style={{ alignItems: 'center', gap: 6 }} accessible accessibilityRole="header"
      accessibilityLabel={`Sign in to ${server.name}${line ? `, ${line}` : ''}`} testID="server-identity">
      <Words rows={{ 'font-size': '12px', 'font-weight': '600', 'letter-spacing': '0.22em', 'text-transform': 'uppercase', color: '$ui.accent' }}>Sign in to</Words>
      <Words rows={{ 'font-family': '$ui.fontDisplay', 'font-size': `${size}px`, 'line-height': String(DISPLAY_LINE_HEIGHT) }} lines={2} style={{ textAlign: 'center' }} maxScale={1.4}>{server.name}</Words>
      {line ? <Words rows={{ 'font-size': '15px', color: '$ui.inkSecondary' }} lines={1} style={{ textAlign: 'center' }}>{line}</Words> : null}
    </View>
  );
}

export function ServerSignIn({ server, plex, password, quick, busy, error, extras, typing, onTyping, onPlex, onSignIn, onQuick, onChangeServer, minimal }: {
  server: ServerIdentity;
  plex: boolean;
  password: boolean;
  quick: boolean;
  busy: boolean;
  error: string;
  extras?: ReactNode;
  /** The viewer chose a username and password (kept by the flow, so a Plex refusal can open them). */
  typing: boolean;
  onTyping(): void;
  onPlex(): void;
  onSignIn(username: string, password: string): void;
  onQuick(): void;
  /** Use a different server (the welcome, with this one still behind Back). */
  onChangeServer?(): void;
  minimal?: boolean;
}) {
  const layout = useAuthLayout();
  const height = layout?.controlHeight ?? 56;
  const options = signInOptions({ plex, password, quick, typing: typing || (!!error && !plex) });
  const plexButton = <Pill primary={options.plexPrimary} label="Continue with Plex" testID="server-plex" height={options.plexPrimary ? height : height - 6} disabled={busy} onPress={onPlex}><PlexMark /></Pill>;
  return <StepFrame heading={minimal ? undefined : <ServerHeading server={server} />}
    body={<>
      {options.fields ? <Credentials error={error} busy={busy} canPassword canQuick={false} compact={minimal}
        onSignIn={onSignIn} onQuick={onQuick} /> : null}
      {!options.fields && error ? <Alert>{error}</Alert> : null}
      {extras}
    </>}
    actions={minimal ? undefined : <>
      {options.plex && options.plexPrimary ? plexButton : null}
      {options.offerFields ? <Pill label="Sign in with a username instead" testID="connect-use-password" height={height - 6} disabled={busy} onPress={onTyping} /> : null}
      {options.plex && !options.plexPrimary ? plexButton : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
        {options.quick ? <TextAction label="Use a code" testID="connect-quick" disabled={busy} onPress={onQuick} /> : null}
        {onChangeServer ? <TextAction label="Use a different server" testID="connect-change-server" disabled={busy} onPress={onChangeServer} /> : null}
      </View>
    </>} />;
}

