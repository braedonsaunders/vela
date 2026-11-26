// Signing in to the selected server: its sign-in options, password and Quick Connect sign-in,
// the web's sign-in link (a one-time code redeemed at start), the hand-off to the server's
// secure origin, and sign-out. Quick Connect polling runs here, at the server's interval.
import { createPlexPin, plexAuthUrl, pollPlexPin, plexHomeUsers, PlexAccountRefused } from '../adapter/plex/auth';
import { plexServerProfiles, switchPlexServerProfile } from '../adapter/plex/home';
import { beginPlexHomeSignIn, exchangePlexAccount, selectPlexHomeProfile } from '../adapter/ether/plex';
import type * as V from '../wire';
import type { Connection } from '../adapter/connection';
import { capabilitiesOf } from '../adapter/advertise';
import { hasEventStream, hasPasswordSignIn, hasQuickConnectSignIn, hasWebCodeSignIn } from '../adapter/capabilities';
import { VelaError } from '../adapter/errors';
import { EtherAdapter } from '../adapter/ether';
import { refusesSession, serverWait } from '../adapter/ether/transport';
import { ServerCredentials, type ServerKind } from '../session/servers';
import { msg, time } from '../i18n';
import type { VelaPlatform } from './platform';
import type { Session } from './session';
import { message, type StateBox } from './state';
import type { VelaState } from './index';

/**
 * - `starting`: reading the stored session and the server's options.
 * - `redeeming`: the web's sign-in link is being exchanged for a session.
 * - `signed-out` / `signed-in`: settled.
 * - `offline`: restoration could not finish; stored credentials remain untouched, and it is
 *   tried again with backoff (`retryAt`) until the server answers or refuses the session.
 */
/** Covers a whole refresh attempt (REFRESH_ATTEMPT_TIMEOUT_MS) plus the reads around it. */
export const SESSION_RESTORE_TIMEOUT_MS = 20_000;
/** How long Sign in again waits for the server to revoke the session it is leaving. */
export const SIGN_IN_AGAIN_REVOKE_MS = 3_000;

/** Seconds before the next automatic restore after `attempt` earlier failures: 5, 10, 20, 40, then every 60. */
export function reconnectDelaySeconds(attempt: number): number {
  return Math.min(60, 5 * 2 ** Math.min(attempt, 4));
}

export type AuthPhase = 'starting' | 'redeeming' | 'signed-out' | 'signed-in' | 'offline';

export interface QuickCode {
  code: string;
  expiresAt: string;
  expiresLabel: string;
  status: 'pending' | 'expired' | 'denied';
}

export interface AuthState {
  phase: AuthPhase;
  serverId: string;
  serverKind: ServerKind | '';
  serverName: string;
  /** The server's own version (its capabilities); '' until it has answered. */
  serverVersion: string;
  viewer: string;
  viewerId: string;
  crossServerSearch?: boolean;
  passwordAvailable: boolean;
  plexAvailable: boolean;
  plexHomeAvailable: boolean;
  plexSwitching: boolean;
  /** A directly linked Plex server's account was refused by plex.tv: switching needs Plex linked again. */
  plexRelink: boolean;
  plex: null | { code: string; linkUrl: string; state: 'waiting' | 'expired' | 'failed' | 'profiles'; choices: never[]; profiles: V.PlexHomeProfile[] };
  quickAvailable: boolean;
  /** The server's HTTPS origin this http: page may hand its session to; '' when none. */
  secureOrigin: string;
  error: string;
  /** Offline: when (epoch ms) the next automatic attempt runs; 0 while one runs or none is due. */
  retryAt: number;
  /** Offline: an attempt to restore the session is in flight. */
  restoring: boolean;
  /** Offline: restore attempts that have failed in a row (manual Retry included); 0 once settled. */
  failures: number;
  /** Moves on with every session change, so views can key on it. */
  revision: number;
  /** Seconds between snapshot reads for a server without session events (0: it streams them). */
  pollSeconds: number;
  quick: QuickCode | null;
}

export const initialAuth: AuthState = {
  phase: 'starting',
  serverId: '',
  serverKind: '',
  serverName: '',
  serverVersion: '',
  viewer: '', viewerId: '',
  passwordAvailable: false,
  plexAvailable: false, plexHomeAvailable: false, plexSwitching: false, plexRelink: false, plex: null,
  quickAvailable: false,
  secureOrigin: '',
  error: '',
  retryAt: 0,
  restoring: false,
  failures: 0,
  revision: 0,
  pollSeconds: 0,
  quick: null,
};

/** How long a directly linked Plex server's profile choice stays open (Ether's selections expire on its own clock). */
const DIRECT_SELECTION_MS = 10 * 60_000;

