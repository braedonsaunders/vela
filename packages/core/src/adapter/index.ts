import type * as V from '../wire';

/**
 * The core contract: what every media server offers, in the v0 shapes. Anything only some
 * servers offer is an optional capability (`./capabilities`), found by presence, never a
 * method here that a server without it would have to stub.
 */
export interface ServerAdapter {
  /** The stored session's current form, or null once the server rejected it. A transient failure throws. */
  validateSession(): Promise<V.Tokens | null>;
  /** End the signed-in session at the server. */
  revokeSession(request: V.RevokeRequest): Promise<V.Ack>;

  /** Who the server is and what it states about its features (`./advertise` derives the rest). */
  describe(): Promise<ServerDescription>;

  /** The signed-in viewer's home: rows, heroes and the server's description. */
  home(fresh?: boolean, signal?: AbortSignal): Promise<Home>;
  rows(query: V.RowsQuery): Promise<V.Page<V.Row | V.SurfaceRow>>;
  row(id: string, cursor?: string, limit?: number): Promise<V.Row>;
  libraries(query: V.LibrariesQuery): Promise<V.Page<V.Library>>;
  library(id: string, query: V.LibraryBrowseQuery, options?: { fresh?: boolean; snapshot?: boolean }): Promise<V.LibraryContents>;
  collection(id: string, cursor?: string, limit?: number): Promise<V.CollectionContents>;
  detail(id: string, fresh?: boolean): Promise<V.TitleDetail>;
  /** Catalogue search by name. Search by description is the DescriptiveSearch capability. */
  search(request: CatalogueSearch, signal?: AbortSignal): Promise<V.SearchResponse>;

  /** A playback plan for a title, extra or channel; a server may ask to come back while an extra is prepared. */
  startPlayback(request: V.PlaybackRequest): Promise<V.PlaybackPlan | V.PlaybackPreparing>;
  /** The player's progress report for a session. */
  reportObservation(sessionId: string, observation: V.PlayerObservation): Promise<V.Ack>;
  /** Transport control. Track, path and fallback commands are capabilities (`./commands`). */
  command(sessionId: string, command: TransportCommand): Promise<V.PlaybackPlan>;
  /** The session's authoritative state, read on demand. */
  sessionSnapshot(sessionId: string): Promise<V.SessionSnapshot>;
}

/**
 * What a server states about itself. Its feature statements are only half of what is advertised:
 * a feature backed by an operation is available only when the adapter also implements it.
 */
export type ServerDescription = Omit<V.ServerCapabilities, 'features'> & {
  features: Partial<V.ServerCapabilities['features']>;
};

/** The v0 bootstrap, carrying the server's own description rather than advertised capabilities. */
export type Home = Omit<V.Bootstrap, 'capabilities'> & { capabilities: ServerDescription };

export type CatalogueSearch = Omit<V.SearchRequest, 'mode'>;

export type TransportCommand = Extract<V.SessionCommand, { kind: 'seek' | 'pause' | 'resume' | 'stop' }>;

/** The caller supplies stable mutation keys and persists every rotated token. */
export interface Credentials {
  get(): Promise<V.Tokens | null>;
  set(tokens: V.Tokens | null): Promise<void>;
  device: V.Device;
  refreshKey(): string;
}

/** A native server's media credentials, attached only by the trusted player host to requests
 * inside origin + pathPrefix. Ether has none: its broker grants carry their own authority. */
export interface MediaAccess {
  origin: string;
  pathPrefix: string;
  headers(): Promise<Record<string, string>>;
  /** A credentialed URL for one native-element attachment, minted on request and never stored. */
  nativeURL(url: string): Promise<string>;
}
