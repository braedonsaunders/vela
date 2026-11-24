// Playback: the plan for a title, extra or channel; following the session while it plays (the
// server's event stream, or snapshot reads for a server without one); the player's session
// commands and observations; and stopping. Media credentials never enter state: the trusted host
// asks `mediaAccess()` and hands the result straight to the native player.
import type * as V from '../wire';
import { hasSubtitleSearch } from '../adapter/media-actions';
import type { Connection } from '../adapter/connection';
import { sendCommand } from '../adapter/commands';
import { hasEventStream, hasLibraryLive, hasTrickplaySheets, hasVersions } from '../adapter/capabilities';
import type { TrickplayFrame } from '../protocol/trickplay';
import { TrickplayCache } from './trickplay';
import { finalRefusal, serverRefused, startRefusal, startRetry } from './start-retry';
import { heardEngine, heardServer, QUIET_SECONDS, stallDeadline, stallVerdict, stallWatch, type StallSample, type StallWatch } from './stall';
import { liveStatus, type LiveObservation } from '../live/player';
import type { Watched } from '../discovery/progress';
import { followSession, forgetSession } from '../protocol/events';
import { randomId } from '../protocol/id';
import { commandFailure, staleGeneration, type CommandOrigin } from './command-failure';
import { VelaError } from '../adapter/errors';
import { hasColdVersion, sessionVersionsOf, type SessionVersions } from './session-versions';
import type { Session } from './session';
import type { StateBox } from './state';
import type { VelaState } from './index';

export type PlaybackTarget =
  | { kind: 'title'; id: string; positionSeconds?: number; mediaSourceId?: string; audioTrackId?: string; versionId?: string; context?: V.PlayContext }
  | { kind: 'extra'; id: string }
  | { kind: 'channel'; id: string }
  /** A programme from the channel's archive (features.liveCatchUp): ended, or with `from: 'start'` on air from its start. */
  | { kind: 'programme'; id: string; channelId: string; from?: 'start'; positionSeconds?: number }
  | { kind: 'library-live'; id: string; libraryId: string; tab?: string };

/** The window start a `timeshift_position_evicted` refusal names, or null for any other error. */
function evictedWindowStart(error: unknown): number | null {
  if (!(error instanceof VelaError) || error.detail.code !== 'timeshift_position_evicted') return null;
  // The bounds ride in `details`, or beside the code on servers that flatten them.
  const start = (error.detail.details as { windowStartSeconds?: unknown } | undefined)?.windowStartSeconds
    ?? (error.detail as unknown as { windowStartSeconds?: unknown }).windowStartSeconds;
  return typeof start === 'number' && Number.isFinite(start) ? start : null;
}

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
  /** After a refused start the server allows retrying: which retry is coming (1, 2, …), else 0. */
  retryAttempt: number;
  live: ReturnType<typeof liveStatus>;
  /**
   * The session's version list as last re-read (`refreshVersions`), for the chrome only: the
   * engines receive `plan`, which a refresh never touches. Null until a read describes one.
   */
  versions: SessionVersions | null;
  /** The live event on air on this live channel (a game the server matched), for the score bug; else null. */
  liveEvent?: V.LiveEventRef | null;
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
  retryAttempt: 0,
  live: null,
  versions: null,
  liveEvent: null,
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

/** The last position the player reported for a session, and whether it said the item ended. */
interface LastPosition { sessionId: string; seconds: number; ended: boolean }

interface Intent {
  run: object;
  target: PlaybackTarget;
  key: string;
}

const MAX_PREPARATIONS = 30;
const POLL_SECONDS = 5;
/** A plan offered with placeholder versions is read once more this long after it starts. */
const COLD_VERSIONS_SECONDS = 4;
/** A server that offers scrub thumbnails only once a session streams is asked again this often, while the viewer scrubs. */
const TRICKPLAY_OFFER_MS = 20_000;

