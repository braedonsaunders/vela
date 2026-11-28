// The servers this app knows: the list with each one's status, detection of a typed address,
// adding, selecting, signing out of and removing a server, Plex linking through plex.tv, and
// Jellyfin/Emby sign-in (password or Quick Connect) for a chosen server. Presentation records
// only: no credential reaches this state.
import type { Connection } from '../adapter/connection';
import { hasPasswordSignIn, hasQuickConnectSignIn } from '../adapter/capabilities';
import { PlexLink, type PlexLinkState, type PlexProfileChoice } from '../adapter/plex/link';
import { probeEther, probePlexMachine, probeServer } from '../adapter/probe';
import type * as V from '../wire';
import { ServerCredentials, type ServerKind, type ServerRecord } from '../session/servers';
import { msg, time } from '../i18n';
import type { Downloads } from './downloads';
import { pageSecure, type VelaPlatform } from './platform';
import type { Session } from './session';
import { endSession, signInFailure, type QuickCode } from './auth';
import { message, type StateBox } from './state';
import type { VelaState } from './index';
import { etherAliasMerges } from './ether-aliases';

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
  machineIdentifier?: string;
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

  private refreshRun = 0;
  private readonly forgetting = new Map<string, Promise<void>>();
  private readonly plexIdentity = new Map<string, Promise<string | undefined>>();

  private async plexEntry(record: ServerRecord) {
    const tokens = await this.session.tokens(this.session.connection(record.id));
    let machine = record.machineIdentifier;
    // Old address entry saved this generic row before authentication. Prove its identity before
    // treating it as an alias: another Plex server can also have the default display name.
    if (!machine && !tokens && record.name === kindLabel('plex')) {
      let identity = this.plexIdentity.get(record.origin);
      if (!identity) {
        identity = probePlexMachine(record.origin, this.session.device, pageSecure(this.platform));
        this.plexIdentity.set(record.origin, identity);
        void identity.finally(() => this.plexIdentity.delete(record.origin));
      }
      machine = await identity;
    }
    return { record, machine, viewer: tokens?.viewer.id };
  }

  private async prunePlexAliases(records: ServerRecord[], selectedId: string, run: number): Promise<void> {
    const plex = records.filter(record => record.kind === 'plex');
    if (plex.length < 2 || !plex.some(record => record.machineIdentifier)) return;
    const entries = await Promise.all(plex.map(record => this.plexEntry(record)));
    // Prefer the selected record, then a signed-in record, then a record with a saved identity.
    entries.sort((a, b) => Number(b.record.id === selectedId) - Number(a.record.id === selectedId)
      || Number(!!b.viewer) - Number(!!a.viewer)
      || Number(!!b.record.machineIdentifier) - Number(!!a.record.machineIdentifier));
    const kept: typeof entries = [];
    for (const entry of entries) {
      if (run !== this.refreshRun || this.plexLink) break;
      const duplicate = entry.record.id !== selectedId && entry.machine && kept.some(other =>
        other.record.machineIdentifier === entry.machine && (!entry.viewer || other.viewer === entry.viewer));
      if (!duplicate) {
        kept.push(entry);
        continue;
      }
      // Only clear local state. The surviving row may use the very same Plex credential.
      const current = this.session.servers.read();
      if (current.selectedId !== entry.record.id && current.servers.some(record => record.id === entry.record.id)) {
        await this.forgetServer(entry.record.id);
      }
    }
  }

  private etherMerge: Promise<void> = Promise.resolve();

  private reconcileEther(preferredId?: string): Promise<void> {
    const work = this.etherMerge.then(async () => {
      const registry = this.session.servers;
      if (!registry.standalone) return;
      const snapshot = registry.read();
      const records = snapshot.servers.filter(record => record.kind === 'ether' && record.basePath === '/');
      if (!records.length || (records.length === 1 && !preferredId && snapshot.etherIds?.[records[0]!.id])) return;
      const entries = await Promise.all(records.map(async record => {
        const capabilities = await probeEther(record.origin);
        const current = registry.read();
        if (!current.servers.some(saved => saved.id === record.id && saved.origin === record.origin)) {
          return { record, serverId: '', signedIn: false, working: false };
        }
        const knownId = current.etherIds?.[record.id];
        const signedIn = !!await this.session.tokens(this.session.connection(record.id));
        // A signed-in address now answering for a different server cannot identify that session.
        if (capabilities && knownId && knownId !== capabilities.id && signedIn) {
          return { record, serverId: '', signedIn, working: false };
        }
        if (capabilities) registry.rememberEtherIdentity(record, capabilities.id);
        return { record, serverId: capabilities?.id ?? knownId ?? '', signedIn, working: !!capabilities };
      }));
      const selectedId = registry.read().selectedId;
      for (const merge of etherAliasMerges(entries, selectedId, preferredId)) {
        const ids = new Set(registry.read().servers.map(record => record.id));
        if (merge.aliases.some(record => !ids.has(record.id))) continue;
        const aliases = merge.aliases.map(record => this.session.connection(record.id));
        if (!registry.mergeEther(merge.keep, merge.address, merge.aliases)) continue;
        if (selectedId === merge.keep.id && merge.keep.origin !== merge.address.origin) this.session.resetSelectedServer();
        else this.session.selected();
        // The surviving credentials may share the same server session. Only clear local aliases.
        for (const alias of aliases) {
          this.session.forget(alias.record.id);
          await alias.credentials.set(null);
        }
      }
    });
    this.etherMerge = work.catch(() => {});
    return work;
  }

  /** Re-read every server's status. Other servers' sessions are checked with a bounded wait. */
  async refresh(): Promise<void> {
    const run = ++this.refreshRun;
    if (!this.session.hasServer()) {
      this.patch({ list: [], selectedId: '' });
      return;
    }
    await this.reconcileEther();
    if (run !== this.refreshRun) return;
    const selected = this.session.selected();
    const registry = this.session.servers.read();
    this.patch({ selectedId: registry.selectedId });
    await this.prunePlexAliases(registry.servers, registry.selectedId, run);
    if (run !== this.refreshRun) return;
    const records = this.session.servers.read().servers;
    const rows = await Promise.all(records.map(record => this.row(record, selected, registry.selectedId)));
    if (run !== this.refreshRun) return;
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
    const detected = await probeServer(url, this.session.device, secure, true);
    const probe = detected.state === 'found' && detected.kind === 'ether' && !this.session.servers.canAddEther(detected.url)
      ? { ...detected, state: 'unsupported' as const } : detected;
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
      machineIdentifier: probe.machineIdentifier,
      message: note,
    };
  }

  has(id: string): boolean {
    return this.session.servers.read().servers.some(record => record.id === id);
  }

  async select(id: string): Promise<ServerResult> {
    try {
      const forgetting = this.forgetting.get(id);
      if (forgetting) await forgetting;
      this.session.select(id);
      await this.refresh();
      return { id, error: '' };
    } catch (error) {
      return { id: '', error: message(error, 'Server not found') };
    }
  }

  async add(kind: ServerKind, name: string, url: string, machineIdentifier?: string): Promise<ServerResult> {
    try {
      const ether = kind === 'ether' && this.session.servers.canAddEther(url);
      if (kind !== 'jellyfin' && kind !== 'emby' && kind !== 'plex' && !ether) throw new Error(msg('server.probe.unsupported'));
      if (pageSecure(this.platform) && /^http:/i.test(url.trim())) {
        throw new Error(msg('server.probe.insecure', { url: url.trim() }));
      }
      const registry = this.session.servers;
      const known = kind === 'plex' && machineIdentifier
        ? registry.read().servers.find(record => record.machineIdentifier === machineIdentifier)
        : undefined;
      const record = known ?? registry.add(kind, name.trim() || kindLabel(kind), url, machineIdentifier);
      if (ether) await this.reconcileEther(record.id);
      const saved = ether ? registry.read().servers.find(candidate => candidate.kind === 'ether'
        && candidate.origin === record.origin && candidate.basePath === record.basePath) : record;
      await this.refresh();
      return { id: saved?.id ?? record.id, error: '' };
    } catch (error) {
      return { id: '', error: message(error, 'Server could not be added') };
    }
  }

  /** Removing forgets the session either way; revocation is attempted while the server answers. */
  async remove(id: string): Promise<ServerResult> {
    try {
      if (id === 'ether' && this.session.servers.read().selectedId === id) throw new Error('Cannot remove the selected host server');
      const connection = this.session.connection(id);
      try {
        await bounded(endSession(connection, this.session));
      } catch {
        // Unreachable: the local session is still forgotten.
      }
      await this.forgetServer(id);
      if (this.session.hasServer()) this.session.selected();
      else this.session.clearSelection();
      await this.refresh();
      return { id, error: '' };
    } catch (error) {
      return { id: '', error: message(error, 'Server could not be removed') };
    }
  }

  private async forgetServer(id: string): Promise<void> {
    const pending = this.forgetting.get(id);
    if (pending) return pending;
    const work = (async () => {
      await this.session.connection(id).credentials.set(null);
      await this.downloads?.removeServer(id);
      this.session.servers.remove(id);
      this.session.forget(id);
    })();
    this.forgetting.set(id, work);
    try { await work; } finally { this.forgetting.delete(id); }
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
      else {
        this.session.serverSessionChanged?.(id);
        await this.refresh();
      }
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
      const tokens = chosen.tokens;
      if (!tokens) throw new Error('Plex returned no server session');
      // A Plex record at the proven address, with the same machine identifier, or added by a typed
      // address (often the LAN one) becomes this server at its proven address without duplicating it.
      const registry = this.session.servers;
      const snapshot = registry.read();
      const plex = snapshot.servers.filter(s => s.kind === 'plex');
      const proven = plex.find(s => s.origin === chosen.origin);
      const entries = proven ? [] : await Promise.all(plex.map(record => this.plexEntry(record)));
      if (this.plexLink !== link) throw new Error(msg('server.plex.again'));
      const aliases = entries.filter(({ record, machine, viewer }) =>
        machine ? machine === chosen.machineIdentifier
          : !viewer && chosen.origins.includes(record.origin));
      const existing = proven ?? aliases.find(({ record }) => record.id === snapshot.selectedId)?.record
        ?? aliases.find(({ viewer }) => viewer === tokens.viewer.id)?.record ?? aliases[0]?.record;
      const originChanged = !!existing && existing.origin !== chosen.origin;
      const record = existing
        ? registry.relocate(existing.id, chosen.name, chosen.origin, chosen.machineIdentifier)
        : registry.add('plex', chosen.name, chosen.origin, chosen.machineIdentifier);
      const credentials = this.session.connection(record.id).credentials;
      await credentials.set(tokens);
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