/** A server without session events has its snapshot read this often while something plays. */
const SNAPSHOT_POLL_SECONDS = 5;

export class Auth {
  private plexGeneration = 0;
  private plexTimer?: ReturnType<typeof setTimeout>;
  private plexAuthorization?: { navigate(url: string): void; close(): void };
  /** An open profile choice: Ether's selection token, or for a directly linked Plex server the
   * account that lists and switches its Home and the server's machine identifier. */
  private plexSelection?: { token: string; expiresAt: string; serverId: string; switching: boolean; direct?: { accountToken: string; machine: string } };
  /** Whether each directly linked Plex server's account is in a Plex Home, by server and account. */
  private readonly plexHomes = new Map<string, { offered: boolean; viewerId?: string } | Promise<void>>();
  private starting: Promise<void> | undefined;
  private retrying: Promise<void> | undefined;
  private resetRefresh: Promise<void> | undefined;
  private linkError = '';
  /** Each server's version as it last stated it, by server id. */
  private readonly versions = new Map<string, string>();
  private linkGeneration = 0;
  private quick: { secret: string; serverId: string; timer?: ReturnType<typeof setTimeout> } | undefined;
  private redemption: { code: string; idempotencyKey: string; consumed: boolean } | undefined;
  /** Retry session restoration offline, or discover options for an unreachable signed-out server. */
  private reconnect: { timer: ReturnType<typeof setTimeout>; attempt: number } | undefined;
  /** The wait the server asked for with its last restore failure (Retry-After), in milliseconds. */
  private serverWait = 0;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly platform: VelaPlatform,
  ) {
    session.onReset((kind, refused) => {
      if (kind === 'server') this.linkGeneration++;
      this.cancelReconnect();
      this.cancelPlex();
      // A session the server refused ends here, whichever read found it: the viewer is told why.
      if (this.box.get().auth.phase !== 'redeeming') {
        const pending = this.refresh(refused ? msg('server.sessionEnded') : '').catch(() => {});
        this.resetRefresh = pending;
        void pending.finally(() => { if (this.resetRefresh === pending) this.resetRefresh = undefined; });
      }
    });
  }

  /** Settle the selected server's session: redeem a sign-in link, validate what is stored. */
  start(): Promise<void> {
    return this.starting ??= this.restoreSession();
  }

  private cancelReconnect(): void {
    if (this.reconnect) clearTimeout(this.reconnect.timer);
    this.reconnect = undefined;
  }

  /**
   * Foreground and manual retries ask the server now and restart the delay sequence. An attempt
   * already in flight is the fresh attempt (it is bounded by the restore deadline); otherwise a
   * new one starts, whatever the scheduled one was waiting for.
   */
  retry(): Promise<void> {
    if (this.box.get().auth.phase !== 'offline') return Promise.resolve();
    this.cancelReconnect();
    this.serverWait = 0;
    return this.retryRestore();
  }

  private retryRestore(): Promise<void> {
    return this.retrying ??= this.restoreSession().finally(() => { this.retrying = undefined; });
  }

  private scheduleReconnect(attempt = 0): void {
    this.cancelReconnect();
    const generation = this.linkGeneration;
    const serverId = this.box.get().auth.serverId;
    // A server that said when to come back (Retry-After) is not asked sooner than that.
    const delay = Math.max(reconnectDelaySeconds(attempt) * 1000, Math.min(this.serverWait, 300_000));
    this.serverWait = 0;
    const timer = setTimeout(() => {
      if (generation !== this.linkGeneration || !this.session.hasServer() || this.session.selected().record.id !== serverId) return;
      if (this.box.get().auth.phase === 'offline') void this.retryRestore();
      else if (this.box.get().auth.phase === 'signed-out') void this.refresh().catch(() => {});
    }, delay);
    this.reconnect = { timer, attempt: attempt + 1 };
    this.patch({ retryAt: Date.now() + delay });
  }

  // One deadline covers validation, credential reads and sign-in option discovery.
  // A late answer cannot repaint the offline state or a subsequent sign-in.
  private async restoreSession(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    if (this.box.get().auth.phase === 'offline') this.patch({ restoring: true, retryAt: 0 });
    const restoring = this.startSession(controller.signal);
    const generation = this.linkGeneration;
    try {
      await Promise.race([
        restoring,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const timeout = new Error(msg('server.unreachable'));
            controller.abort(timeout);
            reject(timeout);
          }, SESSION_RESTORE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if (generation !== this.linkGeneration) return;
      this.linkGeneration++;
      let server: Partial<AuthState> = {};
      try {
        const connection = this.session.selected();
        server = { serverId: connection.record.id, serverKind: connection.record.kind,
          serverName: this.session.names.get(connection.record.id) ?? connection.record.name,
          serverVersion: this.versions.get(connection.record.id) ?? '' };
      } catch {
        // An unreadable stored registry must not break the recovery path too.
      }
      this.patch({ phase: 'offline', error: message(error, msg('server.unreachable')),
        ...server, failures: this.box.get().auth.failures + 1, revision: this.session.epoch });
      this.scheduleReconnect(this.reconnect?.attempt ?? 0);
    } finally {
      clearTimeout(timer);
      if (this.box.get().auth.restoring) this.patch({ restoring: false });
    }
  }

  private async startSession(signal?: AbortSignal): Promise<void> {
    if (this.box.get().auth.phase !== 'offline') this.patch({ phase: 'starting', error: '' });
    if (!this.session.hasServer()) return this.noServer();
    const code = !this.session.servers.standalone ? this.platform.page?.webCode : undefined;
    if (this.platform.page) delete this.platform.page.webCode;
    if (code !== undefined) {
      await this.signInWithWebCode(code);
      return;
    }
    const connection = this.session.selected();
    const generation = this.linkGeneration;
    const epoch = this.session.epoch;
    try {
      if (this.session.demoSignIn(connection)) await this.session.ready();
      const stored = await this.session.tokens(connection);
      if (generation !== this.linkGeneration || epoch !== this.session.epoch) return;
      if (stored) await this.session.validate(connection, stored);
      if (generation !== this.linkGeneration || epoch !== this.session.epoch) return;
      await this.refresh('', undefined, signal);
    } catch (error) {
      if (generation !== this.linkGeneration || epoch !== this.session.epoch || signal?.aborted) return;
      const stillSignedIn = !!(await this.session.tokens(connection));
      if (generation !== this.linkGeneration || epoch !== this.session.epoch || signal?.aborted) return;
      if (stillSignedIn && await this.session.relocatePlex?.(connection, epoch, error, signal)) {
        if (this.resetRefresh) await this.resetRefresh;
        return;
      }
      if (generation !== this.linkGeneration || epoch !== this.session.epoch || signal?.aborted) return;
      // A transient failure is not sign-out: the stored session stays and the app says it is offline.
      // A session the server no longer accepts was dropped: the viewer is asked to sign in again
      // rather than shown the server's own wording ("Refresh invalid").
      const rejected = !stillSignedIn && refusesSession(error);
      if (stillSignedIn) this.serverWait = serverWait(error);
      await this.refresh(rejected ? msg('server.sessionEnded') : restoreFailure(error), stillSignedIn ? 'offline' : undefined);
    }
  }

  /** A new console link wins over the current viewer, including in an already-open tab. */
  async signInWithWebCode(code: string): Promise<boolean> {
    if (this.session.servers.standalone) return false;
    const generation = ++this.linkGeneration;
    this.linkError = '';
    this.patch({ phase: 'redeeming', viewer: '', error: '' });
    this.session.servers.select('ether');
    const connection = this.session.selected();
    try {
      const redeemed = await this.redeem(code, generation);
      if (!redeemed || generation !== this.linkGeneration) return false;
      // The 200 redemption proves this fresh session; option discovery cannot undo it.
      await this.refresh('', 'signed-in');
      return generation === this.linkGeneration;
    } catch {
      if (generation !== this.linkGeneration) return false;
      await connection.credentials.set(null);
      this.linkError = msg('server.webLinkExpired');
      this.session.resetSession();
      await this.refresh(this.linkError, 'signed-out');
      return false;
    }
  }

  /** A web sign-in link always signs in to the Ether server this page came from. */
  private async redeem(code: string, generation: number): Promise<boolean> {
    const ether = this.session.connection('ether');
    const adapter = ether.adapter;
    // An explicit handoff replaces any old viewer, including a stored signed-out marker.
    await ether.credentials.set(null);
    if (generation !== this.linkGeneration) return false;
    this.session.resetSession();
    if (!hasWebCodeSignIn(adapter)) throw new Error('Sign-in links are not offered by this server');
    if (!this.redemption || this.redemption.code !== code) {
      this.redemption = { code, idempotencyKey: this.session.key(), consumed: false };
    }
    const current = this.redemption;
    if (current.consumed) throw new Error('The sign-in link has already been used');
    const epoch = this.session.epoch;
    const tokens = await adapter.redeemWebCode({ code, device: this.session.device, idempotencyKey: current.idempotencyKey });
    if (this.redemption !== current || epoch !== this.session.epoch) return false;
    await ether.credentials.set(tokens);
    current.consumed = true;
    current.code = '';
    return true;
  }

  /** A standalone app with no server yet: signed out, and the app offers Connect. */
  private noServer(): void {
    this.cancelReconnect();
    this.patch({
      phase: 'signed-out', serverId: '', serverKind: '', serverName: '', serverVersion: '', viewer: '', viewerId: '',
      passwordAvailable: false, quickAvailable: false, plexAvailable: false, plexHomeAvailable: false, plexSwitching: false, plexRelink: false, plex: null, secureOrigin: '', error: '',
      revision: this.session.epoch, quick: null,
    });
  }

  /** Re-read the selected server's sign-in options and session into state. */
  async refresh(error = '', phase?: AuthPhase, signal?: AbortSignal): Promise<void> {
    error ||= this.linkError;
    if (!this.session.hasServer()) return this.noServer();
    const connection = this.session.selected();
    const epoch = this.session.epoch;
    const generation = this.linkGeneration;
    const tokens = await this.session.tokens(connection);
    let options = { passwordAvailable: false, quickAvailable: false, plexAvailable: false, plexHomeAvailable: false, crossServerSearch: false, secureOrigin: '' };
    let reachable = true;
    let optionsError: unknown;
    try {
      options = await this.options(connection);
    } catch (cause) {
      reachable = false;
      optionsError = cause;
    }
    // An older option/session read must never repaint a viewer after a new handoff.
    if (epoch !== this.session.epoch || generation !== this.linkGeneration) return;
    if (!reachable && tokens && !phase && await this.session.relocatePlex?.(connection, epoch, optionsError, signal)) {
      if (this.resetRefresh) await this.resetRefresh;
      return;
    }
    if (epoch !== this.session.epoch || generation !== this.linkGeneration) return;
    let settled: AuthPhase = tokens ? 'signed-in' : 'signed-out';
    if (phase) settled = phase;
    else if (!reachable && tokens) settled = 'offline';
    // Signed out from a server that did not answer: its sign-in options are unknown, not absent.
    // Say so, and ask again with backoff until it answers (or another server is selected).
    const attempt = this.reconnect?.attempt ?? 0;
    this.cancelReconnect();
    const reconnecting = settled === 'offline' || (!reachable && !tokens && settled === 'signed-out');
    if (reconnecting) error ||= msg('server.unreachable');
    this.patch({
      phase: settled,
      serverId: connection.record.id,
      serverKind: connection.record.kind,
      serverName: this.session.names.get(connection.record.id) ?? connection.record.name,
      // An unreachable server keeps the version it last stated.
      serverVersion: this.versions.get(connection.record.id) ?? '',
      viewer: tokens?.viewer.name ?? '',
      viewerId: tokens?.viewer.id ?? '',
      ...options,
      crossServerSearch: settled === 'signed-in' && options.crossServerSearch,
      error,
      retryAt: 0,
      failures: settled === 'offline' ? this.box.get().auth.failures + 1 : 0,
      revision: this.session.epoch,
      pollSeconds: hasEventStream(connection.adapter) ? 0 : SNAPSHOT_POLL_SECONDS,
    });
    if (reconnecting) this.scheduleReconnect(attempt);
  }

  private async options(connection: Connection) {
    const capabilities = await capabilitiesOf(connection.adapter);
    if (capabilities.server.name) this.session.names.set(connection.record.id, capabilities.server.name);
    if (capabilities.server.version) this.versions.set(connection.record.id, capabilities.server.version);
    // A secure switch hands the session over with a web code, so only a server with web codes offers one.
    // A standalone app has no page to move, so it is never offered (its server record keeps its address).
    const secure = hasWebCodeSignIn(connection.adapter) && !this.session.servers.standalone
      ? secureOriginFor(this.platform, capabilities.secureOrigins) : '';
    const home = connection.record.kind === 'plex' ? await this.plexHomePolicy(connection) : undefined;
    return {
      crossServerSearch: connection.record.kind === 'ether' ? !capabilities.plexHomeProfiles
        : !!home?.viewerId,
      plexAvailable: connection.record.kind === 'ether' && capabilities.plexAccountSignIn === true,
      plexHomeAvailable: connection.record.kind === 'ether' ? capabilities.plexHomeProfiles === true : home?.offered ?? false,
      passwordAvailable: capabilities.features.passwordSignIn.available,
      quickAvailable: capabilities.features.quickConnect.available,
      secureOrigin: secure,
    };
  }

  cancelPlex(): void {
    const auth = this.box.get().auth;
    // Only a Plex flow's own error goes with it: closing a sign-in screen that never started one
    // must not wipe why the viewer is there ("Your session has ended").
    const active = !!auth.plex || auth.plexSwitching || !!this.plexAuthorization || !!this.plexSelection;
    this.plexGeneration++;
    clearTimeout(this.plexTimer);
    this.plexAuthorization?.close();
    this.plexAuthorization = undefined;
    this.plexSelection = undefined;
    this.patch({ plex: null, plexSwitching: false, plexRelink: false, ...(active ? { error: '' } : {}) });
  }

  /** The plex.tv account a directly linked Plex server switches Home members with. A server linked
   * before the account was kept falls back to its own token, which is the account's on an owned server. */
  private async plexAccountToken(connection: Connection): Promise<string> {
    if (connection.record.kind !== 'plex' || !(connection.credentials instanceof ServerCredentials)) return '';
    return await connection.credentials.plexAccount() ?? (await connection.credentials.get())?.accessToken ?? '';
  }

  /**
   * Whether a directly linked Plex server offers Switch profile: its account is in a Plex Home with
   * someone else to switch to. plex.tv is asked once per account, off the refresh's path; the answer
   * is shown when it comes. A kept account plex.tv refuses still offers it, to explain and relink.
   */
  private async plexHomePolicy(connection: Connection): Promise<{ offered: boolean; viewerId?: string } | undefined> {
    const token = await this.plexAccountToken(connection);
    if (!token) return undefined;
    const key = `${connection.record.id}\n${token}`;
    const known = this.plexHomes.get(key);
    const viewer = (await connection.credentials.get())?.viewer;
    if (known && !(known instanceof Promise)) return {
      offered: known.offered, viewerId: known.viewerId === viewer?.id ? known.viewerId : undefined,
    };
    if (!known) {
      const epoch = this.session.epoch;
      const kept = connection.credentials instanceof ServerCredentials && await connection.credentials.plexAccount() === token;
      const asking = plexHomeUsers(this.session.device, token).then(users => {
        const me = viewer && users.find(user => user.uuid === viewer.id || String(user.id) === viewer.id);
        return { offered: users.length > 1, viewerId: me && !me.restricted && (me.admin || me.restricted === false) ? viewer?.id : undefined };
      }, error => {
        if (error instanceof PlexAccountRefused) return { offered: kept, viewerId: undefined };
        this.plexHomes.delete(key);
        return { offered: false, viewerId: undefined };
      }).then(home => {
        if (this.plexHomes.get(key) === asking) this.plexHomes.set(key, home);
        const auth = this.box.get().auth;
        if (epoch === this.session.epoch && auth.serverId === connection.record.id && this.session.selected() === connection) {
          this.patch({ plexHomeAvailable: home.offered, crossServerSearch: !!home.viewerId && home.viewerId === auth.viewerId });
        }
      });
      this.plexHomes.set(key, asking);
      void asking.catch(() => {});
    }
    return undefined;
  }

  /** Open a fresh profile challenge for the currently signed-in Plex account. */
  async startPlexProfileSwitch(): Promise<void> {
    this.cancelPlex();
    const generation = this.plexGeneration;
    const connection = this.session.selected();
    const epoch = this.session.epoch;
    this.patch({ plexSwitching: true, error: '', plex: { code: '', linkUrl: '', state: 'waiting', choices: [], profiles: [] } });
    try {
      if (this.box.get().auth.phase !== 'signed-in' || !this.box.get().auth.plexHomeAvailable) {
        throw new Error('Plex Home profile switching is not offered by this server.');
      }
      if (connection.record.kind === 'plex') {
        const accountToken = await this.plexAccountToken(connection);
        const [profiles, capabilities] = await Promise.all([plexServerProfiles(this.session.device, accountToken), capabilitiesOf(connection.adapter)]);
        if (generation !== this.plexGeneration || epoch !== this.session.epoch || connection !== this.session.selected()) return;
        if (!profiles.length) throw new Error('This Plex account is not in a Plex Home.');
        this.plexSelection = { token: '', expiresAt: new Date(Date.now() + DIRECT_SELECTION_MS).toISOString(), serverId: connection.record.id,
          switching: true, direct: { accountToken, machine: capabilities.server.id } };
        this.patch({ error: '', plexSwitching: true, plex: { code: '', linkUrl: '', state: 'profiles', choices: [], profiles } });
        return;
      }
      if (!(connection.adapter instanceof EtherAdapter)) throw new Error('Plex Home profile switching is not offered by this server.');
      const answer = await connection.adapter.startPlexProfileSwitch({ device: this.session.device, idempotencyKey: this.session.key() });
      if (generation !== this.plexGeneration || epoch !== this.session.epoch || connection !== this.session.selected()) return;
      this.plexSelection = { token: answer.selectionToken, expiresAt: answer.expiresAt, serverId: connection.record.id, switching: true };
      this.patch({ error: '', plexSwitching: true, plex: { code: '', linkUrl: '', state: 'profiles', choices: [], profiles: answer.profiles } });
    } catch (error) {
      if (generation === this.plexGeneration && epoch === this.session.epoch) {
        this.patch({ plexSwitching: true, plexRelink: error instanceof PlexAccountRefused, error: this.profileSwitchMessage(error), plex: null });
      }
    }
  }

  async startPlex(): Promise<void> {
    this.cancelPlex();
    const authorization = this.platform.beginExternalAuth?.();
    this.plexAuthorization = authorization;
    const generation = this.plexGeneration;
    const connection = this.session.selected();
    const epoch = this.session.epoch;
    const current = () => generation === this.plexGeneration && epoch === this.session.epoch && connection === this.session.selected();
    try {
      const options = await this.options(connection);
      if (!options.plexAvailable) throw new Error('Plex sign-in is not offered by this server');
      // The isolated mock has no plex.tv account. Its explicit profile capability exercises the
      // complete Vela picker without weakening any release path.
      if (this.platform.mock && options.plexHomeAvailable) {
        const answer = await beginPlexHomeSignIn(connection.record.origin, 'mock-plex-approved', this.session.device, this.session.key());
        if (!current() || !('profiles' in answer)) return;
        authorization?.close();
        this.plexAuthorization = undefined;
        this.plexSelection = { token: answer.selectionToken, expiresAt: answer.expiresAt, serverId: connection.record.id, switching: false };
        this.patch({ error: '', plex: { code: '', linkUrl: '', state: 'profiles', choices: [], profiles: answer.profiles } });
        return;
      }
      const pin = await createPlexPin(this.session.device, !!authorization);
      if (!current()) return;
      if (authorization) authorization.navigate(plexAuthUrl(this.session.device.id, pin.code));
      this.patch({ error: '', plex: { code: authorization ? '' : pin.code, linkUrl: authorization ? '' : 'https://plex.tv/link', state: 'waiting', choices: [], profiles: [] } });
      const poll = async () => {
        if (!current()) return;
        try {
          const approved = await pollPlexPin(this.session.device, pin);
          if (!current()) return;
          if (approved.authToken) {
            const answer = this.box.get().auth.plexHomeAvailable
              ? await beginPlexHomeSignIn(connection.record.origin, approved.authToken, this.session.device, this.session.key())
              : await exchangePlexAccount(connection.record.origin, approved.authToken, this.session.device, this.session.key());
            if (!current()) return;
            if ('profiles' in answer) {
              this.plexAuthorization?.close();
              this.plexAuthorization = undefined;
              this.plexSelection = { token: answer.selectionToken, expiresAt: answer.expiresAt, serverId: connection.record.id, switching: false };
              this.patch({ plex: { code: '', linkUrl: '', state: 'profiles', choices: [], profiles: answer.profiles } });
              return;
            }
            await connection.credentials.set(answer);
            this.cancelPlex();
            this.session.resetSession();
          } else if (Date.parse(pin.expiresAt) <= Date.now()) {
            this.patch({ plex: { code: '', linkUrl: '', state: 'expired', choices: [], profiles: [] } });
          } else this.plexTimer = setTimeout(() => void poll(), 2000);
        } catch (error) {
          if (current()) this.patch({ plex: null, error: message(error, 'Plex is temporarily unavailable. Try again.') });
        }
      };
      this.plexTimer = setTimeout(() => void poll(), 2000);
    } catch (error) {
      if (current()) {
        authorization?.close();
        if (this.plexAuthorization === authorization) this.plexAuthorization = undefined;
        this.patch({ error: message(error, 'Plex is temporarily unavailable. Try again.') });
      }
    }
  }

  async choosePlexProfile(profileId: string, pin?: string): Promise<void> {
    const selection = this.plexSelection;
    const connection = this.session.selected();
    if (!selection || selection.serverId !== connection.record.id || Date.parse(selection.expiresAt) <= Date.now()) {
      const switching = selection?.switching === true;
      this.cancelPlex();
      this.patch({ plexSwitching: switching, error: switching ? 'This profile selection expired. Start again.' : 'Plex profile selection expired. Sign in with Plex again.' });
      return;
    }
    try {
      const request = {
        selectionToken: selection.token, profileId, pin: pin || undefined,
        device: this.session.device, idempotencyKey: this.session.key(),
      };
      if (selection.direct) {
        const switched = await switchPlexServerProfile(this.session.device, selection.direct.accountToken, profileId, pin || undefined, selection.direct.machine, connection.record.origin);
        if (this.plexSelection !== selection || connection !== this.session.selected()) return;
        await connection.credentials.set(switched.tokens);
        // The member's own account switches next time (a member's server token cannot).
        if (connection.credentials instanceof ServerCredentials) await connection.credentials.setPlexAccount(switched.accountToken);
      } else if (selection.switching) {
        if (!(connection.adapter instanceof EtherAdapter)) throw new Error('Plex Home profile switching is not offered by this server.');
        await connection.adapter.completePlexProfileSwitch(request);
      } else {
        const tokens = await selectPlexHomeProfile(connection.record.origin, request);
        await connection.credentials.set(tokens);
      }
      this.cancelPlex();
      this.session.resetSession();
    } catch (error) {
      const ended = error instanceof VelaError && (error.detail.code === 'selection_consumed' || error.detail.code === 'selection_expired');
      if (ended) this.plexSelection = undefined;
      const refused = error instanceof PlexAccountRefused;
      if (refused) this.plexSelection = undefined;
      this.patch({ error: selection.switching ? this.profileSwitchMessage(error) : message(error, 'Could not select this Plex profile. Try again.'),
        plex: ended || refused ? null : this.box.get().auth.plex, ...(refused ? { plexRelink: true } : {}) });
    }
  }

  private profileSwitchMessage(error: unknown): string {
    if (error instanceof VelaError) {
      if (error.detail.code === 'invalid_pin') return 'That Plex Home PIN was not accepted.';
      if (error.detail.code === 'profile_ineligible') return 'This Plex Home profile is not available on this server.';
      if (error.detail.code === 'selection_consumed') return 'This profile selection was already used. Start again.';
      if (error.detail.code === 'selection_expired') return 'This profile selection expired. Start again.';
    }
    return message(error, 'Could not switch Plex Home profile. Try again.');
  }

  async signIn(username: string, password: string): Promise<boolean> {
    this.linkError = '';
    const connection = this.session.selected();
    const adapter = connection.adapter;
    try {
      if (!hasPasswordSignIn(adapter)) throw new Error('Password sign-in is not offered by this server');
      const tokens = await adapter.signInWithPassword({
        username,
        password,
        device: this.session.device,
        idempotencyKey: this.session.key(),
      });
      await connection.credentials.set(tokens);
      this.session.resetSession();
      return true;
    } catch (error) {
      const text = connection.record.kind === 'ether' ? message(error, 'Sign in failed') : signInFailure(error, 'Sign in failed');
      await this.refresh(text);
      return false;
    }
  }

  /** Show a Quick Connect code; core polls until it is approved, denied, expired or cancelled. */
  async startQuick(): Promise<void> {
    this.linkError = '';
    this.cancelQuick();
    const connection = this.session.selected();
    const adapter = connection.adapter;
    try {
      if (!hasQuickConnectSignIn(adapter)) throw new Error('Quick Connect is not offered by this server');
      const grant = await adapter.startQuickConnect({ device: this.session.device, idempotencyKey: this.session.key() });
      const current = { secret: grant.secret, serverId: connection.record.id };
      this.quick = current;
      const code: QuickCode = {
        code: grant.code,
        expiresAt: grant.expiresAt,
        expiresLabel: time(Date.parse(grant.expiresAt)),
        status: 'pending',
      };
      this.patch({ quick: code, error: '' });
      this.schedulePoll(current, grant.pollIntervalSeconds);
    } catch (error) {
      this.patch({ quick: null, error: message(error, 'Quick Connect failed') });
    }
  }

  cancelQuick(): void {
    if (this.quick?.timer) clearTimeout(this.quick.timer);
    this.quick = undefined;
    if (this.box.get().auth.quick) this.patch({ quick: null });
  }

  private schedulePoll(current: NonNullable<Auth['quick']>, seconds: number): void {
    const delay = Math.max(1, Number.isFinite(seconds) ? seconds : 5) * 1000;
    current.timer = setTimeout(() => this.pollQuick(current, seconds).catch(() => {}), delay);
  }

  private async pollQuick(current: NonNullable<Auth['quick']>, seconds: number): Promise<void> {
    const connection = this.session.selected();
    const adapter = connection.adapter;
    if (this.quick !== current || current.serverId !== connection.record.id || !hasQuickConnectSignIn(adapter)) return;
    let result: V.GrantPoll;
    try {
      result = await adapter.pollQuickConnect({
        secret: current.secret,
        device: this.session.device,
        idempotencyKey: this.session.key(),
      });
    } catch {
      // A missed poll is retried at the next interval.
      if (this.quick === current) this.schedulePoll(current, seconds);
      return;
    }
    if (this.quick !== current) return;
    if (result.status === 'pending') {
      this.schedulePoll(current, seconds);
      return;
    }
    this.quick = undefined;
    if (result.status === 'approved') {
      await connection.credentials.set(result.tokens);
      this.patch({ quick: null });
      this.session.resetSession();
      return;
    }
    const quick = this.box.get().auth.quick;
    if (quick) this.patch({ quick: { ...quick, status: result.status } });
  }

  /** Hand this http: page's session to the server's HTTPS origin; the URL opens there signed in. */
  async secureSwitch(): Promise<{ url: string; error: string }> {
    try {
      const connection = await this.session.ready();
      const api = connection.adapter;
      if (!hasWebCodeSignIn(api)) throw new Error('Secure connection unavailable');
      const epoch = this.session.epoch;
      const target = this.box.get().auth.secureOrigin;
      const description = await api.describe();
      const origin = secureOriginFor(this.platform, description.secureOrigins, target);
      if (!origin) throw new Error('Secure connection is no longer available');
      const issued = await api.issueWebCode({ targetOrigin: origin, device: this.session.device, idempotencyKey: this.session.key() });
      const expires = Date.parse(issued.expiresAt);
      const valid = issued.targetOrigin === origin && !!issued.code && Number.isFinite(expires) && expires > Date.now();
      if (epoch !== this.session.epoch || !valid) throw new Error('Invalid secure connection handoff');
      return { url: `${origin}/vela/#code=${encodeURIComponent(issued.code)}`, error: '' };
    } catch (error) {
      return { url: '', error: message(error, 'Secure connection unavailable') };
    }
  }

  /**
   * The way out of a session that will not restore: forget it on this device and show sign-in.
   * The server is asked to revoke it, but only briefly, since it is the server that is not
   * answering; the session is forgotten here whatever it says.
   */
  async signInAgain(): Promise<void> {
    if (this.box.get().auth.phase !== 'offline') return;
    this.linkGeneration++;
    this.cancelReconnect();
    const connection = this.session.selected();
    const epoch = this.session.epoch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      endSession(connection, this.session).catch(() => {}),
      new Promise<void>(resolve => { timer = setTimeout(resolve, SIGN_IN_AGAIN_REVOKE_MS); }),
    ]);
    clearTimeout(timer);
    if (epoch !== this.session.epoch) return;
    await connection.credentials.set(null);
    this.cancelQuick();
    this.session.resetSession();
  }

  /** Revoke the selected server's session, then forget it here. */
  async signOut(): Promise<void> {
    this.linkGeneration++;
    this.cancelReconnect();
    const connection = this.session.selected();
    const epoch = this.session.epoch;
    try {
      await endSession(connection, this.session);
      if (epoch === this.session.epoch) {
        this.cancelQuick();
        this.session.resetSession();
      }
    } catch (error) {
      await this.refresh(signInFailure(error, 'Sign out failed'));
    }
  }

  private patch(change: Partial<AuthState>): void {
    this.box.update('auth', auth => ({ ...auth, ...change }));
  }
}