export class Playback {
  /** The current playback's own token: work for an older one stops when this changes. */
  private run: object | undefined;
  private abandoned: V.PlaybackPlan | null = null;
  private recovering = false;
  /** The current playback reached a session: a later drop is recovered patiently. */
  private established = false;
  /** Backoff for asking the server again while a recovery's start requests fail. */
  private recoveryAttempt = 0;
  /** Progress of the current session (stall.ts): when it is stalled, and how many restarts it has had. */
  private stall: StallWatch | undefined;
  /**
   * The viewer's watch its restarts count against: its target and the session its last restart
   * started. A live channel's owner hands each restarted session back (detach, then attach), so the
   * count outlives `end()`; only the viewer (a start, Stop, Try again after giving up) begins afresh.
   */
  private watch: { target: string; session: string; restarts: number } | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private watchdogAt = 0;
  private cursor = 0;
  private localTracks = false;
  private audio: string | undefined;
  private subtitle: string | null | undefined;
  private externalId: string | undefined;
  private follow: AbortController | undefined;
  /** Read the followed session's snapshot now (servers without an event stream), not at the next poll. */
  private followNow: ((sessionId: string) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private media: { identity: string; handle: string } | undefined;
  /** The version read in flight, so a second ask for the same session shares it. */
  private versionsRead: { run: object; sessionId: string; done: Promise<void> } | undefined;
  private versionsTimer: ReturnType<typeof setTimeout> | undefined;

  /** The last progress report in flight, so a stop is followed by a read of what it recorded. */
  private reporting: Promise<unknown> = Promise.resolve();

  /** The last position the player reported for the current session. */
  private lastPosition: LastPosition | undefined;

  /** The session's scrub thumbnail sheets, and an offer read apart from the plan (`trickplayOffer`). */
  private readonly trickplay = new TrickplayCache();
  private trickplayOffer: { sessionId: string; offer: V.TrickplayMetadata | null; at: number; reading: boolean } | undefined;
  private readonly trickplayListeners = new Set<() => void>();

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
    this.trickplay.subscribe(() => this.trickplayChanged());
    session.onReset(() => {
      this.end();
      this.watch = undefined;
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
          current.target.audioTrackId === target.audioTrackId)) &&
        (target.kind !== 'library-live' || (current.target.kind === 'library-live' &&
          current.target.libraryId === target.libraryId &&
          current.target.tab === target.tab)) &&
        (target.kind !== 'programme' || (current.target.kind === 'programme' &&
          current.target.channelId === target.channelId && current.target.from === target.from))) return;
    const stopping = this.stop();
    const run = {};
    this.run = run;
    this.watch = { target: watchOf(target), session: '', restarts: 0 };
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
    this.established = true;
    // The session this watch's own restart started (the owner handing it back) goes on counting.
    const watch = this.watch;
    if (watch?.target !== watchOf(target) || watch.session !== plan.sessionId) this.watch = { target: watchOf(target), session: plan.sessionId, restarts: 0 };
    this.stall = stallWatch(Date.now(), this.watch!.restarts);
    this.patch({ ...initialPlayback, phase: 'playing', target, plan, sessionId: plan.sessionId });
    this.snapshot({ sessionId: plan.sessionId, live: null, position: plan.positionSeconds ?? 0, state: 'loading' });
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
      if (this.run !== run) return;
      const position = target.kind === 'title' || target.kind === 'programme' ? target.positionSeconds : undefined;
      if (target.kind === 'library-live') {
        if (!this.session.features?.libraryLive?.available || !hasLibraryLive(api)) throw new Error('Library live is unavailable');
        reply = await api.startLibraryLive(target.libraryId, { itemId: target.id, tab: target.tab, liveMode: 'adaptive', client: this.session.client, idempotencyKey: intent.key });
      } else reply = await api.startPlayback({
          ...(target.kind === 'extra' ? { extraId: target.id } : target.kind === 'channel' ? { channelId: target.id }
            : target.kind === 'programme' ? { channelId: target.channelId, programmeId: target.id, ...(target.from ? { from: target.from } : {}) }
            : { titleId: target.id }),
          ...(position !== undefined ? { positionSeconds: position } : {}),
          ...(target.kind === 'title' && target.mediaSourceId ? { mediaSourceId: target.mediaSourceId } : {}),
          ...(target.kind === 'title' && target.versionId ? { versionId: target.versionId } : {}),
          ...(target.kind === 'title' && target.context && this.session.features?.playContexts?.available ? { context: target.context } : {}),
          ...(target.kind === 'title' && target.audioTrackId && !this.recovering ? { audioTrackId: target.audioTrackId } : {}),
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
    let plan = connection.plan(reply as V.PlaybackPlan);
    // A replacement session that already carries the viewer's tracks needs no command, and a live
    // re-tune gets none at all: its tracks are the new stream's (with new ids) and live sessions
    // refuse track commands. Only choices that name a track in the new plan are carried.
    const live = target.kind === 'channel' || target.kind === 'library-live' || (target.kind === 'programme' && target.from === 'start');
    const audio = this.audio !== undefined && plan.audioTracks.some(t => t.id === this.audio) ? this.audio : undefined;
    const subtitle = this.subtitle === null || (this.subtitle !== undefined && plan.subtitleTracks.some(t => t.id === this.subtitle)) ? this.subtitle : undefined;
    const differs = (audio !== undefined && audio !== plan.selectedAudioTrackId)
      || (subtitle !== undefined && subtitle !== (plan.selectedSubtitleTrackId ?? null));
    if (this.recovering && !live && differs) {
      try {
        plan = connection.plan(await this.send(connection, plan.sessionId, {
          kind: 'tracks', audioTrackId: audio, subtitleTrackId: subtitle,
          sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
          idempotencyKey: this.session.key(),
        }));
      } catch {
        // Some servers leave track selection to the engines. Their plan still describes the
        // available tracks, so carry the viewer's choices into the new engine session.
        this.localTracks = true;
        plan = this.withLocalTracks(plan);
      }
      if (this.run !== run) {
        void connection.adapter.command(plan.sessionId, { kind: 'stop', sourceGeneration: plan.sourceGeneration,
          seekGeneration: plan.seekGeneration, idempotencyKey: `cancel-${intent.key}` }).catch(() => {});
        return;
      }
    }
    this.abandoned = null;
    this.recovering = false;
    this.established = true;
    this.recoveryAttempt = 0;
    if (this.watch?.target !== watchOf(target)) this.watch = { target: watchOf(target), session: '', restarts: 0 };
    this.watch.session = plan.sessionId;
    this.stall = stallWatch(Date.now(), this.watch.restarts);
    this.cursor = plan.positionSeconds ?? 0;
    this.patch({ phase: 'playing', plan, sessionId: plan.sessionId, error: '', errorCode: '', errorClass: '', retryAfterSeconds: 0, retryAttempt: 0, versions: null });
    this.snapshot({ sessionId: plan.sessionId, live: null, position: plan.positionSeconds ?? 0, state: 'loading' });
    this.followSession(run, connection, plan.sessionId);
    // Placeholder versions (Play pressed before the title's release search finished) are read
    // again once, shortly after the start; opening the quality menu reads them again too.
    if (hasColdVersion(plan.versions)) {
      const sessionId = plan.sessionId;
      this.versionsTimer = setTimeout(() => {
        this.versionsTimer = undefined;
        if (this.run === run) void this.refreshVersions(sessionId);
      }, COLD_VERSIONS_SECONDS * 1000);
    }
  }

  /**
   * A refused start. A failure the server allows retrying is asked again on its terms
   * (startRetry); anything else ends in the failed state with the server's words. Only a session
   * that was already established keeps recovery's patient backoff, and only through failures
   * that may pass (no answer, a gateway or a server restarting): the server's own refusal ends
   * recovery too, and the session is no longer recovered, so a late engine report cannot ask again.
   */
  private failed(intent: Intent, error: unknown, attempt: number, preparation: number): void {
    if (this.recovering && this.established && !finalRefusal(error) && !serverRefused(error)) { this.scheduleRecovery(intent); return; }
    if (this.recovering) this.established = false;
    this.recovering = false;
    const refusal = startRefusal(error, 'Playback failed');
    const seconds = startRetry(error, attempt);
    this.patch({
      phase: 'failed',
      error: refusal.message,
      errorCode: refusal.code,
      errorClass: refusal.errorClass,
      retryAfterSeconds: seconds,
      retryAttempt: seconds > 0 ? attempt + 1 : 0,
    });
    if (seconds > 0) this.timer = setTimeout(() => void this.request(intent, attempt + 1, preparation), seconds * 1000);
  }

  /** Follow the session until it ends or playback stops: events when the server streams them, else snapshots. */
  private followSession(run: object, connection: Connection, sessionId: string): void {
    const controller = new AbortController();
    this.follow = controller;
    const present = (plan: V.PlaybackPlan) => connection.plan(plan);
    const show = (plan: V.PlaybackPlan) => {
      if (this.run !== run || controller.signal.aborted || plan.sessionId !== sessionId) return;
      plan = this.withLocalTracks(plan);
      if (this.stall && !this.recovering) {
        this.stall = heardServer(this.stall, plan, Date.now());
        this.armWatchdog(sessionId);
      }
      const ended = plan.state === 'ended' && this.box.get().playback.phase !== 'ended';
      this.patch({ plan, phase: plan.state === 'ended' ? 'ended' : 'playing' });
      if (ended) this.afterWatching(plan, this.box.get().playback.target, plan.positionSeconds);
    };
    const adapter = connection.adapter;
    this.followNow = hasEventStream(adapter) ? undefined : id => {
      if (id !== sessionId || this.run !== run || controller.signal.aborted) return;
      void adapter.sessionSnapshot(sessionId).then(snapshot => { if (snapshot.plan.sessionId === sessionId) show(present(snapshot.plan)); }).catch(() => undefined);
    };
    const loop = async () => {
      while (this.run === run && !controller.signal.aborted && this.box.get().playback.phase === 'playing') {
        try {
          if (hasEventStream(adapter)) {
            await followSession(adapter, present, sessionId, show, controller.signal, liveEvent => {
              if (this.run !== run || controller.signal.aborted) return;
              const current = this.box.get().playback.liveEvent;
              if (current?.id !== liveEvent?.id || current?.feed !== liveEvent?.feed) this.patch({ liveEvent });
            });
            if (!controller.signal.aborted && this.box.get().playback.phase !== 'ended') this.recover(sessionId);
            break;
          }
          const snapshot = await adapter.sessionSnapshot(sessionId);
          if (snapshot.plan.sessionId !== sessionId) throw new Error('Invalid session snapshot');
          show(present(snapshot.plan));
          await delay(POLL_SECONDS * 1000, controller.signal);
        } catch {
          if (!controller.signal.aborted) this.recover(sessionId);
          break;
        }
      }
      forgetSession(sessionId);
    };
    void loop();
  }

  private withLocalTracks(plan: V.PlaybackPlan): V.PlaybackPlan {
    if (!this.localTracks) return plan;
    return { ...plan,
      ...(this.audio && plan.audioTracks.some(track => track.id === this.audio) ? { selectedAudioTrackId: this.audio } : {}),
      ...(this.subtitle === null || plan.subtitleTracks.some(track => track.id === this.subtitle) ? { selectedSubtitleTrackId: this.subtitle ?? null } : {}),
    };
  }

  /**
   * Session-level recovery: the session stalled (stall.ts), its media reads failed past the
   * engine's own retries, or the server lost it. One intent owns all triggers. A session that has
   * had its last restart without playing again is not restarted: the viewer is told instead.
   */
  recover(sessionId: string, reason = 'failed'): void {
    const current = this.box.get().playback;
    // Only an established session is recovered: a start that never reached one (no session id)
    // already ended in its own failed or retrying state.
    if (!this.run || !this.established || !sessionId || this.recovering || current.sessionId !== sessionId || !current.target || current.phase === 'ended') return;
    const attempt = this.stall?.attempt ?? this.watch?.restarts ?? 0;
    if (stallVerdict({ attempt }) === 'give-up') {
      console.warn(`Vela playback: session ${sessionId} ${reason} after ${attempt} restart(s); giving up`);
      this.giveUp();
      return;
    }
    console.warn(`Vela playback: session ${sessionId} ${reason}; restart ${attempt + 1} of ${QUIET_SECONDS.length - 1}`);
    this.watch = { target: watchOf(current.target), session: '', restarts: attempt + 1 };
    this.stall = undefined;
    this.recovering = true;
    this.follow?.abort();
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
    this.audio ??= current.plan?.selectedAudioTrackId;
    if (this.subtitle === undefined) this.subtitle = current.plan?.selectedSubtitleTrackId;
    const target = current.target.kind === 'title'
      ? { ...current.target, positionSeconds: this.cursor, audioTrackId: this.audio ?? current.plan?.selectedAudioTrackId }
      : current.target;
    this.patch({ phase: 'preparing', plan: null, error: '', errorClass: '', retryAfterSeconds: 1, versions: null });
    const old = current.plan;
    this.abandoned = old;
    const intent = { run: this.run, target, key: `recover-${randomId()}` };
    this.scheduleRecovery(intent, old);
  }

  private scheduleRecovery(intent: Intent, old: V.PlaybackPlan | null = this.abandoned): void {
    const seconds = [1, 2, 4, 8, 15][Math.min(this.recoveryAttempt++, 4)]!;
    this.patch({ retryAfterSeconds: seconds });
    this.timer = setTimeout(async () => {
      if (this.run !== intent.run) return;
      if (this.box.get().auth?.phase === 'offline') {
        this.scheduleRecovery(intent, old);
        return;
      }
      if (old) {
        try {
          const connection = await this.session.ready();
          if (this.run !== intent.run) return;
          await this.send(connection, old.sessionId, { kind: 'stop', sourceGeneration: old.sourceGeneration,
            seekGeneration: old.seekGeneration, idempotencyKey: `recover-stop-${old.sessionId}` });
        } catch { /* Missing sessions are already released; retry cleanup after connectivity returns. */ }
      }
      if (this.run !== intent.run) return;
      await this.request(intent, 0, 0);
    }, seconds * 1000);
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

  /**
   * A player's session command (seek, pause, track change, path switch, fallback, stop). `origin`
   * says whether the viewer asked for it (a quality pick) or the engine sent it on its own (an
   * automatic or recovery switch). A failure never shows the server's words: the viewer's own
   * command gets viewer copy, and one that lost to a newer generation, or that the engine sent
   * on its own, is dropped silently (the engine plans again from the newer plan).
   */
  async command(sessionId: string, command: V.SessionCommand, origin: CommandOrigin = 'viewer'): Promise<void> {
    const current = this.box.get().playback;
    if (current.sessionId === sessionId && current.error) this.patch({ error: '' });
    try {
      const connection = await this.session.ready();
      const plan = await this.send(connection, sessionId, command, origin);
      if (!this.recovering && this.box.get().playback.sessionId === sessionId) this.patch({ plan: connection.plan(plan) });
    } catch (error) {
      const words = commandFailure(command, error, origin);
      if (words && this.box.get().playback.sessionId === sessionId) this.patch({ error: words });
      // A paused live position the rewind window left behind resumes at the window's start (spec B2).
      const start = evictedWindowStart(error);
      if (start !== null && (command.kind === 'resume' || command.kind === 'seek') && this.box.get().playback.sessionId === sessionId) {
        const plan = this.box.get().playback.plan;
        if (plan) await this.command(sessionId, { kind: 'seek', positionSeconds: start, sourceGeneration: plan.sourceGeneration,
          seekGeneration: plan.seekGeneration, idempotencyKey: this.session.key() }, origin);
      }
    }
  }

  async switchVersion(sessionId: string, versionId: string, positionSeconds?: number): Promise<V.PlaybackPlan> {
    const current = this.box.get().playback;
    const plan = current.sessionId === sessionId ? current.plan : null;
    if (!plan) throw new Error('Playback session is unavailable');
    const connection = await this.session.ready();
    if (!hasVersions(connection.adapter)) throw new Error('Versions are unavailable');
    const next = connection.plan(await connection.adapter.switchVersion(sessionId, {
      kind: 'version', versionId, ...(positionSeconds !== undefined ? { positionSeconds } : {}),
      sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
      idempotencyKey: this.session.key(),
    }));
    if (this.box.get().playback.sessionId === sessionId) this.patch({ plan: next, error: '' });
    return next;
  }

  private async send(connection: Connection, sessionId: string, command: V.SessionCommand, origin: CommandOrigin = 'viewer'): Promise<V.PlaybackPlan> {
    const api = connection.adapter;
    try {
      return await sendCommand(api, sessionId, command);
    } catch (error) {
      // A stop, seek, pause, resume or track change can race a generation the server moved on its own (an
      // authorized switch or recovery). Each names an absolute outcome, so it is retried once
      // when the server supplies the authoritative generations, with a new key because the
      // rejected precondition is itself idempotently recorded. The viewer's own quality pick is
      // still wanted after a version switch, so it is retried the same way while the session
      // still offers its path. A switch the engine sent on its own is tied to the source it was
      // planned against and is not: the engine plans again from the newer plan.
      const generations = staleGeneration(error) ? error.detail.currentGenerations : undefined;
      const absolute = ['stop', 'seek', 'pause', 'resume', 'tracks'].includes(command.kind);
      const wanted = command.kind === 'switch' && origin === 'viewer' && this.offersPath(sessionId, command.pathId);
      if ((!absolute && !wanted) || !generations) throw error;
      return sendCommand(api, sessionId, { ...command, ...generations, idempotencyKey: this.session.key() });
    }
  }

  private offersPath(sessionId: string, pathId: string): boolean {
    const { plan } = this.box.get().playback;
    return plan?.sessionId === sessionId && plan.paths.some(path => path.id === pathId);
  }

  /** Read the session's authoritative plan again (the player found its grant expired or a reply stale).
   * False when the session is gone (the server ended it, or it cannot be read): the caller starts over. */
  async refresh(sessionId: string): Promise<boolean> {
    try {
      const connection = await this.session.ready();
      const snapshot = await connection.adapter.sessionSnapshot(sessionId);
      if (snapshot.plan.sessionId !== sessionId) throw new Error('Invalid session snapshot');
      if (snapshot.plan.state === 'ended') return false;
      if (!this.recovering && this.box.get().playback.sessionId === sessionId) this.patch({ plan: connection.plan(snapshot.plan) });
      return true;
    } catch {
      // The caller starts over; the server's words are not the viewer's.
      return false;
    }
  }

  /**
   * Read the session's version list again (the viewer opened the quality menu). Only the list,
   * the current choice and the remembered choice change, in `versions`: never the plan, its
   * generations or the engine. One read at a time per session; a failed read keeps the list.
   */
  refreshVersions(sessionId: string): Promise<void> {
    const run = this.run;
    const current = this.box.get().playback;
    if (!run || this.recovering || !sessionId || current.sessionId !== sessionId || current.phase !== 'playing' || !current.plan?.versions?.length) return Promise.resolve();
    if (this.versionsRead?.run === run && this.versionsRead.sessionId === sessionId) return this.versionsRead.done;
    const read = { run, sessionId, done: Promise.resolve() };
    read.done = (async () => {
      try {
        const connection = await this.session.ready();
        const snapshot = await connection.adapter.sessionSnapshot(sessionId);
        if (this.run !== run || this.recovering || this.box.get().playback.sessionId !== sessionId) return;
        if (snapshot?.plan?.sessionId !== sessionId) return;
        const versions = sessionVersionsOf(snapshot.plan);
        if (versions) this.patch({ versions });
      } catch {
        // The menu keeps the list it has; the next open asks again.
      } finally {
        if (this.versionsRead === read) this.versionsRead = undefined;
      }
    })();
    this.versionsRead = read;
    return read.done;
  }

  /** The player's progress report. */
  async observe(sessionId: string, observation: V.PlayerObservation): Promise<V.Ack> {
    const ended = observation.state === 'ended';
    this.lastPosition = { sessionId, seconds: observation.positionSeconds, ended };
    // Known as in flight at once, so a stop issued right after (an advance, Stop) waits for it.
    const sent = this.session.ready().then(connection => connection.adapter.reportObservation(sessionId, observation));
    this.reporting = sent.catch(() => undefined);
    // A session may go on past the player's end (a multi-part title's next part): show its plan at once.
    if (ended) void sent.then(() => this.followNow?.(sessionId), () => undefined);
    return sent;
  }

  /** A player snapshot: live status (reconnecting, delivery, drift) when the engine observes it. */
  snapshot(snapshot: LiveObservation & StallSample & { audioTrackId?: string | null; subtitleTrackId?: string | null }): void {
    const current = this.box.get().playback;
    if (snapshot.sessionId !== current.sessionId || this.recovering) return;
    if (snapshot.position !== undefined) this.cursor = snapshot.position;
    if (snapshot.state === 'playing' || snapshot.state === 'paused') {
      if (snapshot.audioTrackId) this.audio = snapshot.audioTrackId;
      if (snapshot.subtitleTrackId !== undefined) this.subtitle = snapshot.subtitleTrackId;
    }
    if (this.stall && snapshot.sessionId && current.phase === 'playing') {
      this.stall = heardEngine(this.stall, snapshot, Date.now());
      this.armWatchdog(snapshot.sessionId);
    }
    const live = liveStatus(snapshot);
    if (JSON.stringify(live) !== JSON.stringify(current.live)) this.patch({ live });
  }

  /**
   * Gapless audio: ask for `target`'s plan ahead of time while the current session plays on. Nothing
   * in state changes and nothing follows it: the caller `adopt`s it when its engine moves on to it,
   * or `release`s it. Null when the server prepares rather than plans or the sign-in changed meanwhile.
   */
  async prepare(target: Extract<PlaybackTarget, { kind: 'title' }>): Promise<V.PlaybackPlan | null> {
    const epoch = this.session.epoch;
    const connection = await this.session.ready();
    await this.session.negotiate(connection.adapter);
    const reply = await connection.adapter.startPlayback({
      titleId: target.id,
      ...(target.positionSeconds !== undefined ? { positionSeconds: target.positionSeconds } : {}),
      ...(target.context && this.session.features?.playContexts?.available ? { context: target.context } : {}),
      // A server with queued sessions keeps the playing one until this one is first observed playing.
      ...(this.queuedPlayback ? { queued: true } : {}),
      client: this.session.client,
      idempotencyKey: `prepare-title-${target.id}-${randomId()}`,
    });
    if (!('sessionId' in reply)) return null;
    const plan = connection.plan(reply as V.PlaybackPlan);
    if (epoch !== this.session.epoch) { this.release(plan); return null; }
    return plan;
  }

  /** The server opens a prepared plan beside the playing session (features.queuedPlayback): asking for
   * it early ends nothing. Without it a server may end the device's playing session (Ether did). */
  get queuedPlayback(): boolean { return !!this.session.features?.queuedPlayback?.available; }

  /** Give back a prepared plan that will not play: the server releases its session. */
  release(plan: V.PlaybackPlan): void {
    void (async () => {
      const connection = await this.session.ready();
      await connection.adapter.command(plan.sessionId, { kind: 'stop', sourceGeneration: plan.sourceGeneration,
        seekGeneration: plan.seekGeneration, idempotencyKey: `release-${plan.sessionId}` });
    })().catch(() => undefined);
  }

  /**
   * Make a prepared plan the playing one (the engine moved on to it, or the viewer skipped to it).
   * The session that was playing stops exactly as `stop` stops it, after its last report, and the
   * prepared one is followed from here on.
   */
  adopt(target: PlaybackTarget, plan: V.PlaybackPlan): void {
    const previous = this.box.get().playback;
    const old = previous.plan ?? this.abandoned;
    const last = old && this.lastPosition?.sessionId === old.sessionId ? this.lastPosition : undefined;
    const reported = this.reporting;
    this.end();
    const run = {};
    this.run = run;
    this.established = true;
    this.watch = { target: watchOf(target), session: plan.sessionId, restarts: 0 };
    this.cursor = plan.positionSeconds ?? 0;
    this.patch({ ...initialPlayback, phase: 'playing', target, plan, sessionId: plan.sessionId });
    this.snapshot({ sessionId: plan.sessionId, live: null, position: plan.positionSeconds ?? 0, state: 'loading' });
    void this.session.ready().then(connection => { if (this.run === run) this.followSession(run, connection, plan.sessionId); }, () => undefined);
    if (old && old.state !== 'ended' && old.sessionId !== plan.sessionId) void this.finish(old, previous.target, previous.phase, last, reported);
  }

  /** Stop playing: the server releases the session at the plan's generations. */
  async stop(): Promise<void> {
    const { target, phase } = this.box.get().playback;
    const plan = this.box.get().playback.plan ?? this.abandoned;
    const last = plan && this.lastPosition?.sessionId === plan.sessionId ? this.lastPosition : undefined;
    this.end();
    this.watch = undefined;
    this.box.update('playback', () => initialPlayback);
    if (!plan || plan.state === 'ended') return;
    await this.finish(plan, target, phase, last, this.reporting);
  }

  /** The current session's stall deadline, armed again whenever it moves (stall.ts). */
  private armWatchdog(sessionId: string): void {
    const deadline = this.stall ? stallDeadline(this.stall) : null;
    if (this.watchdog && deadline === this.watchdogAt) return;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
    if (deadline === null) return;
    this.watchdogAt = deadline;
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      const now = Date.now(), stall = this.stall;
      const reason = stall ? `stalled (nothing moved for ${Math.round((now - stall.heard) / 1000)} s, not played for ${Math.round((now - stall.moved) / 1000)} s)` : 'stalled';
      this.recover(sessionId, reason);
    }, Math.max(0, deadline - Date.now()));
  }

