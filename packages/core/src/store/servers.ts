// The servers this app knows: the list with each one's status, detection of a typed address,
// adding, selecting, signing out of and removing a server, Plex linking through plex.tv, and
// Jellyfin/Emby sign-in (password or Quick Connect) for a chosen server. Presentation records
// only: no credential reaches this state.
import type { Connection } from '../adapter/connection';
import { hasPasswordSignIn, hasQuickConnectSignIn } from '../adapter/capabilities';
import { PlexLink, type PlexLinkState, type PlexProfileChoice } from '../adapter/plex/link';
import { probeEther, probeServer } from '../adapter/probe';
import type * as V from '../wire';
import { ServerCredentials, type ServerKind, type ServerRecord } from '../session/servers';
import { msg, time } from '../i18n';
import type { Downloads } from './downloads';
import { pageSecure, type VelaPlatform } from './platform';
import type { Session } from './session';
import { endSession, signInFailure, type QuickCode } from './auth';
import { message, type StateBox } from './state';
import type { VelaState } from './index';

export interface ServerOption {
  id: string;
  name: string;
  kind: ServerKind;
  kindLabel: string;
  origin: string;
  basePath: string;
  selected: boolean;
  status: 'ready' | 'signed-out' | 'unreachable';
  viewer: string;
  message: string;
  etherOrigin?: string;
}

export interface ProbeResult {
  url: string;
  state: 'found' | 'invalid' | 'unreachable' | 'unsupported' | 'insecure';
  kind: ServerKind | '';
  kindLabel: string;
  name: string;
  version: string;
  /** The address a record keeps: origin plus base path. */
  normalizedUrl: string;
  message: string;
}

export interface PlexChoiceOption {
  id: string;
  name: string;
  owned: boolean;
  connectionLabel: string;
  recommended: boolean;
}

export interface PlexLinkView {
  code: string;
  linkUrl: string;
  state: PlexLinkState;
  /** The account's servers, once linked. */
  choices: PlexChoiceOption[];
  /** A Plex Home's members, to choose who signs in (state 'profiles'). */
  profiles?: PlexProfileChoice[];
}

export interface ServersState {
  list: ServerOption[];
  selectedId: string;
  plex: PlexLinkView | null;
  jellyfinQuick: (QuickCode & { serverId: string }) | null;
}

export const initialServers: ServersState = { list: [], selectedId: 'ether', plex: null, jellyfinQuick: null };

/** The outcome of a server action: the server it concerned, or why it failed. */
export interface ServerResult {
  note?: string;
  id: string;
  error: string;
}

const PLEX_LINK_URL = 'https://plex.tv/link';
const PLEX_POLL_MS = 2000;

export function kindLabel(kind: ServerKind | ''): string {
  if (kind === 'ether') return 'Ether';
  if (kind === 'jellyfin') return 'Jellyfin';
  if (kind === 'emby') return 'Emby';
  if (kind === 'plex') return 'Plex';
  return '';
}

/** Race a server check against a bounded wait, so one dead server never holds the list. */
function bounded<T>(work: Promise<T>, ms = 6000): Promise<T> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Server did not answer')), ms));
  return Promise.race([work, timeout]);
}

