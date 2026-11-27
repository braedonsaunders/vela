// The same password form for Ether, Jellyfin and Emby. Codes live in the flow's code step.
import { useRef, useState, type ReactNode, type ComponentRef } from 'react';
import { View, type TextInput } from 'react-native';
import { msg } from '@vela/core';
import { Alert, Field, Pill, Words } from '../../common/controls';
import { useLook } from '../../common/look';
import { useAuthLayout } from '../layout-context';

export function Credentials({ busy, onSignIn, onQuick, canPassword = true, canQuick = true, compact = false, secondary, error = '' }: {
  secondary?: ReactNode;
  /** Why the last sign-in failed, shown under the button that tried. */
  error?: string;
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
    <View style={{ gap: layout?.tight ? 8 : 14 }}>
      {canPassword ? <View style={{ gap: layout?.minimal ? 6 : 8 }}>
        <Field label={msg('ui.username')} value={username} onChangeText={setUsername}
          onSubmit={() => passwordInput.current?.focus()} kind="username" testID="connect-username" preferred bare />
        <Field label={msg('ui.password')} value={password} onChangeText={setPassword} onSubmit={submit}
          inputRef={passwordInput} kind="password" testID="connect-password" doneLabel={msg('ui.signIn')} bare />
        <Pill primary height={layout?.controlHeight ?? 56} label={msg('ui.signIn')} onPress={submit}
          disabled={!ready} busy={busy} testID="connect-sign-in" />
        {error ? <Alert>{error}</Alert> : null}
      </View> : null}
      {canPassword && (secondary || canQuick) && !compact ? <Or /> : null}
      {/* Typing in the smallest space (a landscape phone's keyboard up): the fields and Sign in only. */}
      {compact && canPassword ? null : <View style={{ gap: layout?.tight ? 8 : 12, flexDirection: layout?.inlineAlternatives ? 'row' : 'column' }}>
        {secondary ? <View style={layout?.inlineAlternatives ? { flex: 1 } : undefined}>{secondary}</View> : null}
        {canQuick ? (
          <View style={layout?.inlineAlternatives ? { flex: 1 } : undefined}>
            <Pill label="Use a code" height={(layout?.controlHeight ?? 56) - 6} onPress={onQuick} disabled={busy} testID="connect-quick" />
          </View>
        ) : null}
      </View>}
      {!canPassword && !canQuick ? <Alert>No sign-in methods are available. Go back to choose another server.</Alert> : null}
    </View>
  );
}

/** The quiet divide between signing in here and the other ways in. */
function Or() {
  const look = useLook();
  const line = look.box({ flex: '1', height: '1px', 'background-color': '$ui.glassEdge' });
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={line} />
    <Words rows={{ 'font-size': '13px', color: '$ui.inkQuiet' }}>or</Words>
    <View style={line} />
  </View>;
}
