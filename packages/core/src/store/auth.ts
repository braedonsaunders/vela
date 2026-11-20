// Signing in to the selected server: its sign-in options, password and Quick Connect sign-in,
// the web's sign-in link (a one-time code redeemed at start), the hand-off to the server's
// secure origin, and sign-out. Quick Connect polling runs here, at the server's interval.
import { createPlexPin, plexAuthUrl, pollPlexPin } from '../adapter/plex/auth';
import { exchangePlexAccount } from '../adapter/ether/plex';
import type * as V from '../wire';
import type { Connection } from '../adapter/connection';
import { capabilitiesOf } from '../adapter/advertise';
import { hasEventStream, hasPasswordSignIn, hasQuickConnectSignIn, hasWebCodeSignIn } from '../adapter/capabilities';
import { VelaError } from '../adapter/errors';
import type { ServerKind } from '../session/servers';
import { msg, time } from '../i18n';
import type { VelaPlatform } from './platform';
import type { Session } from './session';
import { message, type StateBox } from './state';
import type { VelaState } from './index';

/**
 * - `starting`: reading the stored session and the server's options.
 * - `redeeming`: the web's sign-in link is being exchanged for a session.
 * - `signed-out` / `signed-in`: settled.
 * - `offline`: restoration could not finish; stored credentials remain untouched.
 */
export const SESSION_RESTORE_TIMEOUT_MS = 10_000;

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
  viewer: string;
  passwordAvailable: boolean;
  plexAvailable: boolean;
  plex: null | { code: string; linkUrl: string; state: 'waiting' | 'expired' | 'failed'; choices: never[] };
  quickAvailable: boolean;
  /** The server's HTTPS origin this http: page may hand its session to; '' when none. */
  secureOrigin: string;
  error: string;
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
  viewer: '',
  passwordAvailable: false,
  plexAvailable: false, plex: null,
  quickAvailable: false,
  secureOrigin: '',
  error: '',
  revision: 0,
  pollSeconds: 0,
  quick: null,
};

/** A server without session events has its snapshot read this often while something plays. */
const SNAPSHOT_POLL_SECONDS = 5;

