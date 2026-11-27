// The viewer's servers, for widgets that switch between them (the profile menu's switcher). The
// app provides the session store's server list and actions here, and how to open Connect.
import { createContext, useContext, type ReactNode } from 'react';
import type { ServerActions, ServersView } from './connect/model';

export interface ServerSwitch {
  servers: ServersView;
  actions: ServerActions;
  selectServer?: ServerActions['select'];
  /** Owner-facing identity for the selected server. */
  brandingName?: string;
  /** Open Connect a server, to add one. */
  openConnect(): void;
  openDownloads?(): void;
  /** Validated same-host HTTP(S) return address supplied by the web host. */
  consoleUrl?: string;
}

const ServersContext = createContext<ServerSwitch | null>(null);

export function useServerSwitch(): ServerSwitch | null {
  return useContext(ServersContext);
}

/** Wraps the app always (null while signed out), so the tree never remounts on sign-in. */
export function ServersProvider({ value, children }: { value: ServerSwitch | null; children: ReactNode }) {
  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}