  /**
   * The session stalled through its last restart: playback ends in the failed state (the
   * chrome's error with Try again, which starts afresh where the viewer was) and the server
   * releases the session, instead of the player being re-created forever.
   */
  private giveUp(): void {
    const current = this.box.get().playback;
    const plan = current.plan ?? this.abandoned;
    const last = plan && this.lastPosition?.sessionId === plan.sessionId ? this.lastPosition : undefined;
    this.follow?.abort();
    this.follow = undefined;
    this.followNow = undefined;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.stall = undefined;
    this.watch = undefined;
    this.recovering = false;
    this.established = false;
    this.abandoned = null;
    this.patch({ phase: 'failed', plan: null, sessionId: '', error: '', errorCode: 'playback_stalled', errorClass: 'transient',
      retryAfterSeconds: 0, retryAttempt: 0, versions: null, live: null });
    if (plan && plan.state !== 'ended') void this.finish(plan, current.target, current.phase, last, this.reporting);
  }

  /** Release a session that played, then publish the resume state the server kept for it. */
  private async finish(plan: V.PlaybackPlan, target: PlaybackTarget | null, phase: PlaybackPhase, last: LastPosition | undefined, reported: Promise<unknown>): Promise<void> {
    let confirmedPosition: number | undefined;
    try {
      await reported;
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
    if (phase !== 'ended') this.afterWatching(plan, target, confirmedPosition, last, reported);
  }

  /**
   * Publish persisted resume state only. The player's raw cursor can be below the server's
   * resume threshold; drawing it optimistically would make the title action flicker.
   */
  private afterWatching(plan: V.PlaybackPlan, target: PlaybackTarget | null, confirmedPosition?: number,
    last = this.lastPosition?.sessionId === plan.sessionId ? this.lastPosition : undefined, reported = this.reporting): void {
    const titleId = plan.titleId ?? (target?.kind === 'title' ? target.id : '');
    if (!titleId || plan.purpose === 'preview') return;
    const finished = plan.state === 'ended' || last?.ended === true;
    if (!last && !finished) return;
    const watched: Watched = { titleId, positionSeconds: confirmedPosition ?? last?.seconds ?? 0, finished };
    // Resume eligibility belongs to the server (Ether, for example, drops positions below
    // 5%). Publish only its answer, never a local position that will immediately disappear.
    if (confirmedPosition !== undefined) this.watched(watched);
    void reported.then(() => this.reconcile(watched));
  }

  private end(): void {
    this.trickplay.clear();
    this.trickplayOffer = undefined;
    this.abandoned = null;
    this.recovering = false;
    this.established = false;
    this.recoveryAttempt = 0;
    this.stall = undefined;
    this.cursor = 0;
    this.localTracks = false;
    this.audio = undefined;
    this.subtitle = undefined;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
    this.externalId = undefined;
    this.run = undefined;
    this.follow?.abort();
    this.follow = undefined;
    this.followNow = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.versionsTimer) clearTimeout(this.versionsTimer);
    this.versionsTimer = undefined;
    this.versionsRead = undefined;
  }