export class Auth {
  private plexGeneration = 0;
  private plexTimer?: ReturnType<typeof setTimeout>;
  private plexAuthorization?: { navigate(url: string): void; close(): void };
  private starting: Promise<void> | undefined;
  private retrying: Promise<void> | undefined;
  private linkError = '';
  private linkGeneration = 0;
  private quick: { secret: string; serverId: string; timer?: ReturnType<typeof setTimeout> } | undefined;
  private redemption: { code: string; idempotencyKey: string; consumed: boolean } | undefined;
  /** Retry session restoration offline, or discover options for an unreachable signed-out server. */
  private reconnect: { timer: ReturnType<typeof setTimeout>; attempt: number } | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly platform: VelaPlatform,
  ) {
    session.onReset(kind => {
      if (kind === 'server') this.linkGeneration++;
      this.cancelReconnect();
      this.cancelPlex();
      if (this.box.get().auth.phase !== 'redeeming') void this.refresh().catch(() => {});
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

  /** Foreground and manual retries restart the delay sequence. */
  retry(): Promise<void> {
    if (this.box.get().auth.phase !== 'offline') return Promise.resolve();
    this.cancelReconnect();
    return this.retryRestore();
  }

  private retryRestore(): Promise<void> {
    return this.retrying ??= this.restoreSession().finally(() => { this.retrying = undefined; });
  }

  private scheduleReconnect(attempt = 0): void {
    this.cancelReconnect();
    const generation = this.linkGeneration;
    const serverId = this.box.get().auth.serverId;
    const timer = setTimeout(() => {
      if (generation !== this.linkGeneration || !this.session.hasServer() || this.session.selected().record.id !== serverId) return;
      if (this.box.get().auth.phase === 'offline') void this.retryRestore();
      else if (this.box.get().auth.phase === 'signed-out') void this.refresh().catch(() => {});
    }, Math.min(60, 5 * 2 ** Math.min(attempt, 4)) * 1000);
    this.reconnect = { timer, attempt: attempt + 1 };
  }

  // One deadline covers validation, credential reads and sign-in option discovery.
  // A late answer cannot repaint the offline state or a subsequent sign-in.
  private async restoreSession(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restoring = this.startSession();
    const generation = this.linkGeneration;
    try {
      await Promise.race([
        restoring,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(msg('server.unreachable'))), SESSION_RESTORE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if (generation !== this.linkGeneration) return;
      this.linkGeneration++;
      let server: Partial<AuthState> = {};
      try {
        const connection = this.session.selected();
        server = { serverId: connection.record.id, serverKind: connection.record.kind,
          serverName: this.session.names.get(connection.record.id) ?? connection.record.name };
      } catch {
        // An unreadable stored registry must not break the recovery path too.
      }
      this.patch({ phase: 'offline', error: message(error, msg('server.unreachable')),
        ...server, revision: this.session.epoch });
      this.scheduleReconnect(this.reconnect?.attempt ?? 0);
    } finally {
      clearTimeout(timer);
    }
  }

  private async startSession(): Promise<void> {
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
    try {
      if (this.session.demoSignIn(connection)) await this.session.ready();
      const stored = await this.session.tokens(connection);
      if (generation !== this.linkGeneration) return;
      if (stored) await this.session.validate(connection, stored);
      if (generation !== this.linkGeneration) return;
      await this.refresh();
    } catch (error) {
      if (generation !== this.linkGeneration) return;
      const stillSignedIn = !!(await this.session.tokens(connection));
      // A transient failure is not sign-out: the stored session stays and the app says it is offline.
      // A session the server no longer accepts was dropped: the viewer is asked to sign in again
      // rather than shown the server's own wording ("Refresh invalid").
      const rejected = !stillSignedIn && error instanceof VelaError && (error.status === 401 || error.detail.class === 'auth');
      const text = rejected ? msg('server.sessionEnded') : message(error, msg('server.unreachable'));
      await this.refresh(text, stillSignedIn ? 'offline' : undefined);
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
      phase: 'signed-out', serverId: '', serverKind: '', serverName: '', viewer: '',
      passwordAvailable: false, quickAvailable: false, plexAvailable: false, plex: null, secureOrigin: '', error: '',
      revision: this.session.epoch, quick: null,
    });
  }

  /** Re-read the selected server's sign-in options and session into state. */
  async refresh(error = '', phase?: AuthPhase): Promise<void> {
    error ||= this.linkError;
    if (!this.session.hasServer()) return this.noServer();
    const connection = this.session.selected();
    const epoch = this.session.epoch;
    const generation = this.linkGeneration;
    const tokens = await this.session.tokens(connection);
    let options = { passwordAvailable: false, quickAvailable: false, plexAvailable: false, secureOrigin: '' };
    let reachable = true;
    try {
      options = await this.options(connection);
    } catch {
      reachable = false;
    }
    // An older option/session read must never repaint a viewer after a new handoff.
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
      viewer: tokens?.viewer.name ?? '',
      ...options,
      error,
      revision: this.session.epoch,
      pollSeconds: hasEventStream(connection.adapter) ? 0 : SNAPSHOT_POLL_SECONDS,
    });
    if (reconnecting) this.scheduleReconnect(attempt);
  }

  private async options(connection: Connection) {
    const capabilities = await capabilitiesOf(connection.adapter);
    if (capabilities.server.name) this.session.names.set(connection.record.id, capabilities.server.name);
    // A secure switch hands the session over with a web code, so only a server with web codes offers one.
    // A standalone app has no page to move, so it is never offered (its server record keeps its address).
    const secure = hasWebCodeSignIn(connection.adapter) && !this.session.servers.standalone
      ? secureOriginFor(this.platform, capabilities.secureOrigins) : '';
    return {
      plexAvailable: connection.record.kind === 'ether' && capabilities.plexAccountSignIn === true,
      passwordAvailable: capabilities.features.passwordSignIn.available,
      quickAvailable: capabilities.features.quickConnect.available,
      secureOrigin: secure,
    };
  }

  cancelPlex(): void {
    this.plexGeneration++;
    clearTimeout(this.plexTimer);
    this.plexAuthorization?.close();
    this.plexAuthorization = undefined;
    this.patch({ plex: null });
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
      if (!(await this.options(connection)).plexAvailable) throw new Error('Plex sign-in is not offered by this server');
      const pin = await createPlexPin(this.session.device.id, !!authorization);
      if (!current()) return;
      if (authorization) authorization.navigate(plexAuthUrl(this.session.device.id, pin.code));
      this.patch({ error: '', plex: { code: authorization ? '' : pin.code, linkUrl: authorization ? '' : 'https://plex.tv/link', state: 'waiting', choices: [] } });
      const poll = async () => {
        if (!current()) return;
        try {
          const approved = await pollPlexPin(this.session.device.id, pin);
          if (!current()) return;
          if (approved.authToken) {
            const tokens = await exchangePlexAccount(connection.record.origin, approved.authToken, this.session.device, this.session.key());
            if (!current()) return;
            await connection.credentials.set(tokens);
            this.cancelPlex();
            this.session.resetSession();
          } else if (Date.parse(pin.expiresAt) <= Date.now()) {
            this.patch({ plex: { code: '', linkUrl: '', state: 'expired', choices: [] } });
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
