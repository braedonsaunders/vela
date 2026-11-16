// The viewer's servers, for widgets that switch between them (the profile menu's switcher). The
// app provides the session store's server list and actions here, and how to open Connect.
import { createContext, useContext, type ReactNode } from 'react';
import type { ServerActions, ServersView } from './connect/model';

export interface ServerSwitch {
  servers: ServersView;
  actions: ServerActions;
  /** Open Connect a server, to add one. */
  openConnect(): void;
}

const ServersContext = createContext<ServerSwitch | null>(null);

export function useServerSwitch(): ServerSwitch | null {
  return useContext(ServersContext);
}

export function ServersProvider({ value, children }: { value: ServerSwitch; children: ReactNode }) {
  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}
