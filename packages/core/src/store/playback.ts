// Playback: the plan for a title, extra or channel; following the session while it plays (the
// server's event stream, or snapshot reads for a server without one); the player's session
// commands and observations; and stopping. Media credentials never enter state: the trusted host
// asks `mediaAccess()` and hands the result straight to the native player.
import type * as V from '../wire';
import type { Connection } from '../adapter/connection';
import { sendCommand } from '../adapter/commands';
import { hasEventStream } from '../adapter/capabilities';
import { VelaError } from '../adapter/errors';
import { liveStatus, type LiveObservation } from '../live/player';
import { followSession, forgetSession } from '../protocol/events';
import { randomId } from '../protocol/id';
import type { Session } from './session';
import { message, type StateBox } from './state';
import type { VelaState } from './index';

export type PlaybackTarget =
  | { kind: 'title'; id: string; positionSeconds?: number }
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
  private follow: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private media: { identity: string; handle: string } | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
  ) {
    session.onReset(() => {
      this.end();
      this.media = undefined;
      this.box.update('playback', () => initialPlayback);
    });
  }

  /** Ask the server for a plan and follow its session. Replaces whatever played before. */
  async start(target: PlaybackTarget): Promise<void> {
    await this.stop();
    const run = {};
    this.run = run;
    this.patch({ ...initialPlayback, phase: 'starting', target });
    await this.request({ run, target, key: `play-${target.kind}-${target.id}-${randomId()}` }, 0, 0);
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
        client: this.session.client,
        idempotencyKey: intent.key,
      });
    } catch (error) {
      if (this.run !== run || epoch !== this.session.epoch) return;
      this.failed(intent, error, attempt, preparation);
      return;
    }
    if (this.run !== run || epoch !== this.session.epoch) return;
    if ('state' in reply && reply.state === 'preparing') {
      const seconds = Math.ceil(reply.retryAfterSeconds);
      if (target.kind !== 'extra' || !Number.isFinite(seconds) || seconds < 1 || preparation >= MAX_PREPARATIONS) {
        this.patch({ phase: 'failed', error: 'Invalid playback preparation response', errorCode: '' });
        return;
      }
      this.patch({ phase: 'preparing', retryAfterSeconds: seconds });
      this.timer = setTimeout(() => void this.request(intent, attempt, preparation + 1), seconds * 1000);
      return;
    }
    const plan = connection.plan(reply as V.PlaybackPlan);
    this.patch({ phase: 'playing', plan, sessionId: plan.sessionId, error: '', errorCode: '', retryAfterSeconds: 0 });
    this.followSession(run, connection, plan.sessionId);
  }

  /** A failure the server allows retrying is retried on its terms (at most twice, within a minute). */
  private failed(intent: Intent, error: unknown, attempt: number, preparation: number): void {
    if (!(error instanceof VelaError)) {
      this.patch({ phase: 'failed', error: message(error, 'Playback failed'), errorCode: '' });
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
      this.patch({ plan, phase: plan.state === 'ended' ? 'ended' : 'playing' });
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

  /** A player's session command (seek, pause, track change, path switch, fallback, stop). */
  async command(sessionId: string, command: V.SessionCommand): Promise<void> {
    try {
      const connection = await this.session.ready();
      const api = connection.adapter;
      let plan: V.PlaybackPlan;
      try {
        plan = await sendCommand(api, sessionId, command);
      } catch (error) {
        // A stop can race an authorized seek or switch. Retry once only when the server supplies
        // authoritative generations, with a new key because the rejected precondition is itself
        // idempotently recorded.
        const stale = error instanceof VelaError && error.detail.code === 'stale_generation';
        const generations = stale ? error.detail.currentGenerations : undefined;
        if (command.kind !== 'stop' || !generations) throw error;
        plan = await api.command(sessionId, { kind: 'stop', ...generations, idempotencyKey: this.session.key() });
      }
      if (this.box.get().playback.sessionId === sessionId) this.patch({ plan: connection.plan(plan) });
    } catch (error) {
      if (this.box.get().playback.sessionId === sessionId) this.patch({ error: message(error, 'Playback command failed') });
    }
  }

  /** The player's progress report. */
  async observe(sessionId: string, observation: V.PlayerObservation): Promise<void> {
    const connection = await this.session.ready();
    await connection.adapter.reportObservation(sessionId, observation);
  }

  /** A player snapshot: live status (reconnecting, delivery, drift) when the engine observes it. */
  snapshot(snapshot: LiveObservation): void {
    const live = liveStatus(snapshot);
    const current = this.box.get().playback.live;
    if (JSON.stringify(live) !== JSON.stringify(current)) this.patch({ live });
  }

  /** Stop playing: the server releases the session at the plan's generations. */
  async stop(): Promise<void> {
    const plan = this.box.get().playback.plan;
    this.end();
    this.box.update('playback', () => initialPlayback);
    if (!plan || plan.state === 'ended') return;
    try {
      const connection = await this.session.ready();
      await connection.adapter.command(plan.sessionId, {
        kind: 'stop',
        sourceGeneration: plan.sourceGeneration,
        seekGeneration: plan.seekGeneration,
        idempotencyKey: `stop-${plan.sessionId}-${plan.sourceGeneration}-${plan.seekGeneration}`,
      });
    } catch {
      // Ended, expired or already stopped: the server holds nothing for it.
    }
  }

  private end(): void {
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
