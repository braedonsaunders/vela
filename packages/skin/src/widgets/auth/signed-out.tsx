// The signed-out page: the active document's `routes.auth` (sign-in, quick connect, and the
// connecting, redeeming and offline notices), with the session's sign-in state as `env.auth`
// and its actions behind `signIn`, `startQuick`, `cancelQuick` and `goSecure`. A signed-out Plex
// server has no password or code of its own: its page is Connect, opened on that server.
import { msg } from '@vela/core';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import type { Action } from '../../../../protocol/skin';
import { HostContext, type SkinHost } from '../../host';
import { SkinRoute } from '../../render';
import type { RNode } from '../../resolve';
import { Connect } from './connect/connect';
import type { ServerActions, ServersView } from './connect/model';
import { AuthFormProvider, useAuthFields } from './form';
import type { AuthStage, AuthView } from './model';
import { Stage } from './stage';
import { Pill } from '../common/controls';

/** The session's sign-in state for the selected server (packages/core, `s.auth`). */
export interface SessionAuth {
  phase: 'starting' | 'redeeming' | 'signed-out' | 'signed-in' | 'offline';
  serverId: string;
  serverKind: string;
  passwordAvailable: boolean;
  quickAvailable: boolean;
  secureOrigin: string;
  error: string;
  quick: null | { code: string; expiresLabel: string; status: 'pending' | 'expired' | 'denied' };
}

export interface AuthActions {
  signIn(username: string, password: string): Promise<unknown>;
  startQuick(): Promise<unknown>;
  cancelQuick(): unknown;
  secureSwitch(): Promise<{ url: string; error: string }>;
}

export interface SignedOutProps {
  /** The host for the auth route: the active document, viewport and view state. */
  host: SkinHost;
  /** The document's resolved `routes.auth` (the Vela base's when the document draws none). */
  route: RNode;
  auth: SessionAuth;
  actions: AuthActions;
  servers: ServersView;
  serverActions: ServerActions;
  /** A server pack's stage art (image paths), when the server offers one. */
  art?: { backdrop: string; wordmark: string };
}

function stageOf(auth: SessionAuth): AuthStage {
  switch (auth.phase) {
    case 'offline':
      return 'offline';
    case 'redeeming':
      return 'redeeming';
    case 'starting':
      return 'connecting';
    default:
      return auth.quick ? 'quick' : 'signin';
  }
}

function quickError(auth: SessionAuth): string {
  if (auth.quick?.status === 'expired') return msg('server.codeExpired');
  if (auth.quick?.status === 'denied') return msg('server.rejected');
  return '';
}

export function SignedOut(props: SignedOutProps) {
  const { auth, servers, serverActions, host } = props;
  const [connecting, setConnecting] = useState(false);
  useEffect(() => setConnecting(false), [auth.serverId]);
  if (connecting) return (
    <HostContext.Provider value={host}>
      <Stage><Connect servers={servers} actions={serverActions} onClose={() => setConnecting(false)} /></Stage>
    </HostContext.Provider>
  );
  // A signed-out Plex server signs in by linking, and a standalone app with no server starts by
  // adding one: both are Connect.
  if (auth.phase === 'signed-out' && (auth.serverKind === 'plex' || auth.serverKind === '')) {
    return (
      <HostContext.Provider value={host}>
        <Stage>
          <Connect servers={servers} actions={serverActions} serverId={auth.serverId} />
        </Stage>
      </HostContext.Provider>
    );
  }
  return <DocumentSignIn {...props} onConnect={() => { void props.actions.cancelQuick(); setConnecting(true); }} />;
}

function DocumentSignIn({ host, route, auth, actions, art, onConnect }: SignedOutProps & { onConnect(): void }) {
  const fields = useAuthFields();
  const [busy, setBusy] = useState(false);
  const [secure, setSecure] = useState({ busy: false, error: '' });

  const signIn = useCallback(async () => {
    if (busy || !fields.ready) return;
    setBusy(true);
    try {
      await actions.signIn(fields.values.username.trim(), fields.values.password);
    } finally {
      setBusy(false);
    }
  }, [busy, fields.ready, fields.values, actions]);

  const startQuick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await actions.startQuick();
    } finally {
      setBusy(false);
    }
  };

  const goSecure = async () => {
    setSecure({ busy: true, error: '' });
    const answer = await actions.secureSwitch();
    setSecure({ busy: false, error: answer.error });
    if (!answer.url) return;
    if (Platform.OS === 'web') window.location.assign(answer.url);
    else await Linking.openURL(answer.url);
  };

  const view: AuthView = {
    stage: stageOf(auth),
    error: auth.error,
    busy,
    ready: fields.ready && !busy,
    canPassword: auth.passwordAvailable,
    canQuick: auth.quickAvailable,
    quick: { code: auth.quick?.code ?? '', expires: auth.quick?.expiresLabel ?? '', error: quickError(auth) },
    secure: { origin: auth.secureOrigin, busy: secure.busy, error: secure.error },
    backdrop: art?.backdrop ?? '',
    wordmark: art?.wordmark ?? '',
  };

  const dispatch = (action: Action, arg: string) => {
    switch (action) {
      case 'signIn':
        signIn();
        return;
      case 'startQuick':
        startQuick();
        return;
      case 'cancelQuick':
        actions.cancelQuick();
        return;
      case 'goSecure':
        goSecure();
        return;
      default:
        host.dispatch(action, arg);
    }
  };
  const signedOutHost: SkinHost = { ...host, env: { ...host.env, auth: view }, dispatch };

  return (
    <AuthFormProvider values={fields.values} edit={fields.edit} submit={signIn}>
      <View style={{ flex: 1 }}>
        <SkinRoute host={signedOutHost} node={route} />
        {auth.phase === 'signed-out' ? <HostContext.Provider value={signedOutHost}>
          <View style={{ paddingHorizontal: 16, paddingBottom: Math.max(16, host.viewport.insets.bottom) }}>
            <Pill label={msg('connect.otherServer')} testID="signin-other-server" onPress={onConnect} />
          </View>
        </HostContext.Provider> : null}
      </View>
    </AuthFormProvider>
  );
}
