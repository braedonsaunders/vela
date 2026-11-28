// The selected server and its signed-in session: the server registry, one connection per
// record, the device identity, the client declaration (negotiation), stored-session validation
// and the epoch every answer is tagged with. When the session or the selected server changes,
// the epoch moves on and every slice drops what it read under the old one.
import type * as V from '../wire';
import type { ServerAdapter } from '../adapter';
import { capabilitiesOf } from '../adapter/advertise';
import { hasClientDeclaration, hasPasswordSignIn } from '../adapter/capabilities';
import { etherConnection, nativeConnection, type Connection } from '../adapter/connection';
import { EtherAdapter } from '../adapter/ether';
import { msg } from '../i18n';
import { randomId } from '../protocol/id';
import { cappedClient, type StreamingLimit } from '../streaming';
import { SessionCredentials } from '../session';
import { ServerCredentials, ServerRegistry, type ServerRecord } from '../session/servers';
import type { MediaCapabilities, VelaPlatform } from './platform';

/** `session`: the viewer signed in or out. `server`: another server was selected. */
export type ResetKind = 'session' | 'server';

export interface PlexRelocatorHandle {
  tryRelocate(connection: Connection, epoch: number, error: unknown, signal?: AbortSignal): Promise<boolean>;
}

/** A standalone app before its first server is added: nothing to read from or sign in to. */
export class NoServerError extends Error {
  constructor() {
    super('No server has been added');
    this.name = 'NoServerError';
  }
}

export class Session {
  /** Moves on whenever the session or the selected server changes; answers from an older epoch are dropped. */
  epoch = 0;
  /** The selected server's feature statements, as its home advertised them. */
  searchCapabilities: Pick<V.ServerCapabilities, 'searchSorts' | 'searchKinds' | 'searchLibraries'> | undefined;
  features: V.ServerCapabilities['features'] | undefined;
  /** A features read for a start that came before Home (knowFeatures), shared by starts in the same server session. */
  private featuresRead: { epoch: number; pending: Promise<V.ServerCapabilities['features'] | undefined> } | undefined;
  /** Server names as they describe themselves, by record ID. */
  readonly names = new Map<string, string>();

  private readonly platform: VelaPlatform;
  private readonly registry: ServerRegistry;
  private readonly connections = new Map<string, Connection>();
  private readonly resetListeners = new Set<(kind: ResetKind, refused?: boolean) => void>();
  private readonly serverSessionListeners = new Set<(id: string) => void>();
  private readonly forgetListeners = new Set<(id: string) => void>();
  private relocator: PlexRelocatorHandle | undefined;
  /** The server last read as selected: undefined before the first read, '' while there is none. */
  private activeId: string | undefined;
  private deviceValue: V.Device | undefined;
  private clientValue: V.ClientCapabilities | undefined;
  private streamingCap: StreamingLimit | null = null;
  private audioValue: MediaCapabilities | undefined;
  /** Settles once the player has said what it plays; negotiation and playback wait for it. */
  private readonly media: Promise<void>;
  private signingIn: Promise<void> | undefined;
  private validation: { token: string; pending: Promise<V.Tokens | null> } | undefined;
  private negotiation: { epoch: number; context: string; pending: Promise<void> } | undefined;

  /** The skin renderer this client draws, sent to Ether with screen reads (RENDERER_VERSION). */
  readonly rendererVersion: number | undefined;
  /** The Studio live preview token while this tab previews (screens.setPreview). */
  screenPreview: string | undefined;

  constructor(platform: VelaPlatform & { rendererVersion?: number }) {
    this.platform = platform;
    this.rendererVersion = platform.rendererVersion;
    this.registry = new ServerRegistry(platform.secrets, platform.etherOrigin ? validOrigin(platform.etherOrigin) : undefined);
    // A standalone app that starts with no server is already "on none", so the first server added
    // is a change of server that every slice hears.
    try {
      if (!this.hasServer()) this.activeId = '';
    } catch {
      // An unreadable registry fails where it is first used, as before.
    }
    // An audio engine that cannot say what it plays leaves audio sessions on the player's declaration.
    const audio = Promise.resolve(platform.audio).catch(() => undefined);
    this.media = Promise.all([platform.media, audio]).then(([media, engine]) => {
      this.audioValue = engine;
      this.setMedia(media);
    });
  }

  /** Attach the Plex relocation coordinator (wired once by createVela). */
  setRelocator(relocator: PlexRelocatorHandle): void {
    this.relocator = relocator;
  }

