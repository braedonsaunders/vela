// The selected server and its signed-in session: the server registry, one connection per
// record, the device identity, the client declaration (negotiation), stored-session validation
// and the epoch every answer is tagged with. When the session or the selected server changes,
// the epoch moves on and every slice drops what it read under the old one.
import type * as V from '../wire';
import type { ServerAdapter } from '../adapter';
import { hasClientDeclaration, hasPasswordSignIn } from '../adapter/capabilities';
import { etherConnection, nativeConnection, type Connection } from '../adapter/connection';
import { EtherAdapter } from '../adapter/ether';
import { msg } from '../i18n';
import { randomId } from '../protocol/id';
import { SessionCredentials } from '../session';
import { ServerCredentials, ServerRegistry } from '../session/servers';
import type { VelaPlatform } from './platform';

/** `session`: the viewer signed in or out. `server`: another server was selected. */
export type ResetKind = 'session' | 'server';

export class Session {
  /** Moves on whenever the session or the selected server changes; answers from an older epoch are dropped. */
  epoch = 0;
  /** The selected server's feature statements, as its home advertised them. */
  features: V.ServerCapabilities['features'] | undefined;
  /** Server names as they describe themselves, by record ID. */
  readonly names = new Map<string, string>();

  private readonly platform: VelaPlatform;
  private readonly registry: ServerRegistry;
  private readonly connections = new Map<string, Connection>();
  private readonly resetListeners = new Set<(kind: ResetKind) => void>();
  private activeId = '';
  private deviceValue: V.Device | undefined;
  private clientValue: V.ClientCapabilities;
  private signingIn: Promise<void> | undefined;
  private validation: { token: string; pending: Promise<V.Tokens | null> } | undefined;
  private negotiation: { epoch: number; context: string; pending: Promise<void> } | undefined;

  constructor(platform: VelaPlatform) {
    this.platform = platform;
    this.registry = new ServerRegistry(platform.secrets, validOrigin(platform.etherOrigin));
    this.clientValue = { device: this.device, protocolVersions: [0], ...platform.media };
  }

  /** This install's stable device: its ID is kept with the secrets. */
  get device(): V.Device {
    if (!this.deviceValue) {
      let id = this.platform.secrets.get('vela.device');
      if (!id) {
        id = randomId();
        this.platform.secrets.set('vela.device', id);
      }
      const { name, platform } = this.platform.device;
      this.deviceValue = { id, name, platform, appVersion: this.platform.appVersion };
    }
    return this.deviceValue;
  }

  /** What this client declares it can play. */
  get client(): V.ClientCapabilities {
    return this.clientValue;
  }

  get servers(): ServerRegistry {
    return this.registry;
  }

  /** A fresh idempotency key for one operation. */
  key(): string {
    return randomId();
  }

  onReset(listener: (kind: ResetKind) => void): () => void {
    this.resetListeners.add(listener);
    return () => this.resetListeners.delete(listener);
  }

  /** The viewer signed in or out: everything read for the previous viewer is dropped. */
  resetSession(): void {
    this.epoch++;
    this.signingIn = undefined;
    this.negotiation = undefined;
    for (const listener of [...this.resetListeners]) listener('session');
  }

  private resetServer(): void {
    this.epoch++;
    this.signingIn = undefined;
    this.validation = undefined;
    this.negotiation = undefined;
    this.features = undefined;
    for (const listener of [...this.resetListeners]) listener('server');
  }

  /** The connection for one record. A record whose address changed gets a new connection. */
  connection(id: string): Connection {
    const record = this.registry.get(id);
    const known = this.connections.get(id);
    if (known && JSON.stringify(known.record) === JSON.stringify(record)) return known;
    const rejected = () => {
      if (this.activeId === id) this.resetServer();
    };
    let made: Connection;
    if (record.kind === 'ether') {
      const credentials = new SessionCredentials(this.platform.secrets, this.device, () => this.key());
      const adapter = new EtherAdapter(record.origin, credentials, JSON.stringify(this.client), rejected);
      made = etherConnection(record, adapter, credentials);
    } else {
      const credentials = new ServerCredentials(this.platform.secrets, this.device, () => this.key(), id);
      made = nativeConnection(record, credentials, rejected);
    }
    this.connections.set(id, made);
    return made;
  }

  /** The selected server. A selection changed since the last read resets that server's state. */
  selected(): Connection {
    const selectedId = this.registry.read().selectedId;
    if (selectedId !== this.activeId) {
      // Recorded before the reset, so listeners that read the selected server see the new one.
      const previous = this.activeId;
      this.activeId = selectedId;
      if (previous) this.resetServer();
    }
    return this.connection(selectedId);
  }

  select(id: string): Connection {
    this.registry.select(id);
    return this.selected();
  }

  /** Forget a removed server's connection. */
  forget(id: string): void {
    this.connections.delete(id);
  }

  tokens(connection: Connection): Promise<V.Tokens | null> {
    return connection.credentials.get();
  }

  /** The player declares new media capabilities: servers that tailor plans to them are told again. */
  setMedia(media: VelaPlatform['media']): void {
    const updated = { device: this.device, protocolVersions: [0], ...media };
    const context = JSON.stringify(updated);
    if (context === JSON.stringify(this.clientValue)) return;
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
    const demo = this.platform.mock && connection.record.kind === 'ether'
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
    return !!this.platform.mock && connection.record.kind === 'ether'
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
      });
      this.validation = current;
    }
    return this.validation.pending;
  }

  /** Declare the client to a server that tailors plans to it, once per session and declaration. */
  async negotiate(api: ServerAdapter): Promise<void> {
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
