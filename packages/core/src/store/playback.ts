// Playback: the plan for a title, extra or channel; following the session while it plays (the
// server's event stream, or snapshot reads for a server without one); the player's session
// commands and observations; and stopping. Media credentials never enter state: the trusted host
// asks `mediaAccess()` and hands the result straight to the native player.
import type * as V from '../wire';
import { hasSubtitleSearch } from '../adapter/media-actions';
import type { Connection } from '../adapter/connection';
import { sendCommand } from '../adapter/commands';
import { hasEventStream } from '../adapter/capabilities';
import { VelaError } from '../adapter/errors';
import { liveStatus, type LiveObservation } from '../live/player';
import type { Watched } from '../discovery/progress';
import { followSession, forgetSession } from '../protocol/events';
import { randomId } from '../protocol/id';
import type { Session } from './session';
import { message, type StateBox } from './state';
import type { VelaState } from './index';

export type PlaybackTarget =
  | { kind: 'title'; id: string; positionSeconds?: number; mediaSourceId?: string; audioTrackId?: string }
  | { kind: 'extra'; id: string }
  | { kind: 'channel'; id: string };

export type PlaybackPhase = 'idle' | 'starting' | 'preparing' | 'playing' | 'ended' | 'failed';

export interface PlaybackState {
  phase: PlaybackPhase;
  target: PlaybackTarget | null;
  /** The plan the player receives (`plan` prop), every media URL validated for its server. */
  plan: V.PlaybackPlan | null;
  sessionId: string;
  error: string;
  errorCode: string;
  /** The v0 error class (`capacity` when every stream is in use, `auth`, `transient`, …), or ''. */
  errorClass: string;
  /** While an extra is prepared, or after a failure the server allows retrying: when to ask again. */
  retryAfterSeconds: number;
  live: ReturnType<typeof liveStatus>;
}

export const initialPlayback: PlaybackState = {
  phase: 'idle',
  target: null,
  plan: null,
  sessionId: '',
  error: '',
  errorCode: '',
  errorClass: '',
  retryAfterSeconds: 0,
  live: null,
};

/** The media authorization the trusted host passes to `VelaPlayer.setMediaAccess`. */
export interface MediaAccessGrant {
  /** Rotates with the server, viewer and credential, retiring readers of the old one. */
  handle: string;
  origin: string;
  pathPrefix: string;
  headers(): Promise<Record<string, string>>;
  nativeURL?(url: string): Promise<string>;
}

interface Intent {
  run: object;
  target: PlaybackTarget;
  key: string;
}

const MAX_PREPARATIONS = 30;
const MAX_FOLLOW_FAILURES = 5;
const POLL_SECONDS = 5;

export class Playback {
  /** The current playback's own token: work for an older one stops when this changes. */
  private run: object | undefined;
  private externalId: string | undefined;
  private follow: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private media: { identity: string; handle: string } | undefined;

  /** The last progress report in flight, so a stop is followed by a read of what it recorded. */
  private reporting: Promise<unknown> = Promise.resolve();

  /** The last position the player reported for the current session. */
  private lastPosition: { sessionId: string; seconds: number; ended: boolean } | undefined;