/** Revoke a server's session, then forget it locally; a token the server already rejected needs no revocation. */
export async function endSession(connection: Connection, session: Session): Promise<void> {
  const tokens = await session.tokens(connection);
  if (!tokens) return;
  try {
    await connection.adapter.revokeSession({ refreshToken: tokens.refreshToken, idempotencyKey: session.key() });
  } catch (error) {
    if (!(error instanceof VelaError) || error.status !== 401) throw error;
  }
  const latest = await session.tokens(connection);
  if (latest?.accessToken === tokens.accessToken) await connection.credentials.set(null);
}

/** A rejection by the server reads as such; anything else keeps its own message. */
export function signInFailure(error: unknown, fallback: string): string {
  if (error instanceof VelaError && (error.status === 401 || error.detail.class === 'auth')) return msg('server.rejected');
  return message(error, fallback);
}

/** The HTTPS origin an http: page may hand its session to: one the server advertises, bare. */
function secureOriginFor(platform: VelaPlatform, origins: string[] | undefined, requested?: string): string {
  let page: URL;
  try {
    page = new URL(platform.page?.origin ?? '');
  } catch {
    return '';
  }
  if (page.protocol !== 'http:') return '';
  for (const origin of origins ?? []) {
    try {
      const url = new URL(origin);
      const bare = !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
      if (url.protocol === 'https:' && bare && origin === url.origin && (!requested || requested === origin)) return origin;
    } catch {
      // A malformed advertised origin is ignored.
    }
  }
  return '';
}

/** Why a stored session could not be restored, in the viewer's words: the server's own answer when it gave one. */
export function restoreFailure(error: unknown): string {
  if (error instanceof VelaError) return msg('server.restoreTrouble', { detail: error.detail.message || `${error.status}` });
  return msg('server.unreachable');
}