  /** Try to relocate an unreachable directly linked Plex server; resolves true if relocated and reset. */
  relocatePlex(connection: Connection, epoch: number, error: unknown, signal?: AbortSignal): Promise<boolean> {
    return this.relocator?.tryRelocate(connection, epoch, error, signal) ?? Promise.resolve(false);
  }

  /** This install's stable device: its ID is kept with the secrets. */
  get device(): V.Device {
    if (!this.deviceValue) {
      let id = this.platform.secrets.get('vela.device');
      if (!id || id.length < 16 || id.length > 128) {
        id = randomId();
        this.platform.secrets.set('vela.device', id);
      }
      const { name, platform } = this.platform.device;
      this.deviceValue = { id, name, platform, appVersion: this.platform.appVersion };
    }
    return this.deviceValue;
  }

  /** What this client declares it can play; unavailable until the player has said. */
  get client(): V.ClientCapabilities {
    if (!this.clientValue) throw new Error('Media capabilities are unavailable');
    return cappedClient(serverFeatures(this.clientValue, this.features), this.streamingCap);
  }

  /** What an audio session declares (music, audiobooks, podcasts): what the app's audio engine plays,
   * on this device. The player's declaration where the platform names no separate audio engine.
   * The video streaming cap is not an audio limit. */
  get audioClient(): V.ClientCapabilities {
    if (!this.clientValue) throw new Error('Media capabilities are unavailable');
    const client = this.clientValue;
    return this.audioValue ? { device: client.device, protocolVersions: client.protocolVersions, ...this.audioValue } : client;
  }

  /** The viewer's streaming cap on the network in use (null: the original); later starts declare it. */
  setStreamingLimit(limit: StreamingLimit | null): void {
    this.streamingCap = limit;
  }

  /** The client declaration, once the player has said what it plays. */
  async declared(): Promise<V.ClientCapabilities> {
    await this.media;
    return this.client;
  }

  /**
   * What the device can decode, without the viewer's streaming cap: a download keeps the original file
   * for later, so the network-quality preset (480p on mobile data, say) must not rule out the very file it
   * is fetching. The server still applies its own download ceilings.
   */
  async declaredForDownload(): Promise<V.ClientCapabilities> {
    await this.media;
    if (!this.clientValue) throw new Error('Media capabilities are unavailable');
    return serverFeatures(this.clientValue, this.features);
  }

  get servers(): ServerRegistry {
    return this.registry;
  }

  /** A fresh idempotency key for one operation. */
  key(): string {
    return randomId();
  }

  /** `refused`: the server refused the stored session (its refresh token), so it ended. */
  onReset(listener: (kind: ResetKind, refused?: boolean) => void): () => void {
    this.resetListeners.add(listener);
    return () => this.resetListeners.delete(listener);
  }

  /** Hear when a server record is removed so server-scoped preferences can be pruned. */
  onForget(listener: (id: string) => void): () => void {
    this.forgetListeners.add(listener);
    return () => this.forgetListeners.delete(listener);
  }

  onServerSessionChange(listener: (id: string) => void): void {
    this.serverSessionListeners.add(listener);
  }

  serverSessionChanged(id: string): void {
    for (const listener of this.serverSessionListeners) listener(id);
  }

  /** The viewer signed in or out: everything read for the previous viewer is dropped. */
  resetSession(): void {
    this.epoch++;
    for (const connection of this.connections.values()) {
      const adapter = connection.adapter;
      if ('resetOptionalCapabilities' in adapter && typeof adapter.resetOptionalCapabilities === 'function') adapter.resetOptionalCapabilities();
    }
    this.signingIn = undefined;
    this.negotiation = undefined;
    for (const listener of [...this.resetListeners]) listener('session');
  }

  /** Reset the currently selected server (e.g. after re-linking it at a new address). */
  resetSelectedServer(): void {
    this.resetServer();
  }

  /** Update a saved server's address in place (keeping ID and session) and reset once if selected. */
  relocateServer(id: string, name: string, url: string, machineIdentifier?: string): ServerRecord {
    const record = this.registry.relocate(id, name, url, machineIdentifier);
    this.connections.delete(id);
    if (this.activeId === id || (this.activeId === undefined && this.registry.read().selectedId === id)) {
      this.activeId = id;
      this.resetServer();
    }
    return record;
  }

