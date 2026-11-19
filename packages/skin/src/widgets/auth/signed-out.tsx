// Every signed-out host draws the same server chooser and sign-in flow in its active skin UI.
import { HostContext, type SkinHost } from '../../host';
import type { RNode } from '../../resolve';
import { Connect } from './connect/connect';
import type { ServerActions, ServersView } from './connect/model';
import { Stage } from './stage';

/** The session's sign-in state for the selected server (packages/core, `s.auth`). */
export interface SessionAuth {
  phase: 'starting' | 'redeeming' | 'signed-out' | 'signed-in' | 'offline';
  serverId: string;
  serverKind: string;
  passwordAvailable: boolean;
  plexAvailable?: boolean;
  plex?: import('./connect/model').PlexLink | null;
  quickAvailable: boolean;
  secureOrigin: string;
  error: string;
  quick: null | { code: string; expiresLabel: string; status: 'pending' | 'expired' | 'denied' };
}

export interface AuthActions {
  retry?(): Promise<void>;
  signIn(username: string, password: string): Promise<unknown>;
  startPlex(): Promise<void>;
  cancelPlex(): void;
  startQuick(): Promise<unknown>;
  cancelQuick(): unknown;
  secureSwitch(): Promise<{ url: string; error: string }>;
}

export interface SignedOutProps {
  /** The host for the auth route: the active document, viewport and view state. */
  host: SkinHost;
  /** Retained for source compatibility; shared widgets own auth layout in every skin. */
  route: RNode;
  auth: SessionAuth;
  actions: AuthActions;
  servers: ServersView;
  serverActions: ServerActions;
  /** A server pack's stage art (image paths), when the server offers one. */
  art?: { backdrop: string; wordmark: string; name?: string };
}

export function SignedOut({ host, auth, actions, servers, serverActions, art }: SignedOutProps) {
  return <HostContext.Provider value={host}><Stage branding={art}>
    <Connect serverId={auth.serverId} servers={servers} actions={serverActions} auth={auth} authActions={actions} />
  </Stage></HostContext.Provider>;
}
