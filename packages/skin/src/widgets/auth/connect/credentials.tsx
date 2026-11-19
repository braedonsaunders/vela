// The same password form for Ether, Jellyfin and Emby. Codes live in the flow's code step.
import { useRef, useState, type ComponentRef } from 'react';
import { View, type TextInput } from 'react-native';
import { msg } from '@vela/core';
import { Alert, Field, Pill } from '../../common/controls';
import { useAuthLayout } from '../layout-context';

export function Credentials({ busy, onSignIn, onQuick, canPassword = true, canQuick = true, compact = false }: {
  busy: boolean;
  canPassword?: boolean;
  canQuick?: boolean;
  compact?: boolean;
  onSignIn(username: string, password: string): void;
  onQuick(): void;
}) {
  const layout = useAuthLayout();
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const ready = username.trim() !== '' && password !== '' && !busy;
  const submit = () => { if (ready) onSignIn(username.trim(), password); };
  return (
    <View style={{ gap: layout?.tight ? 8 : 14, flexDirection: compact ? 'row' : 'column', alignItems: compact ? 'center' : undefined }}>
      {canPassword ? <View style={{ gap: 8, flex: compact ? 1 : undefined }}>
        <Field label={msg('ui.username')} value={username} onChangeText={setUsername}
          onSubmit={() => passwordInput.current?.focus()} kind="username" testID="connect-username" />
        <Field label={msg('ui.password')} value={password} onChangeText={setPassword} onSubmit={submit}
          inputRef={passwordInput} kind="password" testID="connect-password" />
        <Pill primary height={layout?.tight ? 44 : 52} label={msg('ui.signIn')} onPress={submit}
          disabled={!ready} busy={busy} testID="connect-sign-in" />
      </View> : null}
      {canQuick ? <Pill label="Use a code" height={44} onPress={onQuick} disabled={busy} testID="connect-quick" /> : null}
      {!canPassword && !canQuick ? <Alert>No sign-in methods are available. Go back to choose another server.</Alert> : null}
    </View>
  );
}