  private resetServer(refused = false): void {
    this.epoch++;
    this.signingIn = undefined;
    this.validation = undefined;
    this.negotiation = undefined;
    this.features = undefined;
    this.searchCapabilities = undefined;
    for (const listener of [...this.resetListeners]) listener('server', refused);
  }

  /** The connection for one record. A record whose address changed gets a new connection. */
  connection(id: string): Connection {
    const record = this.registry.get(id);
    const known = this.connections.get(id);
    if (known && JSON.stringify(known.record) === JSON.stringify(record)) return known;
    const rejected = () => {
      if (this.activeId === id) this.resetServer(true);
      else this.serverSessionChanged(id);
    };
    let made: Connection;
    if (record.kind === 'ether') {
      // The implicit server keeps the original session key; an added Ether server has its own.
      const credentials = id === 'ether'
        ? new SessionCredentials(this.platform.secrets, this.device, () => this.key())
        : new ServerCredentials(this.platform.secrets, this.device, () => this.key(), id);
      const context = this.clientValue ? JSON.stringify(this.clientValue) : '';
      const adapter = new EtherAdapter(record.origin, credentials, context, rejected, this.rendererVersion, () => this.screenPreview);
      made = etherConnection(record, adapter, credentials, this.registry.standalone);
    } else {
      const credentials = new ServerCredentials(this.platform.secrets, this.device, () => this.key(), id);
      made = nativeConnection(record, credentials, rejected);
    }
    this.connections.set(id, made);
    return made;
  }

  /** Whether any server is known; a standalone app starts with none. */
  hasServer(): boolean {
    return this.registry.read().servers.length > 0;
  }

  /** The selected server. A selection changed since the last read resets that server's state. */
  selected(): Connection {
    const selectedId = this.registry.read().selectedId;
    if (!selectedId) {
      this.activeId = '';
      throw new NoServerError();
    }
    if (selectedId !== this.activeId) {
      // Recorded before the reset, so listeners that read the selected server see the new one. The
      // first server added to a standalone app is a change too (from none).
      const previous = this.activeId;
      this.activeId = selectedId;
      if (previous !== undefined) this.resetServer();
    }
    return this.connection(selectedId);
  }

  clearSelection(): void {
    if (this.activeId === '') return;
    this.activeId = '';
    this.resetServer();
  }

  select(id: string): Connection {
    this.registry.select(id);
    return this.selected();
  }

  /** Forget a removed server's connection. */
  forget(id: string): void {
    this.connections.delete(id);
    this.serverSessionChanged(id);
    for (const listener of [...this.forgetListeners]) listener(id);
  }

  tokens(connection: Connection): Promise<V.Tokens | null> {
    return connection.credentials.get();
  }

  /**
   * The server's features, read once per server session when no Home read has brought them yet: a watch opened by
   * a deep link starts before Home, and what the client declares (adaptive HLS) depends on them.
   */
  async knowFeatures(api: ServerAdapter): Promise<void> {
    if (this.features) return;
    const epoch = this.epoch;
    const reading = this.featuresRead?.epoch === epoch ? this.featuresRead.pending
      : (this.featuresRead = { epoch, pending: capabilitiesOf(api).then(c => c.features, () => undefined) }).pending;
    const features = await reading;
    if (epoch === this.epoch && !this.features && features) this.features = features;
  }

  /** The player declares new media capabilities: servers that tailor plans to them are told again. */
  setMedia(media: MediaCapabilities): void {
    const updated = { device: this.device, protocolVersions: [0], ...media };
    const context = JSON.stringify(updated);
    if (this.clientValue && context === JSON.stringify(this.clientValue)) return;
    this.clientValue = updated;
    for (const known of this.connections.values()) known.setCapabilityContext?.(context);
  }

  /** The selected server with a settled, signed-in session; every authenticated read waits for this. */
  async ready(): Promise<Connection> {
    const connection = this.selected();
    if (!this.signingIn) {
      const pending = this.signInIfDemo(connection);
      this.signingIn = pending;
      pending.catch(() => {
        if (this.signingIn === pending) this.signingIn = undefined;
      });
    }
    await this.signingIn;
    // A stored session may be revalidating or rotating while reads start: they use the settled one.
    if (this.validation) await this.validation.pending;
    if (!(await this.tokens(connection))) throw new Error(this.signInMessage(connection));
    if (this.selected() !== connection) throw new Error('Server changed');
    return connection;
  }