export class Servers {
  private readonly etherProbes = new Map<string, Promise<string>>();
  private etherOrigin(record: ServerRecord): Promise<string> {
    if (record.kind === 'ether' || !this.session.servers.standalone) return Promise.resolve('');
    const key = record.origin;
    let result = this.etherProbes.get(key);
    if (!result) { result = probeEther(key).then(value => value?.origin ?? ''); this.etherProbes.set(key, result); }
    return result;
  }
  private plexLink: PlexLink | undefined;
  private plexDiscoveryAttempt = 0;
  private plexTimer: ReturnType<typeof setTimeout> | undefined;
  private jellyfin: { serverId: string; secret: string; expiresAt: number; timer?: ReturnType<typeof setTimeout> } | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly platform: VelaPlatform,
    private readonly downloads?: Downloads,
  ) {
    session.onReset(() => void this.refresh().catch(() => {}));
  }

  /** Re-read every server's status. Other servers' sessions are checked with a bounded wait. */
  async refresh(): Promise<void> {
    if (!this.session.hasServer()) {
      this.patch({ list: [], selectedId: '' });
      return;
    }
    const selected = this.session.selected();
    const registry = this.session.servers.read();
    const rows = await Promise.all(registry.servers.map(record => this.row(record, selected, registry.selectedId)));
    this.patch({ list: rows, selectedId: registry.selectedId });
  }

  private async row(record: ServerRecord, selected: Connection, selectedId: string): Promise<ServerOption> {
    const connection = this.session.connection(record.id);
    const stored = await this.session.tokens(connection);
    let reachable = true;
    let tokens = stored;
    if (stored && connection !== selected) {
      try {
        tokens = await bounded(connection.adapter.validateSession());
      } catch {
        reachable = false;
        tokens = await this.session.tokens(connection);
      }
    } else if (stored) {
      // The selected server's own check is the auth slice's: offline means it did not answer.
      reachable = this.box.get().auth.phase !== 'offline';
    }
    const status = !tokens ? 'signed-out' : reachable ? 'ready' : 'unreachable';
    const note = status === 'unreachable' ? msg('server.unreachable') : status === 'signed-out' ? msg('server.signedOut') : '';
    return {
      id: record.id,
      name: this.session.names.get(record.id) ?? record.name,
      kind: record.kind,
      kindLabel: kindLabel(record.kind),
      origin: record.origin,
      basePath: record.basePath,
      selected: record.id === selectedId,
      status,
      viewer: tokens?.viewer.name ?? '',
      message: note,
      etherOrigin: await this.etherOrigin(record),
    };
  }

  /** Identify what answers at a typed address, before any credential is sent. */
  async probe(url: string): Promise<ProbeResult> {
    const secure = pageSecure(this.platform);
    const probe = await probeServer(url, this.session.device, secure, this.session.servers.standalone);
    let note = '';
    if (probe.state !== 'found') {
      if (probe.kind === 'ether') note = msg('server.probe.vela');
      else if (probe.state === 'insecure') note = msg('server.probe.insecure', { url: probe.url });
      else note = msg(`server.probe.${probe.state}`);
    }
    return {
      url,
      state: probe.state,
      kind: probe.kind,
      kindLabel: kindLabel(probe.kind),
      name: probe.name,
      version: probe.version,
      normalizedUrl: probe.url,
      message: note,
    };
  }

  async select(id: string): Promise<ServerResult> {
    try {
      this.session.select(id);
      await this.refresh();
      return { id, error: '' };
    } catch (error) {
      return { id: '', error: message(error, 'Server not found') };
    }
  }

  async add(kind: ServerKind, name: string, url: string): Promise<ServerResult> {
    try {
      const ether = kind === 'ether' && this.session.servers.standalone;
      if (kind !== 'jellyfin' && kind !== 'emby' && kind !== 'plex' && !ether) throw new Error(msg('server.probe.unsupported'));
      if (pageSecure(this.platform) && /^http:/i.test(url.trim())) {
        throw new Error(msg('server.probe.insecure', { url: url.trim() }));
      }
      const record = this.session.servers.add(kind, name.trim() || kindLabel(kind), url);
      await this.refresh();
      return { id: record.id, error: '' };
    } catch (error) {
      return { id: '', error: message(error, 'Server could not be added') };
    }
  }

  /** Removing forgets the session either way; revocation is attempted while the server answers. */
  async remove(id: string): Promise<ServerResult> {
    try {
      if (id === 'ether') throw new Error('Cannot remove the default server');
      const connection = this.session.connection(id);
      try {
        await bounded(endSession(connection, this.session));
      } catch {
        // Unreachable: the local session is still forgotten.
      }
      await connection.credentials.set(null);
      await this.downloads?.removeServer(id);
      this.session.servers.remove(id);
      this.session.forget(id);
      this.session.selected();
      await this.refresh();
      return { id, error: '' };
    } catch (error) {
      return { id: '', error: message(error, 'Server could not be removed') };
    }
  }

  async signOut(id: string): Promise<ServerResult> {
    try {
      const connection = this.session.connection(id);
      const epoch = this.session.epoch;
      const stored = await this.session.tokens(connection);
      const viewerId = stored?.viewer.id || (connection === this.session.selected() ? this.box.get().auth.viewerId : '');
      await endSession(connection, this.session);
      if (viewerId) await this.downloads?.removeViewer(id, viewerId);
      if (connection === this.session.selected() && epoch === this.session.epoch) this.session.resetSession();
      else await this.refresh();
      return { id, error: '' };
    } catch (error) {
      return { id: '', error: signInFailure(error, 'Sign out failed') };
    }
  }

  // Plex: a plex.tv PIN, then a choice among the account's servers.

  async plexStart(): Promise<void> {
    this.plexCancel();
    const link = new PlexLink(this.session.device);
    this.plexLink = link;
    try {
      const pin = await link.start();
      if (this.plexLink !== link) return;
      this.patch({ plex: { code: pin.code, linkUrl: PLEX_LINK_URL, state: 'waiting', choices: [] } });
      this.schedulePlexPoll(link, pin.code);
    } catch {
      if (this.plexLink === link) this.patch({ plex: { code: '', linkUrl: PLEX_LINK_URL, state: 'failed', choices: [] } });
    }
  }

  private schedulePlexPoll(link: PlexLink, code: string, delay = PLEX_POLL_MS): void {
    this.plexTimer = setTimeout(() => void this.plexPoll(link, code), delay);
  }

  private async plexPoll(link: PlexLink, code: string): Promise<void> {
    if (this.plexLink !== link) return;
    let state: PlexLinkState;
    try {
      if (this.plexDiscoveryAttempt) {
        try { await link.refreshServers(code); } catch { /* Keep the linked choices during a transient cloud failure. */ }
      }
      state = await link.poll(code, Date.now());
    } catch {
      state = 'failed';
    }
    if (this.plexLink !== link) return;
    if (state === 'waiting') {
      this.schedulePlexPoll(link, code);
      return;
    }
    if (state === 'profiles') {
      this.patch({ plex: { code, linkUrl: PLEX_LINK_URL, state, choices: [], profiles: link.profiles(code) } });
      return;
    }
    const choices = state === 'linked' ? link.servers(code, pageSecure(this.platform)) : [];
    let retryDelay = 0;
    if (state === 'linked' && this.plexDiscoveryAttempt < 2 && !(await link.hasEtherServer(code, pageSecure(this.platform)))) {
      if (this.plexLink !== link) return;
      retryDelay = this.plexDiscoveryAttempt++ === 0 ? 3000 : 10000;
    }
    if (this.plexLink !== link) return;
    this.patch({
      plex: {
        code,
        linkUrl: PLEX_LINK_URL,
        state: retryDelay && !choices.length ? 'waiting' : state,
        choices: choices.map(c => ({
          id: c.id,
          name: c.name,
          owned: c.owned,
          connectionLabel: msg(`server.plex.${c.connection}`),
          recommended: c.recommended,
        })),
      },
    });
    if (retryDelay) this.schedulePlexPoll(link, code, retryDelay);
  }

  /** Sign in as one member of the linked Plex Home, then list the servers that member has. */
  async plexChooseProfile(id: string, pin?: string): Promise<ServerResult> {
    const link = this.plexLink;
    const code = this.box.get().servers.plex?.code;
    try {
      if (!link || !code) throw new Error(msg('server.plex.again'));
      await link.chooseProfile(code, id, pin);
      if (this.plexLink !== link) throw new Error(msg('server.plex.again'));
      this.plexDiscoveryAttempt = 0;
      await this.plexPoll(link, code);
      return { id: '', error: '' };
    } catch (error) {
      return { id: '', error: signInFailure(error, msg('server.plex.again')) };
    }
  }

  /** Add (or relocate) and select the chosen Plex server, proven by its own identity. */
  async plexChoose(serverId: string): Promise<ServerResult> {
    const link = this.plexLink;
    const code = this.box.get().servers.plex?.code;
    try {
      if (!link || !code) throw new Error(msg('server.plex.again'));
      const chosen = await link.choose(code, serverId, pageSecure(this.platform), { device: this.session.device, idempotencyKey: this.session.key() });
      if (this.plexLink !== link) throw new Error(msg('server.plex.again'));
      if (chosen.kind === 'ether') {
        const registry = this.session.servers;
        const record = registry.read().servers.find(s => s.kind === 'ether' && s.origin === chosen.origin)
          ?? registry.add('ether', chosen.name, chosen.origin);
        if (chosen.tokens) await this.signedIn(this.session.connection(record.id), chosen.tokens);
        else {
          this.session.select(record.id);
          await this.refresh();
        }
        this.plexCancel();
        return { id: record.id, error: '', ...(chosen.note ? { note: chosen.note } : {}) };
      }
      if (!chosen.tokens) throw new Error('Plex returned no server session');
      // A Plex record at the proven address, with the same machine identifier, or added by a typed
      // address (often the LAN one) becomes this server at its proven address without duplicating it.
      const registry = this.session.servers;
      const snapshot = registry.read();
      const list = snapshot.servers;
      const proven = list.find(s => s.kind === 'plex' && s.origin === chosen.origin);
      const matched = !proven && chosen.machineIdentifier
        ? list.find(s => s.kind === 'plex' && s.machineIdentifier === chosen.machineIdentifier)
        : undefined;
      let typed: ServerRecord | undefined;
      for (const s of list) {
        if (proven || matched || typed || s.kind !== 'plex' || !chosen.origins.includes(s.origin)) continue;
        if (!(await this.session.tokens(this.session.connection(s.id)))) typed = s;
      }
      let record = proven ?? matched;
      let originChanged = false;
      if (proven && chosen.machineIdentifier && proven.machineIdentifier !== chosen.machineIdentifier) {
        record = registry.relocate(proven.id, chosen.name, chosen.origin, chosen.machineIdentifier);
      } else if (!proven && matched) {
        originChanged = matched.origin !== chosen.origin;
        record = registry.relocate(matched.id, chosen.name, chosen.origin, chosen.machineIdentifier);
      } else if (!record && typed) {
        originChanged = typed.origin !== chosen.origin;
        record = registry.relocate(typed.id, chosen.name, chosen.origin, chosen.machineIdentifier);
      }
      if (!record) record = registry.add('plex', chosen.name, chosen.origin, chosen.machineIdentifier);
      const credentials = this.session.connection(record.id).credentials;
      await credentials.set(chosen.tokens);
      // Kept so this device can switch Plex Home members later; it never reaches the server.
      if (credentials instanceof ServerCredentials) await credentials.setPlexAccount(chosen.accountToken ?? null);
      this.plexCancel();
      const wasSelected = snapshot.selectedId === record.id;
      this.session.select(record.id);
      if (wasSelected) {
        if (originChanged) this.session.resetSelectedServer();
        else this.session.resetSession();
      }
      return { id: record.id, error: '' };
    } catch (error) {
      return { id: '', error: signInFailure(error, msg('server.plex.again')) };
    }
  }

  plexCancel(): void {
    this.plexDiscoveryAttempt = 0;
    if (this.plexTimer) clearTimeout(this.plexTimer);
    this.plexTimer = undefined;
    this.plexLink?.cancel();
    this.plexLink = undefined;
    if (this.box.get().servers.plex) this.patch({ plex: null });
  }

  // Jellyfin and Emby: password or Quick Connect against a chosen server.

  private jellyfinConnection(id: string): Connection {
    const connection = this.session.connection(id);
    const kind = connection.record.kind;
    if (kind !== 'jellyfin' && kind !== 'emby') throw new Error('Not a Jellyfin or Emby server');
    return connection;
  }

  async jellyfinSignIn(id: string, username: string, password: string): Promise<ServerResult> {
    try {
      const connection = this.jellyfinConnection(id);
      const adapter = connection.adapter;
      if (!hasPasswordSignIn(adapter)) throw new Error('Password sign-in is not offered by this server');
      const tokens = await adapter.signInWithPassword({
        username,
        password,
        device: this.session.device,
        idempotencyKey: this.session.key(),
      });
      await this.signedIn(connection, tokens);
      return { id, error: '' };
    } catch (error) {
      return { id: '', error: signInFailure(error, 'Sign in failed') };
    }
  }

  async jellyfinQuickStart(id: string): Promise<ServerResult> {
    this.jellyfinQuickCancel();
    try {
      const connection = this.jellyfinConnection(id);
      const adapter = connection.adapter;
      if (!hasQuickConnectSignIn(adapter)) throw new Error('Quick Connect is not offered by this server');
      const grant = await adapter.startQuickConnect({ device: this.session.device, idempotencyKey: this.session.key() });
      const current = { serverId: id, secret: grant.secret, expiresAt: Date.parse(grant.expiresAt) };
      this.jellyfin = current;
      this.patch({
        jellyfinQuick: {
          serverId: id,
          code: grant.code,
          expiresAt: grant.expiresAt,
          expiresLabel: time(Date.parse(grant.expiresAt)),
          status: 'pending',
        },
      });
      this.scheduleJellyfinPoll(current, grant.pollIntervalSeconds);
      return { id, error: '' };
    } catch (error) {
      return { id: '', error: signInFailure(error, 'Quick Connect failed') };
    }
  }

  private scheduleJellyfinPoll(current: NonNullable<Servers['jellyfin']>, seconds: number): void {
    const delay = Math.max(1, Number.isFinite(seconds) ? seconds : 5) * 1000;
    current.timer = setTimeout(() => void this.jellyfinPoll(current, seconds), delay);
  }

  private async jellyfinPoll(current: NonNullable<Servers['jellyfin']>, seconds: number): Promise<void> {
    if (this.jellyfin !== current) return;
    if (Number.isFinite(current.expiresAt) && Date.now() >= current.expiresAt) {
      this.jellyfinFinished(current, 'expired');
      return;
    }
    try {
      const connection = this.jellyfinConnection(current.serverId);
      const adapter = connection.adapter;
      if (!hasQuickConnectSignIn(adapter)) throw new Error('Quick Connect is not offered by this server');
      const result = await adapter.pollQuickConnect({
        secret: current.secret,
        device: this.session.device,
        idempotencyKey: this.session.key(),
      });
      if (this.jellyfin !== current) return;
      if (result.status === 'pending') {
        this.scheduleJellyfinPoll(current, seconds);
        return;
      }
      if (result.status !== 'approved') {
        this.jellyfinFinished(current, result.status);
        return;
      }
      this.jellyfin = undefined;
      this.patch({ jellyfinQuick: null });
      await this.signedIn(connection, result.tokens);
    } catch {
      if (this.jellyfin === current) this.jellyfinFinished(current, 'denied');
    }
  }

  private jellyfinFinished(current: NonNullable<Servers['jellyfin']>, status: 'expired' | 'denied'): void {
    this.jellyfin = undefined;
    const quick = this.box.get().servers.jellyfinQuick;
    if (quick && quick.serverId === current.serverId) this.patch({ jellyfinQuick: { ...quick, status } });
  }

  jellyfinQuickCancel(): void {
    if (this.jellyfin?.timer) clearTimeout(this.jellyfin.timer);
    this.jellyfin = undefined;
    if (this.box.get().servers.jellyfinQuick) this.patch({ jellyfinQuick: null });
  }

  /** A server signed in from the server list becomes the selected one. */
  private async signedIn(connection: Connection, tokens: V.Tokens): Promise<void> {
    await connection.credentials.set(tokens);
    if (this.session.selected() === connection) this.session.resetSession();
    else this.session.select(connection.record.id);
  }

  private patch(change: Partial<ServersState>): void {
    this.box.update('servers', servers => ({ ...servers, ...change }));
  }
}
