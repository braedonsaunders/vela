// Signing in to a Jellyfin or Emby server from Connect: a username and password, or a Quick
// Connect code approved in the server's own dashboard (one tile per character).
import { useState } from 'react';
import { View } from 'react-native';
import { msg } from '@vela/core';
import { Alert, CodeTiles, Field, Pill, Waiting } from '../../common/controls';
import type { QuickCode } from './model';

export function JellyfinStep({ quick, busy, error, onSignIn, onQuick, onCancelQuick }: {
  /** This server's Quick Connect code, when one is up. */
  quick: QuickCode | null;
  busy: boolean;
  error: string;
  onSignIn(username: string, password: string): void;
  onQuick(): void;
  onCancelQuick(): void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const ready = username.trim() !== '' && password !== '' && !busy;
  const submit = () => {
    if (ready) onSignIn(username.trim(), password);
  };

  if (quick?.code) {
    const failed = quick.status === 'expired' ? msg('server.codeExpired') : quick.status === 'denied' ? msg('server.rejected') : '';
    return (
      <View style={{ gap: 18, alignItems: 'center' }}>
        <CodeTiles code={quick.code} testID="jelly-code" />
        {failed ? <Alert>{failed}</Alert> : <Waiting>{msg('connect.quick.waiting')}</Waiting>}
        <Pill label={msg('ui.cancel')} height={46} stretch={false} onPress={onCancelQuick} />
      </View>
    );
  }
  return (
    <View style={{ gap: 14 }}>
      <Field label={msg('ui.username')} value={username} onChangeText={setUsername} onSubmit={submit} kind="username" testID="connect-username" />
      <Field label={msg('ui.password')} value={password} onChangeText={setPassword} onSubmit={submit} kind="password" testID="connect-password" />
      <Pill primary label={msg('ui.signIn')} onPress={submit} disabled={!ready} busy={busy} testID="connect-sign-in" />
      {error ? <Alert>{error}</Alert> : null}
      <Pill label={msg('connect.quick.start')} onPress={onQuick} disabled={busy} testID="connect-quick" />
    </View>
  );
}