  /** Development only: the mock Ether server signs in as its demo viewer until the viewer signs out. */
  private async signInIfDemo(connection: Connection): Promise<void> {
    if (await this.tokens(connection)) return;
    const adapter = connection.adapter;
    const demo = this.platform.mock && connection.record.id === 'ether'
      && this.platform.secrets.get('vela.session') !== '';
    if (!demo || !hasPasswordSignIn(adapter)) throw new Error(this.signInMessage(connection));
    const tokens = await adapter.signInWithPassword({
      idempotencyKey: this.key(),
      username: 'demo',
      password: 'vela',
      device: this.device,
    });
    await connection.credentials.set(tokens);
  }

  /** Whether the demo sign-in applies (development builds against mock-server). */
  demoSignIn(connection: Connection): boolean {
    return !!this.platform.mock && connection.record.id === 'ether'
      && this.platform.secrets.get('vela.session') === null;
  }

  signInMessage(connection: Connection): string {
    if (connection.record.kind === 'ether') return msg('server.signInVela');
    const name = this.names.get(connection.record.id) ?? connection.record.name;
    return msg('server.signIn', { name });
  }

  /**
   * Validate the selected server's stored session once per credential (Ether rotates it). A
   * transient failure throws; a rejected session is cleared by the adapter, which resets.
   */
  validate(connection: Connection, stored: V.Tokens): Promise<V.Tokens | null> {
    const token = `${connection.record.id}:${stored.refreshToken || stored.accessToken}`;
    if (!this.validation || this.validation.token !== token) {
      const current = { token, pending: Promise.resolve<V.Tokens | null>(null) };
      current.pending = connection.adapter.validateSession().then(result => {
        if (this.validation === current && result) {
          current.token = `${connection.record.id}:${result.refreshToken || result.accessToken}`;
        }
        return result;
      }).catch(error => {
        // Failed network validation must be attempted again after the server returns.
        if (this.validation === current) this.validation = undefined;
        throw error;
      });
      this.validation = current;
    }
    return this.validation.pending;
  }

  /** Declare the client to a server that tailors plans to it, once per session and declaration. */
  async negotiate(api: ServerAdapter): Promise<void> {
    await this.media;
    if (!hasClientDeclaration(api)) return;
    for (;;) {
      const epoch = this.epoch;
      const context = JSON.stringify(this.client);
      const current = this.negotiation;
      if (current && (current.epoch !== epoch || current.context !== context)) {
        try {
          await current.pending;
        } catch {
          // A newer declaration still needs its own negotiation.
        }
        if (this.negotiation === current) this.negotiation = undefined;
        if (epoch !== this.epoch) throw new Error('Session changed during negotiation');
        continue;
      }
      if (!current) {
        const next = { epoch, context, pending: Promise.resolve() };
        next.pending = api.declareClient({ client: this.client, idempotencyKey: this.key() })
          .then(() => {
            if (this.epoch !== epoch) throw new Error('Session changed during negotiation');
          })
          .catch(error => {
            if (this.negotiation === next) this.negotiation = undefined;
            throw error;
          });
        this.negotiation = next;
      }
      await this.negotiation!.pending;
      if (epoch !== this.epoch) throw new Error('Session changed during negotiation');
      if (context === JSON.stringify(this.client)) return;
    }
  }

  /** Throw when the epoch moved on while a read was in flight. */
  check(epoch: number, what: string): void {
    if (epoch !== this.epoch) throw new Error(`Session changed during ${what}`);
  }
}

/** The Ether origin must be a bare http(s) origin: no path, credentials, query or fragment. */
function validOrigin(candidate: string): string {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Server origin is unavailable');
  }
  const bare = !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash;
  if (!['http:', 'https:'].includes(parsed.protocol) || !bare) throw new Error('Invalid server origin');
  return parsed.origin;
}

/** A player's features as far as the server offers them: an adaptive-HLS declaration goes only to a server with
 * features.adaptiveHLS, so an older one never sees a field it does not know. */
export function serverFeatures(client: V.ClientCapabilities, features: Partial<V.ServerCapabilities['features']> | undefined): V.ClientCapabilities {
  if (!client.features) return client;
  const { features: declared, ...rest } = client;
  const adaptiveHLS = declared.adaptiveHLS && features?.adaptiveHLS?.available === true;
  return adaptiveHLS ? { ...rest, features: { adaptiveHLS: true } } : rest;
}