  /**
   * `watched` receives only server-confirmed resume state after stop/end, and `reconcile`
   * refreshes the page after the last report. A session with no reports changes no resume.
   */
  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly watched: (watched: Watched) => void,
    private readonly reconcile: (watched: Watched) => void,
  ) {
    session.onReset(() => {
      this.end();
      this.media = undefined;
      this.box.update('playback', () => initialPlayback);
    });
  }

  /** Ask the server for a plan and follow its session. Replaces whatever played before. */
  async start(target: PlaybackTarget): Promise<void> {
    const current = this.box.get().playback;
    if ((current.phase === 'starting' || current.phase === 'preparing') &&
        current.target?.kind === target.kind && current.target.id === target.id &&
        (target.kind !== 'title' || (current.target.kind === 'title' &&
          current.target.positionSeconds === target.positionSeconds &&
          current.target.mediaSourceId === target.mediaSourceId &&
          current.target.audioTrackId === target.audioTrackId))) return;
    const stopping = this.stop();
    const run = {};
    this.run = run;
    this.patch({ ...initialPlayback, phase: 'starting', target });
    await stopping;
    if (this.run !== run) return;
    await this.request({ run, target, key: `play-${target.kind}-${target.id}-${randomId()}` }, 0, 0);
  }

  /** Follow a live owner's existing plan without taking responsibility for stopping it. */
  async attach(target: PlaybackTarget, existing: V.PlaybackPlan): Promise<void> {
    this.end();
    const run = {};
    this.run = run;
    this.externalId = existing.sessionId;
    const connection = await this.session.ready();
    if (this.run !== run) return;
    const plan = connection.plan(existing);
    this.patch({ ...initialPlayback, phase: 'playing', target, plan, sessionId: plan.sessionId });
    this.followSession(run, connection, plan.sessionId);
  }

  /** Stop following an externally owned live session without ending the server session. */
  detach(sessionId: string): void {
    if (this.externalId !== sessionId) return;
    this.end();
    this.box.update('playback', () => initialPlayback);
  }

  /** One playback intent: every attempt and preparation re-request carries its idempotency key. */
  private async request(intent: Intent, attempt: number, preparation: number): Promise<void> {
    const { run, target } = intent;
    const epoch = this.session.epoch;
    let connection: Connection;
    let reply: V.PlaybackPlan | V.PlaybackPreparing;
    try {
      connection = await this.session.ready();
      const api = connection.adapter;
      await this.session.negotiate(api);
      const position = target.kind === 'title' ? target.positionSeconds : undefined;
      reply = await api.startPlayback({
        ...(target.kind === 'extra' ? { extraId: target.id } : target.kind === 'channel' ? { channelId: target.id } : { titleId: target.id }),
        ...(position !== undefined ? { positionSeconds: position } : {}),
        ...(target.kind === 'title' && target.mediaSourceId ? { mediaSourceId: target.mediaSourceId } : {}),
        ...(target.kind === 'title' && target.audioTrackId ? { audioTrackId: target.audioTrackId } : {}),
        client: this.session.client,
        idempotencyKey: intent.key,
      });
    } catch (error) {
      if (this.run !== run || epoch !== this.session.epoch) return;
      this.failed(intent, error, attempt, preparation);
      return;
    }
    if (this.run !== run || epoch !== this.session.epoch) {
      // Navigation or a replacement start can finish before the plan request. Release the
      // session it allocated; dropping the reply alone leaks a server playback slot.
      if ('sessionId' in reply) {
        try { await connection.adapter.command(reply.sessionId, { kind: 'stop', sourceGeneration: reply.sourceGeneration, seekGeneration: reply.seekGeneration, idempotencyKey: `cancel-${intent.key}` }); } catch { /* Already gone. */ }
      }
      return;
    }
    if ('state' in reply && reply.state === 'preparing') {
      const seconds = Math.ceil(reply.retryAfterSeconds);
      if (target.kind !== 'extra' || !Number.isFinite(seconds) || seconds < 1 || preparation >= MAX_PREPARATIONS) {
        this.patch({ phase: 'failed', error: 'Invalid playback preparation response', errorCode: '', errorClass: '' });
        return;
      }
      this.patch({ phase: 'preparing', retryAfterSeconds: seconds });
      this.timer = setTimeout(() => void this.request(intent, attempt, preparation + 1), seconds * 1000);
      return;
    }
    const plan = connection.plan(reply as V.PlaybackPlan);
    this.patch({ phase: 'playing', plan, sessionId: plan.sessionId, error: '', errorCode: '', errorClass: '', retryAfterSeconds: 0 });
    this.followSession(run, connection, plan.sessionId);
  }

  /** A failure the server allows retrying is retried on its terms (at most twice, within a minute). */
  private failed(intent: Intent, error: unknown, attempt: number, preparation: number): void {
    if (!(error instanceof VelaError)) {
      this.patch({ phase: 'failed', error: message(error, 'Playback failed'), errorCode: '', errorClass: '' });
      return;
    }
    const retry = error.detail.retry;
    const header = Number(error.retryAfter);
    const hint = Number.isFinite(retry.afterSeconds) ? Math.max(0, retry.afterSeconds!) : 0;
    const seconds = Math.max(2 ** Math.min(attempt, 5), hint, Number.isFinite(header) ? header : 0, 1);
    const limit = Math.max(0, Math.min(2, (Number.isFinite(retry.maxAttempts) ? Math.floor(retry.maxAttempts!) : 3) - 1));
    const again = retry.allowed === true && seconds <= 60 && attempt < limit;
    this.patch({
      phase: 'failed',
      error: error.message,
      errorCode: error.detail.code,
      errorClass: error.detail.class,
      retryAfterSeconds: again ? seconds : 0,
    });
    if (again) this.timer = setTimeout(() => void this.request(intent, attempt + 1, preparation), seconds * 1000);
  }

  /** Follow the session until it ends or playback stops: events when the server streams them, else snapshots. */
  private followSession(run: object, connection: Connection, sessionId: string): void {
    const controller = new AbortController();
    this.follow = controller;
    const present = (plan: V.PlaybackPlan) => connection.plan(plan);
    const show = (plan: V.PlaybackPlan) => {
      if (this.run !== run || plan.sessionId !== sessionId) return;
      const ended = plan.state === 'ended' && this.box.get().playback.phase !== 'ended';
      this.patch({ plan, phase: plan.state === 'ended' ? 'ended' : 'playing' });
      if (ended) this.afterWatching(plan, this.box.get().playback.target, plan.positionSeconds);
    };
    const adapter = connection.adapter;
    const loop = async () => {
      let failures = 0;
      while (this.run === run && !controller.signal.aborted && this.box.get().playback.phase === 'playing') {
        try {
          if (hasEventStream(adapter)) {
            await followSession(adapter, present, sessionId, show, controller.signal);
          } else {
            const snapshot = await adapter.sessionSnapshot(sessionId);
            if (snapshot.plan.sessionId !== sessionId) throw new Error('Invalid session snapshot');
            show(present(snapshot.plan));
            await delay(POLL_SECONDS * 1000, controller.signal);
          }
          failures = 0;
        } catch {
          if (controller.signal.aborted) return;
          failures++;
          if (failures >= MAX_FOLLOW_FAILURES) return;
          await delay(Math.min(30, 2 ** failures) * 1000, controller.signal).catch(() => {});
        }
      }
      forgetSession(sessionId);
    };
    void loop();
  }

  /**
   * The selected server's playback operations, for a player that drives its own session (the
   * watch route's controller). Negotiated first; every plan comes back validated for its server.
   */
  readonly server = {
    startPlayback: async (request: V.PlaybackRequest): Promise<V.PlaybackPlan | V.PlaybackPreparing> => {
      const connection = await this.session.ready();
      await this.session.negotiate(connection.adapter);
      const reply = await connection.adapter.startPlayback(request);
      return 'sessionId' in reply ? connection.plan(reply) : reply;
    },
    command: async (sessionId: string, command: V.SessionCommand): Promise<V.PlaybackPlan> => {
      const connection = await this.session.ready();
      return connection.plan(await this.send(connection, sessionId, command));
    },
    sessionSnapshot: async (sessionId: string): Promise<V.SessionSnapshot> => {
      const connection = await this.session.ready();
      const snapshot = await connection.adapter.sessionSnapshot(sessionId);
      return { ...snapshot, plan: connection.plan(snapshot.plan) };
    },
    reportObservation: (sessionId: string, observation: V.PlayerObservation) => this.observe(sessionId, observation),
  };

  get subtitleSearchAvailable(): boolean {
    try { return hasSubtitleSearch(this.session.selected().adapter); } catch { return false; }
  }

  async searchSubtitles(language: string) {
    const api = (await this.session.ready()).adapter;
    if (!hasSubtitleSearch(api)) throw new Error('Subtitle search is unavailable on this server');
    return api.searchSubtitles(this.box.get().playback.sessionId, language);
  }

  async downloadSubtitle(id: string): Promise<string | null> {
    const connection = await this.session.ready();
    const api = connection.adapter;
    if (!hasSubtitleSearch(api)) throw new Error('Subtitle search is unavailable on this server');
    const sessionId = this.box.get().playback.sessionId;
    const previous = this.box.get().playback.plan;
    const plan = connection.plan(await api.downloadSubtitle(sessionId, id));
    if (this.box.get().playback.sessionId !== sessionId) return null;
    this.patch({ plan });
    return plan.subtitleTracks.find(t => !previous?.subtitleTracks.some(p => p.id === t.id))?.id ?? null;
  }

  /** A player's session command (seek, pause, track change, path switch, fallback, stop). */
  async command(sessionId: string, command: V.SessionCommand): Promise<void> {
    const current = this.box.get().playback;
    if (current.sessionId === sessionId && current.error) this.patch({ error: '' });
    try {
      const connection = await this.session.ready();
      const plan = await this.send(connection, sessionId, command);
      if (this.box.get().playback.sessionId === sessionId) this.patch({ plan: connection.plan(plan) });
    } catch (error) {
      if (this.box.get().playback.sessionId === sessionId) this.patch({ error: message(error, 'Playback command failed') });
    }
  }

  private async send(connection: Connection, sessionId: string, command: V.SessionCommand): Promise<V.PlaybackPlan> {
    const api = connection.adapter;
    try {
      return await sendCommand(api, sessionId, command);
    } catch (error) {
      // A stop, seek, pause, resume or track change can race a generation the server moved on its own (an
      // authorized switch or recovery). Each names an absolute outcome, so it is retried once
      // when the server supplies the authoritative generations, with a new key because the
      // rejected precondition is itself idempotently recorded. A switch is tied to the source it
      // was planned against and is not.
      const stale = error instanceof VelaError && error.detail.code === 'stale_generation';
      const generations = stale ? error.detail.currentGenerations : undefined;
      const absolute = ['stop', 'seek', 'pause', 'resume', 'tracks'].includes(command.kind);
      if (!absolute || !generations) throw error;
      return sendCommand(api, sessionId, { ...command, ...generations, idempotencyKey: this.session.key() });
    }
  }

  /** Read the session's authoritative plan again (the player found its grant expired or a reply stale).
   * False when the session is gone (the server ended it, or it cannot be read): the caller starts over. */
  async refresh(sessionId: string): Promise<boolean> {
    try {
      const connection = await this.session.ready();
      const snapshot = await connection.adapter.sessionSnapshot(sessionId);
      if (snapshot.plan.sessionId !== sessionId) throw new Error('Invalid session snapshot');
      if (snapshot.plan.state === 'ended') return false;
      if (this.box.get().playback.sessionId === sessionId) this.patch({ plan: connection.plan(snapshot.plan) });
      return true;
    } catch (error) {
      if (this.box.get().playback.sessionId === sessionId) this.patch({ error: message(error, 'Playback refresh failed') });
      return false;
    }
  }

  /** The player's progress report. */
  async observe(sessionId: string, observation: V.PlayerObservation): Promise<V.Ack> {
    const connection = await this.session.ready();
    const ended = observation.state === 'ended';
    this.lastPosition = { sessionId, seconds: observation.positionSeconds, ended };
    const sent = connection.adapter.reportObservation(sessionId, observation);
    this.reporting = sent.catch(() => undefined);
    return sent;
  }

  /** A player snapshot: live status (reconnecting, delivery, drift) when the engine observes it. */
  snapshot(snapshot: LiveObservation): void {
    const live = liveStatus(snapshot);
    const current = this.box.get().playback.live;
    if (JSON.stringify(live) !== JSON.stringify(current)) this.patch({ live });
  }

  /** Stop playing: the server releases the session at the plan's generations. */
  async stop(): Promise<void> {
    const { plan, target, phase } = this.box.get().playback;
    this.end();
    this.box.update('playback', () => initialPlayback);
    if (!plan || plan.state === 'ended') return;
    let confirmedPosition: number | undefined;
    try {
      await this.reporting;
      const connection = await this.session.ready();
      await connection.adapter.command(plan.sessionId, {
        kind: 'stop',
        sourceGeneration: plan.sourceGeneration,
        seekGeneration: plan.seekGeneration,
        idempotencyKey: `stop-${plan.sessionId}-${plan.sourceGeneration}-${plan.seekGeneration}`,
      });
      const titleId = plan.titleId ?? (target?.kind === 'title' ? target.id : '');
      if (titleId && plan.purpose !== 'preview') {
        // Some servers return the raw session cursor even though their resume policy drops
        // it. Read the persisted watch state before publishing any resume UI.
        const detail = await connection.adapter.detail(titleId, true);
        confirmedPosition = detail.title.watch?.positionSeconds;
      }
    } catch {
      // Ended, expired or already stopped: the server holds nothing for it.
    }
    if (phase !== 'ended') this.afterWatching(plan, target, confirmedPosition);
  }

  /**
   * Publish persisted resume state only. The player's raw cursor can be below the server's
   * resume threshold; drawing it optimistically would make the title action flicker.
   */
  private afterWatching(plan: V.PlaybackPlan, target: PlaybackTarget | null, confirmedPosition?: number): void {
    const titleId = plan.titleId ?? (target?.kind === 'title' ? target.id : '');
    if (!titleId || plan.purpose === 'preview') return;
    const last = this.lastPosition?.sessionId === plan.sessionId ? this.lastPosition : undefined;
    const finished = plan.state === 'ended' || last?.ended === true;
    if (!last && !finished) return;
    const watched: Watched = { titleId, positionSeconds: confirmedPosition ?? last?.seconds ?? 0, finished };
    // Resume eligibility belongs to the server (Ether, for example, drops positions below
    // 5%). Publish only its answer, never a local position that will immediately disappear.
    if (confirmedPosition !== undefined) this.watched(watched);
    void this.reporting.then(() => this.reconcile(watched));
  }

  private end(): void {
    this.externalId = undefined;
    this.run = undefined;
    this.follow?.abort();
    this.follow = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * The selected server's media authorization for the trusted player host, or null for a server
   * whose plans carry their own authority (Ether's broker). Never part of state, a plan or a log.
   */
  async mediaAccess(): Promise<MediaAccessGrant | null> {
    const connection = await this.session.ready();
    const tokens = await this.session.tokens(connection);
    const media = connection.media;
    if (!media || !tokens) return null;
    const identity = JSON.stringify([connection.record.id, tokens.viewer.id, tokens.accessToken]);
    if (this.media?.identity !== identity) this.media = { identity, handle: randomId() };
    const handle = this.media.handle;
    const current = () => this.media?.handle === handle && this.session.selected() === connection;
    return {
      handle,
      origin: media.origin,
      pathPrefix: media.pathPrefix,
      headers: async () => {
        if (!current()) throw new Error('Media authorization was replaced');
        return media.headers();
      },
      nativeURL: async url => {
        if (!current()) throw new Error('Media authorization was replaced');
        return media.nativeURL(url);
      },
    };
  }

  private patch(change: Partial<PlaybackState>): void {
    this.box.update('playback', playback => ({ ...playback, ...change }));
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
