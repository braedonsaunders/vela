// What Connect a server and the server switcher draw, and what they ask for. The shapes are the
// session store's (packages/core: `s.servers`, `vela.servers.*`), restated here so the skin
// package does not depend on the data package; the app passes the store's values straight in.

/** A configured server, presentation-safe (no credentials). */
export interface ServerOption {
  id: string;
  name: string;
  origin?: string;
  basePath?: string;
  etherOrigin?: string;
  kind: string;
  kindLabel: string;
  selected: boolean;
  status: 'ready' | 'signed-out' | 'unreachable';
  viewer: string;
  /** Why it is not ready, in the viewer's words, or empty. */
  message: string;
}

export type ProbeState = '' | 'checking' | 'found' | 'invalid' | 'unreachable' | 'unsupported' | 'insecure';

/** What an address answered before any credential was sent. */
export interface ServerProbe {
  url: string;
  state: ProbeState;
  kind: string;
  kindLabel: string;
  name: string;
  version: string;
  normalizedUrl: string;
  machineIdentifier?: string;
  /** Why it cannot be added (invalid, unreachable, unsupported, insecure HTTP), or empty. */
  message: string;
}

export interface PlexChoice {
  id: string;
  name: string;
  owned: boolean;
  connectionLabel: string;
  recommended: boolean;
}

/** plex.tv linking: the PIN to enter at plex.tv/link, then the account's servers to choose from. */
export interface PlexLink {
  code: string;
  linkUrl: string;
  state: 'waiting' | 'linked' | 'expired' | 'failed' | 'profiles';
  choices: PlexChoice[];
  profiles?: { id: string; name: string; protected: boolean; avatarUrl?: string; restricted?: boolean }[];
}

/** A Jellyfin or Emby Quick Connect code waiting for approval on the server. */
export interface QuickCode {
  serverId: string;
  code: string;
  expiresLabel: string;
  status: 'pending' | 'expired' | 'denied';
}

export interface ServersView {
  list: ServerOption[];
  selectedId: string;
  plex: PlexLink | null;
  jellyfinQuick: QuickCode | null;
}

/** A server action's outcome: the server it concerns, or why it failed. */
export interface Outcome {
  note?: string;
  id: string;
  error: string;
}

export interface ServerActions {
  probe(url: string): Promise<ServerProbe>;
  add(kind: string, name: string, url: string, machineIdentifier?: string): Promise<Outcome>;
  select(id: string): Promise<Outcome>;
  remove(id: string): Promise<Outcome>;
  plexStart(): Promise<unknown>;
  plexChoose(choiceId: string): Promise<Outcome>;
  /** Sign in as one member of a linked Plex Home (state 'profiles'). */
  plexChooseProfile(id: string, pin?: string): Promise<Outcome>;
  plexCancel(): void;
  jellyfinSignIn(id: string, username: string, password: string): Promise<Outcome>;
  jellyfinQuickStart(id: string): Promise<unknown>;
  jellyfinQuickCancel(): void;
}