  /**
   * The scrub thumbnail at title time `seconds` of the playing session, or null: none offered, no
   * frame there yet, or its sheet still on its way (`onTrickplay` hears when it lands). The image
   * is a `data:` URI; the sheet was read with the session's credentials, which never leave core.
   */
  trickplayFrame(sessionId: string, seconds: number): TrickplayFrame | null {
    const { plan } = this.box.get().playback;
    if (!plan || plan.sessionId !== sessionId || plan.live || plan.channelId) return null;
    const offer = plan.trickplay ?? this.readTrickplayOffer(sessionId);
    if (!offer) return null;
    return this.trickplay.frame(sessionId, plan.sourceGeneration, offer, seconds, async (index, etag, signal) => {
      const connection = await this.session.ready();
      return hasTrickplaySheets(connection.adapter) ? connection.adapter.trickplaySheet(sessionId, offer, index, etag, signal) : null;
    });
  }

  /** Hear when a scrub thumbnail sheet (or a late offer) arrives. */
  onTrickplay(listener: () => void): () => void {
    this.trickplayListeners.add(listener);
    return () => this.trickplayListeners.delete(listener);
  }

  private trickplayChanged(): void {
    for (const listener of [...this.trickplayListeners]) listener();
  }

  /** The offer of a server that tells it apart from the plan, read now and then while asked for. */
  private readTrickplayOffer(sessionId: string): V.TrickplayMetadata | null {
    const held = this.trickplayOffer?.sessionId === sessionId ? this.trickplayOffer : undefined;
    if (held && (held.reading || Date.now() - held.at < TRICKPLAY_OFFER_MS)) return held.offer;
    const entry = { sessionId, offer: held?.offer ?? null, at: Date.now(), reading: true };
    this.trickplayOffer = entry;
    void (async () => {
      let asked = false;
      try {
        const connection = await this.session.ready();
        const adapter = connection.adapter;
        if (hasTrickplaySheets(adapter) && adapter.trickplayOffer) {
          asked = true;
          entry.offer = await adapter.trickplayOffer(sessionId);
        }
      } catch {
        // No thumbnails this time; the next scrub asks again.
      } finally {
        entry.reading = false;
        // A server with no such read is never asked again for this session.
        entry.at = asked ? Date.now() : Number.POSITIVE_INFINITY;
        if (this.trickplayOffer === entry && entry.offer) this.trickplayChanged();
      }
    })();
    return entry.offer;
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

/** What a watch is of, whatever position or track a restart asks it again at. */
function watchOf(target: PlaybackTarget): string {
  return JSON.stringify([target.kind, target.id,
    target.kind === 'programme' ? [target.channelId, target.from ?? ''] : target.kind === 'library-live' ? [target.libraryId, target.tab ?? ''] : []]);
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
