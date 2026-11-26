import type { Downloads } from './downloads';
// Playback: the plan for a title, extra or channel; following the session while it plays (the
// server's event stream, or snapshot reads for a server without one); the player's session
// commands and observations; and stopping. Media credentials never enter state: the trusted host
// asks `mediaAccess()` and hands the result straight to the native player.
import type * as V from '../wire';
import { hasSubtitleSearch, type SubtitleLanguages, type SubtitleSearchResult } from '../adapter/media-actions';
import { deviceLanguages, type SubtitleLanguage } from '../subtitle-languages';
import type { Connection } from '../adapter/connection';
import { sendCommand } from '../adapter/commands';
import { hasEventStream, hasLibraryLive, hasTrickplaySheets, hasUnloadStop, hasVersions, type UnloadRequest } from '../adapter/capabilities';
import type { ServerAdapter } from '../adapter';
import type { TrickplayFrame } from '../protocol/trickplay';
import { TrickplayCache } from './trickplay';
import { finalRefusal, serverRefused, startRefusal, startRetry } from './start-retry';
import { engineCommandAnswered, engineCommandSent, heardEngine, heardServer, QUIET_SECONDS, stallDeadline, stallVerdict, stallWatch, type StallSample, type StallWatch } from './stall';
import { liveStatus, type LiveObservation } from '../live/player';
import type { Watched } from '../discovery/progress';
import { followSession, forgetSession } from '../protocol/events';
import { randomId } from '../protocol/id';
import { commandFailure, staleGeneration, type CommandOrigin } from './command-failure';
import { VelaError } from '../adapter/errors';
import { hasColdVersion, sessionVersionsOf, type SessionVersions } from './session-versions';
import { withPlaying } from './playing-release';
import { serverEnd } from './server-end';
import { carriedTrack, trackChoice, type TrackChoice } from './track-match';
import { episodeAfter, type EpisodeRef } from '../adapter/series';
import { matchSeriesTracks, playableLocally } from '../series-tracks';
import type { ArchiveRange } from '../live/timeshift';
import type { SeriesTracks } from './series-tracks';
import type { Session } from './session';
import { message, type StateBox } from './state';
import type { VelaState } from './index';

export type PlaybackTarget =
  /** `audio`: the app's audio engine plays it (music, audiobooks, podcasts), so the request declares what that engine plays. */
  | { kind: 'title'; id: string; showId?: string; airDate?: string; positionSeconds?: number; mediaSourceId?: string; audioTrackId?: string; versionId?: string; context?: V.PlayContext; audio?: true;
    /** The title's media class when the caller knows it (the audio queue does): a class that never
     * enters Continue (music) is not followed by a read of Home's progress shelves. Not sent. */
    media?: V.MediaClass }
  | { kind: 'extra'; id: string }
  | { kind: 'channel'; id: string }
  /** A programme from the channel's archive (features.liveCatchUp): ended, or with `from: 'start'` on air from its start. */
  | { kind: 'programme'; id: string; channelId: string; from?: 'start'; range?: ArchiveRange; positionSeconds?: number }
  | { kind: 'library-live'; id: string; libraryId: string; tab?: string };

export type PlaybackPhase = 'idle' | 'starting' | 'preparing' | 'playing' | 'ended' | 'failed';
export type OriginalLostResult = 'reopened' | 'version_unavailable' | 'gone' | 'superseded';

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
  /** Asked again under a new key after the server answered with a session that had already ended. */
  fresh?: boolean;
}

/** How many sessions this client stopped are remembered (`stoppedSessions`). */
const STOPPED_REMEMBERED = 32;

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
  /**
   * Sessions this client stopped, newest last. A start the server answers with one of them (Ether
   * replayed a just-stopped session, state still `ready`, to a recovery's fresh key) has no session.
   */
  private readonly stoppedSessions: string[] = [];
  /**
   * Sessions this client opened and has not finished stopping, each with the adapter that opened it
   * and its latest plan: what a page being unloaded stops (`stopOnUnload`). A failed stop stays
   * eligible for cleanup. An attached session is its owner's, never held.
   */
  private readonly held = new Map<string, { adapter: ServerAdapter; plan: V.PlaybackPlan; epoch: number; owner?: { connection: Connection; viewer: string } }>();
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
  /** The file `audio` and `subtitle` were chosen on and what those tracks were there (track-match.ts). */
  private audioChoice: TrackChoice | undefined;
  private subtitleChoice: TrackChoice | undefined;
  /** `subtitle` is null because the viewer turned subtitles off, not because none was ever on. */
  private subtitleOff = false;
  /** What the player last reported for subtitles on the current source; undefined before its first report there. */
  private subtitleReported: string | null | undefined;
  /** Series-track context for the active title session: server, viewer, title and series ID. */
  private sessionContext: { sessionId: string; serverId: string; viewerId: string; titleId: string; showId?: string; connection: Connection } | undefined;
  private externalId: string | undefined;
  private follow: AbortController | undefined;
  /** Read the followed session's snapshot now (servers without an event stream), not at the next poll. */
  private followNow: ((sessionId: string) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private media: { identity: string; handle: string } | undefined;
  /** Told when a new grant replaces an earlier one for the same session (`followMediaAccess`). */
  private readonly mediaListeners = new Set<() => void>();
  /** The version read in flight, so a second ask for the same session shares it. */
  private versionsRead: { run: object; sessionId: string; done: Promise<void> } | undefined;
  private versionsTimer: ReturnType<typeof setTimeout> | undefined;

  /** The last progress report in flight, so a stop is followed by a read of what it recorded. */
  private reporting: Promise<V.Ack | undefined> = Promise.resolve(undefined);

  /** The last position the player reported for the current session. */
  private lastPosition: LastPosition | undefined;

  /** The session's scrub thumbnail sheets, and an offer read apart from the plan (`trickplayOffer`). */
  private readonly trickplay = new TrickplayCache();
  private trickplayOffer: { sessionId: string; sourceGeneration: number; offer: V.TrickplayMetadata | null; at: number; reading: boolean } | undefined;
  private readonly trickplayListeners = new Set<() => void>();

  /**
   * `watched` receives only server-confirmed resume state after stop/end, and `reconcile`
   * refreshes the page after the last report (with the stopped title's media class, when known).
   * A session with no reports changes no resume.
   */
  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly watched: (watched: Watched) => void,
    private readonly reconcile: (watched: Watched, media?: V.MediaClass) => void,
    private readonly seriesTracks?: SeriesTracks,
    private readonly downloads?: Downloads,
  ) {
    this.trickplay.subscribe(() => this.trickplayChanged());
    session.onReset(kind => {
      const plan = this.box.get().playback.plan ?? this.abandoned;
      if (kind === 'server' && !this.externalId && plan && this.held.has(plan.sessionId)) void this.stop();
      else {
        this.end();
        this.watch = undefined;
        this.box.update('playback', () => initialPlayback);
      }
      this.media = undefined;
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
          current.target.channelId === target.channelId && current.target.from === target.from &&
          current.target.range?.startAt === target.range?.startAt && current.target.range?.durationSeconds === target.range?.durationSeconds))) return;
    const stopping = this.stop();
    const run = {};
    this.run = run;
    this.watch = { target: watchOf(target), session: '', restarts: 0 };
    this.patch({ ...initialPlayback, phase: 'starting', target });
    await stopping;
    if (this.run !== run) return;
    if (target.kind === 'title' && !target.audio && this.downloads) {
      try {
        const plan = await this.downloads.planFor(target.id, {
          positionSeconds: target.positionSeconds,
          versionId: target.versionId,
          sourceId: target.mediaSourceId,
        });
        if (this.run !== run) return;
        if (plan) {
          await this.downloads.detailFor(target.id);
          if (this.run !== run) return;
          this.cursor = plan.positionSeconds;
          this.patch({ phase: 'playing', plan, sessionId: plan.sessionId });
          return;
        }
      } catch (error) {
        if (this.run === run) this.patch({ phase: 'failed', error: message(error, 'Could not open download') });
        return;
      }
    }
    if (this.box.get().auth?.phase === 'offline') {
      this.patch({ phase: 'failed', error: 'This title is unavailable offline' });
      return;
    }
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
    let viewerId = '';
    let initialShowId: string | undefined;
    let showIdLookup: Promise<string | undefined> | undefined;
    let reply: V.PlaybackPlan | V.PlaybackPreparing;
    try {
      connection = await this.session.ready();
      const api = connection.adapter;
      await this.session.negotiate(api);
      if (this.run !== run) return;
      viewerId = (await this.session.tokens?.(connection))?.viewer.id ?? '';
      if (this.run !== run) return;
      if (this.seriesTracks && target.kind === 'title' && !target.audio) {
        initialShowId = target.showId || this.cachedShowId(target.id);
        const serverId = connection.record?.id ?? '';
        if (!this.recovering && !initialShowId && serverId && viewerId && this.seriesTracks.hasForViewer(serverId, viewerId)) {
          showIdLookup = api.detail(target.id).then(detail => (detail.title.kind === 'episode' ? detail.title.showId : undefined)).catch(() => undefined);
        }
      }
      const position = target.kind === 'title' || target.kind === 'programme' ? target.positionSeconds : undefined;
      if (target.kind === 'library-live') {
        if (!this.session.features?.libraryLive?.available || !hasLibraryLive(api)) throw new Error('Library live is unavailable');
        reply = await api.startLibraryLive(target.libraryId, { itemId: target.id, tab: target.tab, liveMode: 'adaptive', client: this.session.client, idempotencyKey: intent.key });
      } else reply = await api.startPlayback({
          ...(target.kind === 'extra' ? { extraId: target.id } : target.kind === 'channel' ? { channelId: target.id }
            : target.kind === 'programme' ? { channelId: target.channelId, ...(target.range ?? { programmeId: target.id, ...(target.from ? { from: target.from } : {}) }) }
            : { titleId: target.id }),
          ...(position !== undefined ? { positionSeconds: position } : {}),
          ...(target.kind === 'title' && target.mediaSourceId ? { mediaSourceId: target.mediaSourceId } : {}),
          ...(target.kind === 'title' && target.versionId ? { versionId: target.versionId } : {}),
          ...(target.kind === 'title' && target.context && this.session.features?.playContexts?.available ? { context: target.context } : {}),
          ...(target.kind === 'title' && target.audioTrackId && !this.recovering ? { audioTrackId: target.audioTrackId } : {}),
          client: target.kind === 'title' && target.audio ? this.session.audioClient : this.session.client,
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
        this.stopped(reply.sessionId);
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
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.request(intent, attempt, preparation + 1);
      }, seconds * 1000);
      return;
    }
    let plan = connection.plan(reply as V.PlaybackPlan);
    if (this.deadSession(plan)) {
      this.startedDead(intent, plan, attempt, preparation);
      return;
    }
    this.hold(connection.adapter, plan, viewerId ? { connection, viewer: viewerId } : undefined);
    // A replacement session that already carries the viewer's tracks needs no command, and a live
    // re-tune gets none at all: its tracks are the new stream's (with new ids) and live sessions
    // refuse track commands. Only choices that name a track in the new plan are carried, by id on
    // the same file and by what the track is on another (track-match.ts), and only those the new
    // plan has not selected already. Subtitles that were never on are no choice: the server's stand.
    const live = target.kind === 'channel' || target.kind === 'library-live' || (target.kind === 'programme' && target.from === 'start');
    const { audio: carriedAudio, subtitle: carriedSubtitle } = this.carried(plan);
    const audio = carriedAudio !== plan.selectedAudioTrackId ? carriedAudio : undefined;
    const subtitle = carriedSubtitle !== (plan.selectedSubtitleTrackId ?? null) ? carriedSubtitle : undefined;
    // The new source's reports are measured against its own selection. The choice stays until that player reports.
    if (this.recovering) this.subtitleReported = undefined;
    if (this.recovering && !live && (audio !== undefined || subtitle !== undefined)) {
      if (this.localTracks) {
        // Tracks chosen locally (remembered series choices, or a server that leaves track selection
        // to the engine) stay local across recovery too — never written back to the server.
        plan = this.withLocalTracks(plan);
      } else {
        try {
          plan = connection.plan(await this.send(connection.adapter, plan.sessionId, {
            kind: 'tracks', audioTrackId: audio, subtitleTrackId: subtitle,
            sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
            idempotencyKey: this.session.key(),
          }));
        } catch {
          // Subtitles off refused together with an audio change are asked for on their own: a
          // stream with burned-in subtitles cannot have them removed by the engine. Not once the
          // viewer has moved on: on Plex, Off is also stored as the part's subtitle preference.
          const off = this.run === run && subtitle === null && audio !== undefined && (plan.selectedSubtitleTrackId ?? null) !== null
            ? await this.send(connection.adapter, plan.sessionId, { kind: 'tracks', subtitleTrackId: null, sourceGeneration: plan.sourceGeneration,
              seekGeneration: plan.seekGeneration, idempotencyKey: this.session.key() }).catch(() => undefined)
            : undefined;
          // Some servers leave track selection to the engines. Their plan still describes the
          // available tracks, so carry the viewer's choices, as matched on the new file, into the new engine session; not when
          // the server took Off on its own, which leaves selection with it.
          // Taken after the viewer left, Off still moved the session on: it is stopped where it is now.
          if (off) plan = connection.plan(off);
          else if (this.run === run) {
            this.localTracks = true;
            plan = this.withLocalTracks(plan);
          }
        }
        if (this.run !== run) {
          this.stopped(plan.sessionId);
          const sessionId = plan.sessionId;
          void connection.adapter.command(sessionId, { kind: 'stop', sourceGeneration: plan.sourceGeneration,
            seekGeneration: plan.seekGeneration, idempotencyKey: `cancel-${intent.key}` }).catch(() => {}).finally(() => this.held.delete(sessionId));
          return;
        }
      }
    } else if (this.seriesTracks && !this.recovering && target.kind === 'title' && !target.audio) {
      const showId = initialShowId ?? (showIdLookup ? await showIdLookup : undefined);
      if (this.run !== run || epoch !== this.session.epoch) {
        this.stopped(plan.sessionId);
        const sessionId = plan.sessionId;
        void connection.adapter.command(sessionId, { kind: 'stop', sourceGeneration: plan.sourceGeneration,
          seekGeneration: plan.seekGeneration, idempotencyKey: `cancel-${intent.key}` }).catch(() => {}).finally(() => this.held.delete(sessionId));
        return;
      }
      this.sessionContext = { sessionId: plan.sessionId, serverId: connection.record.id, viewerId, titleId: target.id, showId, connection };
      const preference = showId && viewerId ? this.seriesTracks?.get(connection.record.id, viewerId, showId) : undefined;
      if (preference) {
        let client: V.ClientCapabilities | undefined;
        try { client = this.session.client; } catch { /* Capabilities optional for matching. */ }
        const matched = matchSeriesTracks(plan, preference, { explicitAudio: !!target.audioTrackId, client });
        const audioDiff = matched.audioTrackId !== undefined && matched.audioTrackId !== plan.selectedAudioTrackId;
        const subtitleDiff = matched.subtitleTrackId !== undefined && matched.subtitleTrackId !== (plan.selectedSubtitleTrackId ?? null);
        // A remembered Off is the viewer's even when the episode starts without subtitles: a replacement keeps it.
        // Only a choice that changes the start makes the tracks local; an Off equal to it is just remembered.
        const subtitleOff = matched.subtitleTrackId === null;
        if (audioDiff || subtitleDiff || subtitleOff) {
          if (audioDiff || subtitleDiff) this.localTracks = true;
          if (audioDiff) {
            this.audio = matched.audioTrackId;
            this.audioChoice = trackChoice(plan, plan.audioTracks, this.audio);
          }
          if (subtitleDiff || subtitleOff) {
            this.subtitle = matched.subtitleTrackId;
            this.subtitleChoice = trackChoice(plan, plan.subtitleTracks, this.subtitle ?? undefined);
            this.subtitleOff = this.subtitle === null;
          }
          plan = this.withLocalTracks(plan);
        }
      }
    }
    if (this.seriesTracks && this.recovering && target.kind === 'title' && !target.audio) {
      this.sessionContext = this.sessionContext
        ? { ...this.sessionContext, sessionId: plan.sessionId, connection }
        : { sessionId: plan.sessionId, serverId: connection.record.id, viewerId, titleId: target.id, showId: initialShowId, connection };
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
    const target = intent.target;
    const refusal = startRefusal(error, 'Playback failed', target.kind === 'title' ? target.airDate : undefined);
    const seconds = startRetry(error, attempt);
    this.patch({
      phase: 'failed',
      error: refusal.message,
      errorCode: refusal.code,
      errorClass: refusal.errorClass,
      retryAfterSeconds: seconds,
      retryAttempt: seconds > 0 ? attempt + 1 : 0,
    });
    if (seconds > 0) this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.request(intent, attempt + 1, preparation);
    }, seconds * 1000);
  }

  /** A start answered with a session that has already ended, or that this client stopped. */
  private deadSession(plan: V.PlaybackPlan): boolean {
    return plan.state === 'ended' || this.stoppedSessions.includes(plan.sessionId);
  }

  /** Remember a session this client stops (before the stop is sent: it may land unanswered). */
  private stopped(sessionId: string): void {
    if (!sessionId || this.stoppedSessions.includes(sessionId)) return;
    this.stoppedSessions.push(sessionId);
    if (this.stoppedSessions.length > STOPPED_REMEMBERED) this.stoppedSessions.shift();
  }

  /**
   * The server answered a start with a session that cannot play (`deadSession`): no playable session
   * was started. It is asked once more under a new key; a second such answer is the start's failure,
   * a recovery's included (no further restarts), and the viewer is told.
   */
  private startedDead(intent: Intent, plan: V.PlaybackPlan, attempt: number, preparation: number): void {
    console.warn(`Vela playback: the server answered a start with session ${plan.sessionId}, which has already ended${intent.fresh ? '; giving up' : '; asking again'}`);
    if (!intent.fresh) {
      void this.request({ ...intent, key: `${intent.key}-fresh`, fresh: true }, attempt, preparation);
      return;
    }
    this.recovering = false;
    this.established = false;
    this.abandoned = null;
    this.stall = undefined;
    this.watch = undefined;
    this.patch({ phase: 'failed', plan: null, sessionId: '', error: 'The server answered with a session that had already ended',
      errorCode: 'session_ended', errorClass: 'transient', retryAfterSeconds: 0, retryAttempt: 0, versions: null, live: null });
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
      // A live session the server stopped under the viewer is a failure (Try again), not an end.
      if (ended && serverEnd(this.box.get().playback.target, this.lastPosition?.sessionId === sessionId && this.lastPosition.ended) === 'stopped') {
        console.warn(`Vela playback: session ${sessionId} stopped by the server; giving up`);
        this.giveUp(true);
        return;
      }
      this.patch({ plan, phase: plan.state === 'ended' ? 'ended' : 'playing' });
      if (ended) this.afterWatching(plan, this.box.get().playback.target, plan.positionSeconds);
    };
    const adapter = connection.adapter;
    this.followNow = hasEventStream(adapter) ? undefined : id => {
      if (id !== sessionId || this.run !== run || controller.signal.aborted) return;
      void adapter.sessionSnapshot(sessionId).then(snapshot => { if (snapshot.plan.sessionId === sessionId) show(present(withPlaying(snapshot.plan, snapshot))); }).catch(() => undefined);
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
          show(present(withPlaying(snapshot.plan, snapshot)));
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
    // Only what the engine can switch to on this plan: a muxed transcode keeps the server's tracks.
    const { audio, subtitle } = this.carried(plan);
    let client: V.ClientCapabilities | undefined;
    try { client = this.session.client; } catch { /* Capabilities optional for matching. */ }
    const local = playableLocally(plan, { audioTrackId: audio, subtitleTrackId: subtitle }, client);
    return { ...plan,
      ...(local.audioTrackId !== undefined ? { selectedAudioTrackId: local.audioTrackId } : {}),
      ...(local.subtitleTrackId !== undefined ? { selectedSubtitleTrackId: local.subtitleTrackId } : {}),
    };
  }

  /** The viewer's choices as ids in `plan` (track-match.ts); undefined leaves the plan's own selection. */
  private carried(plan: V.PlaybackPlan): { audio: string | undefined; subtitle: string | null | undefined } {
    return {
      audio: this.audio !== undefined ? carriedTrack(this.audio, this.audioChoice, plan, plan.audioTracks) : undefined,
      subtitle: this.subtitle === null ? (this.subtitleOff ? null : undefined)
        : this.subtitle !== undefined ? carriedTrack(this.subtitle, this.subtitleChoice, plan, plan.subtitleTracks) : undefined,
    };
  }

  /**
   * Remember a viewer's deliberate audio or subtitle choice for the playing episode's series.
   * Called only after the player confirms the viewer's switch took effect; never writes to the server.
   */
  rememberTrack(sessionId: string, kind: 'audio' | 'subtitle', trackId: string | null): void {
    const current = this.box.get().playback;
    if (!sessionId || current.sessionId !== sessionId || current.plan?.sessionId !== sessionId) return;
    if (kind === 'audio' && trackId) {
      this.audio = trackId;
      this.audioChoice = trackChoice(current.plan, current.plan.audioTracks, trackId);
    }
    if (kind === 'subtitle') {
      this.subtitle = trackId;
      this.subtitleChoice = trackChoice(current.plan, current.plan.subtitleTracks, trackId ?? undefined);
      this.subtitleOff = trackId === null;
    }
    if (!this.seriesTracks || this.sessionContext?.sessionId !== sessionId) return;
    const { serverId, viewerId, titleId, connection } = this.sessionContext;
    if (!viewerId) return;
    const track = kind === 'audio'
      ? (trackId ? current.plan.audioTracks.find(t => t.id === trackId) : undefined)
      : (trackId === null ? null : current.plan.subtitleTracks.find(t => t.id === trackId));
    if (track === undefined) return;
    const save = (showId: string) => {
      if (kind === 'audio') this.seriesTracks!.rememberAudio(serverId, viewerId, showId, track as V.Track);
      else this.seriesTracks!.rememberSubtitle(serverId, viewerId, showId, track as V.Track | null);
    };
    const showId = this.sessionContext.showId || this.cachedShowId(titleId);
    if (showId) {
      this.sessionContext.showId = showId;
      save(showId);
      return;
    }
    void connection.adapter.detail(titleId).then(detail => {
      if (detail.title.kind === 'episode' && detail.title.showId) {
        if (this.sessionContext?.sessionId === sessionId) this.sessionContext.showId = detail.title.showId;
        save(detail.title.showId);
      }
    }).catch(() => undefined);
  }

  /** Find an episode's showId from already-loaded state before making any network call. */
  private cachedShowId(titleId: string): string | undefined {
    const state = this.box.get();
    const titles = state.titles ?? {};
    const own = titles[titleId]?.value?.title[0];
    if (own?.kind === 'episode' && own.showId) return own.showId;
    for (const entry of Object.values(titles)) {
      const detail = entry?.value;
      if (!detail) continue;
      const hit = detail.episodes.find(c => c.id === titleId && c.showId)
        ?? detail.nextUp?.find(c => c.id === titleId && c.showId);
      if (hit?.showId) return hit.showId;
    }
    const home = state.home?.value;
    if (home) {
      const hero = home.hero.find(c => c.id === titleId && c.showId);
      if (hero?.showId) return hero.showId;
      for (const row of home.rows) {
        const card = row.items.find(c => c.id === titleId && c.showId);
        if (card?.showId) return card.showId;
      }
    }
    const searchHit = state.search?.fast?.items?.find(c => c.id === titleId && c.showId)
      ?? state.search?.descriptive?.items?.find(c => c.id === titleId && c.showId);
    return searchHit?.showId || undefined;
  }

  /**
   * Session-level recovery: the session stalled (stall.ts), its media reads failed past the
   * engine's own retries, or the server lost it. One intent owns all triggers. A session that has
   * had its last restart without playing again is not restarted: the viewer is told instead.
   */
  recover(sessionId: string, reason = 'failed'): void {
    const run = this.run;
    const current = this.box.get().playback;
    if (sessionId.startsWith('local-') && current.sessionId === sessionId) {
      this.patch({ phase: 'failed', error: 'Could not play this download' });
      return;
    }
    // Only an established session is recovered: a start that never reached one (no session id)
    // already ended in its own failed or retrying state.
    if (!run || !this.established || !sessionId || this.recovering || current.sessionId !== sessionId || !current.target || current.phase === 'ended') return;
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
    if (this.audio === undefined) {
      this.audio = current.plan?.selectedAudioTrackId;
      this.audioChoice = trackChoice(current.plan, current.plan?.audioTracks, this.audio);
    }
    if (this.subtitle === undefined) {
      this.subtitle = current.plan?.selectedSubtitleTrackId;
      this.subtitleChoice = trackChoice(current.plan, current.plan?.subtitleTracks, this.subtitle ?? undefined);
    }
    const target = current.target.kind === 'title'
      ? { ...current.target, positionSeconds: this.cursor, audioTrackId: this.audio ?? current.plan?.selectedAudioTrackId }
      : current.target;
    this.abandoned = current.plan;
    this.patch({ phase: 'preparing', plan: null, error: '', errorClass: '', retryAfterSeconds: 1, versions: null });
    this.scheduleRecovery({ run, target, key: `recover-${randomId()}` });
  }

  private scheduleRecovery(intent: Intent, old: V.PlaybackPlan | null = this.abandoned): void {
    if (this.run !== intent.run || !this.recovering || this.timer !== undefined) return;
    const seconds = [1, 2, 4, 8, 15][Math.min(this.recoveryAttempt++, 4)]!;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      if (this.run !== intent.run || !this.recovering) return;
      if (this.box.get().auth?.phase === 'offline') {
        this.scheduleRecovery(intent, old);
        return;
      }
      if (old) {
        this.stopped(old.sessionId);
        try {
          const connection = await this.session.ready();
          if (this.run !== intent.run) return;
          await this.send(connection.adapter, old.sessionId, { kind: 'stop', sourceGeneration: old.sourceGeneration,
            seekGeneration: old.seekGeneration, idempotencyKey: `recover-stop-${old.sessionId}` });
          this.held.delete(old.sessionId);
        } catch { /* Missing sessions are already released; retry cleanup after connectivity returns. */ }
      }
      if (this.run !== intent.run) return;
      await this.request(intent, 0, 0);
    }, seconds * 1000);
    this.patch({ retryAfterSeconds: seconds });
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
      if (!('sessionId' in reply)) return reply;
      // Its owner stops it through `command`; until then a page being unloaded stops it too.
      const plan = connection.plan(reply);
      if (plan.state !== 'ended') this.hold(connection.adapter, plan);
      return plan;
    },
    command: async (sessionId: string, command: V.SessionCommand): Promise<V.PlaybackPlan> => {
      const connection = await this.session.ready();
      const plan = connection.plan(await this.send(connection.adapter, sessionId, command));
      if (command.kind === 'stop') this.held.delete(sessionId);
      else this.refreshHeld(plan);
      return plan;
    },
    sessionSnapshot: async (sessionId: string): Promise<V.SessionSnapshot> => {
      const connection = await this.session.ready();
      const snapshot = await connection.adapter.sessionSnapshot(sessionId);
      return { ...snapshot, plan: connection.plan(snapshot.plan) };
    },
    reportObservation: (sessionId: string, observation: V.PlayerObservation) => this.observe(sessionId, observation),
  };

  get subtitleSearchAvailable(): boolean {
    if (this.box.get().playback.sessionId.startsWith('local-')) return false;
    try { return hasSubtitleSearch(this.session.selected().adapter); } catch { return false; }
  }

  /** Languages the viewer searched in this run, most recent first: they lead the picker next time. */
  private searchedLanguages: string[] = [];
  /** One session's answer, asked once: the menu asks every time it opens. */
  private languageAnswer?: { sessionId: string; answer: Promise<SubtitleLanguages | null> };

  /** The languages a search takes, the viewer's first (the server's preference, recent searches,
   * the device's languages); null when this server has no subtitle search. */
  async subtitleLanguages(serverPreferred: readonly string[] = []): Promise<{ languages: SubtitleLanguage[]; preferred: string[] } | null> {
    const api = (await this.session.ready()).adapter;
    if (!hasSubtitleSearch(api)) return null;
    const sessionId = this.box.get().playback.sessionId;
    if (this.languageAnswer?.sessionId !== sessionId) {
      const answer = api.subtitleLanguages(sessionId);
      const entry = { sessionId, answer };
      this.languageAnswer = entry;
      answer.catch(() => { if (this.languageAnswer === entry) this.languageAnswer = undefined; });
    }
    const found = await this.languageAnswer.answer;
    if (!found?.languages.length) return null;
    return { languages: found.languages, preferred: [...serverPreferred, ...found.preferred, ...this.searchedLanguages, ...deviceLanguages()] };
  }

  /** Without a language, the server's (or the device's) most preferred one. */
  async searchSubtitles(language?: string): Promise<SubtitleSearchResult> {
    const api = (await this.session.ready()).adapter;
    if (!hasSubtitleSearch(api)) throw new Error('Subtitle search is unavailable on this server');
    const result = await api.searchSubtitles(this.box.get().playback.sessionId, language);
    if (language) this.searchedLanguages = [language, ...this.searchedLanguages.filter(code => code !== language)].slice(0, 4);
    return result;
  }

  /** Adds a found subtitle to the running session; the new track's id, or null when the server
   * added none (it is still indexing) or the session moved on meanwhile. */
  async downloadSubtitle(id: string): Promise<string | null> {
    const connection = await this.session.ready();
    const api = connection.adapter;
    if (!hasSubtitleSearch(api)) throw new Error('Subtitle search is unavailable on this server');
    const sessionId = this.box.get().playback.sessionId;
    const previous = this.box.get().playback.plan;
    const plan = connection.plan(await api.downloadSubtitle(sessionId, id, this.session.key()));
    if (this.box.get().playback.sessionId !== sessionId) return null;
    this.patch({ plan });
    // A new track, or (the same file chosen again) the one the server selected for it.
    const added = plan.subtitleTracks.find(t => !previous?.subtitleTracks.some(p => p.id === t.id))?.id;
    const chosen = plan.selectedSubtitleTrackId && plan.selectedSubtitleTrackId !== previous?.selectedSubtitleTrackId ? plan.selectedSubtitleTrackId : null;
    return added ?? chosen;
  }

  private pendingLiveTransport?: { sessionId: string; result: Promise<boolean> };

  liveTransport(sessionId: string, command: { kind: 'pause' | 'resume' | 'goLive' } | { kind: 'seek'; positionSeconds: number }): Promise<boolean> {
    const queue = this.pendingLiveTransport?.sessionId === sessionId ? this.pendingLiveTransport.result : Promise.resolve();
    const result = queue.then(() => {
      const plan = this.box.get().playback.plan;
      if (!plan?.live || plan.sessionId !== sessionId) return false;
      return this.command(sessionId, { ...command, sourceGeneration: plan.sourceGeneration,
        seekGeneration: plan.seekGeneration, idempotencyKey: this.session.key() });
    });
    this.pendingLiveTransport = { sessionId, result };
    void result.then(() => {
      if (this.pendingLiveTransport?.result === result) this.pendingLiveTransport = undefined;
    });
    return result;
  }

  /**
   * A player's session command (seek, pause, track change, path switch, fallback, stop). `origin`
   * says whether the viewer asked for it (a quality pick) or the engine sent it on its own (an
   * automatic or recovery switch). A failure never shows the server's words: the viewer's own
   * command gets viewer copy, and one that lost to a newer generation, or that the engine sent
   * on its own, is dropped silently (the engine plans again from the newer plan).
   */
  async command(sessionId: string, command: V.SessionCommand, origin: CommandOrigin = 'viewer'): Promise<boolean> {
    const current = this.box.get().playback;
    if (sessionId.startsWith('local-')) {
      const plan = current.sessionId === sessionId ? current.plan : null;
      if (!plan) return false;
      if (command.kind === 'stop') await this.stop();
      if (command.kind === 'pause') await this.checkpointDownload()?.catch(() => {});
      if (command.kind === 'tracks') {
        const { audioTrackId, subtitleTrackId } = command;
        this.patch({ plan: {
          ...plan,
          revision: plan.revision + 1,
          ...(plan.audioTracks.some(t => t.id === audioTrackId) ? { selectedAudioTrackId: audioTrackId } : {}),
          ...(subtitleTrackId === null || plan.subtitleTracks.some(t => t.id === subtitleTrackId) ? { selectedSubtitleTrackId: subtitleTrackId } : {}),
        } });
      }
      // File seeks and pause/resume happen in the native player.
      return true;
    }
    if (current.sessionId === sessionId && current.error) this.patch({ error: '' });
    // The engine recovering on its own (a path switch, a fallback) is not progress (stall.ts).
    const watch = origin === 'engine' || command.kind === 'prepare-fallback' ? this.stall : undefined;
    if (watch && current.sessionId === sessionId) this.stall = engineCommandSent(watch);
    const answered = (plan: V.PlaybackPlan | null) => {
      if (watch && this.stall && current.sessionId === sessionId && this.box.get().playback.sessionId === sessionId) this.stall = engineCommandAnswered(this.stall, plan);
    };
    try {
      const connection = await this.session.ready();
      const plan = await this.send(connection.adapter, sessionId, command, origin);
      answered(plan);
      if (!this.recovering && this.box.get().playback.sessionId === sessionId) {
        let nextPlan = connection.plan(plan);
        if (command.kind === 'tracks') {
          if (command.audioTrackId !== undefined && nextPlan.selectedAudioTrackId) {
            this.audio = nextPlan.selectedAudioTrackId;
            this.audioChoice = trackChoice(nextPlan, nextPlan.audioTracks, this.audio);
          }
          if (command.subtitleTrackId !== undefined) {
            this.subtitle = nextPlan.selectedSubtitleTrackId;
            this.subtitleChoice = trackChoice(nextPlan, nextPlan.subtitleTracks, this.subtitle ?? undefined);
            // Subtitles off the viewer asked for are carried to a replacement; a subtitle asked for ends that.
            if (origin === 'viewer') this.subtitleOff = command.subtitleTrackId === null;
          }
          nextPlan = this.withLocalTracks(nextPlan);
        } else {
          nextPlan = this.withLocalTracks(nextPlan);
        }
        this.patch({ plan: nextPlan });
        return true;
      }
      return false;
    } catch (error) {
      answered(null);
      const words = commandFailure(command, error, origin);
      if (words && this.box.get().playback.sessionId === sessionId) this.patch({ error: words });
      return false;
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
    const now = this.box.get().playback;
    // A restart (stall recovery) asks for the file now playing, not the one first asked for.
    if (now.sessionId === sessionId) {
      // Track IDs and local choices belong to the previous version. Keep the negotiated
      // selection through later snapshots and recovery, even when a track ID is reused.
      this.localTracks = false;
      this.audio = next.selectedAudioTrackId;
      this.subtitle = next.selectedSubtitleTrackId;
      this.audioChoice = trackChoice(next, next.audioTracks, this.audio);
      this.subtitleChoice = trackChoice(next, next.subtitleTracks, this.subtitle ?? undefined);
      this.patch({ plan: next, error: '', ...(now.target?.kind === 'title' ? { target: { ...now.target, versionId: next.selectedVersionId ?? versionId } } : {}) });
    }
    return next;
  }

  private async send(api: ServerAdapter, sessionId: string, command: V.SessionCommand, origin: CommandOrigin = 'viewer',
    canRetry?: () => Promise<boolean>): Promise<V.PlaybackPlan> {
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
      const absolute = ['stop', 'seek', 'pause', 'resume', 'tracks', 'goLive'].includes(command.kind);
      const wanted = command.kind === 'switch' && origin === 'viewer' && this.offersPath(sessionId, command.pathId);
      if ((!absolute && !wanted) || !generations) throw error;
      if (canRetry && !(await canRetry())) throw error;
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
    if (sessionId.startsWith('local-')) return this.box.get().playback.sessionId === sessionId;
    try {
      const connection = await this.session.ready();
      const snapshot = await connection.adapter.sessionSnapshot(sessionId);
      if (snapshot.plan.sessionId !== sessionId) throw new Error('Invalid session snapshot');
      if (snapshot.plan.state === 'ended') {
        const current = this.box.get().playback;
        const playerEnded = this.lastPosition?.sessionId === sessionId && this.lastPosition.ended;
        if (this.recovering || current.sessionId !== sessionId || current.phase !== 'playing' || serverEnd(current.target, playerEnded) !== 'stopped') return false;
        // A live session the server stopped: the viewer is told (Try again), as when its events say so.
        console.warn(`Vela playback: session ${sessionId} stopped by the server; giving up`);
        this.giveUp(true);
        return true;
      }
      if (!this.recovering && this.box.get().playback.sessionId === sessionId) this.patch({ plan: this.withLocalTracks(connection.plan(snapshot.plan)) });
      return true;
    } catch {
      // The caller starts over; the server's words are not the viewer's.
      return false;
    }
  }

  /** A direct original was conclusively lost or truncated. Read the current plan before an end
   * observation or a replacement session can mark the title watched. A newer source generation
   * reopens in the existing session; an explicit version remains pinned and lets the chrome offer
   * another version at the held position. */
  async originalLost(sessionId: string, positionSeconds: number, failedSourceGeneration?: number): Promise<OriginalLostResult> {
    if (sessionId.startsWith('local-')) {
      this.recover(sessionId);
      return 'superseded';
    }
    const run = this.run;
    const epoch = this.session.epoch;
    const current = this.box.get().playback;
    const before = current.plan;
    if (!run || this.recovering || !before || current.sessionId !== sessionId || current.phase !== 'playing') return 'superseded';
    const ownsRead = () => {
      const now = this.box.get().playback;
      return this.run === run && this.session.epoch === epoch && !this.recovering &&
        now.sessionId === sessionId && now.phase === 'playing' &&
        now.plan?.sourceGeneration === before.sourceGeneration && now.plan?.seekGeneration === before.seekGeneration;
    };
    try {
      const connection = await this.session.ready();
      if (!ownsRead()) return 'superseded';
      const snapshot = await connection.adapter.sessionSnapshot(sessionId);
      if (!ownsRead()) return 'superseded';
      if (snapshot.plan.sessionId !== sessionId) return 'gone';
      const plan = this.withLocalTracks(connection.plan(snapshot.plan));
      if (plan.sourceFailure === 'version_unavailable') {
        this.cursor = Math.max(0, positionSeconds);
        this.lastPosition = { sessionId, seconds: this.cursor, ended: false };
        this.patch({ plan, phase: 'playing', versions: sessionVersionsOf(plan) ?? this.box.get().playback.versions });
        return 'version_unavailable';
      }
      if (plan.state === 'ended' || plan.sourceGeneration <= (failedSourceGeneration ?? before.sourceGeneration)) return 'gone';
      this.cursor = plan.positionSeconds;
      this.lastPosition = { sessionId, seconds: plan.positionSeconds, ended: false };
      this.patch({ plan, phase: 'playing', error: '', errorCode: '', errorClass: '' });
      return 'reopened';
    } catch {
      return ownsRead() ? 'gone' : 'superseded';
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
    if (sessionId.startsWith('local-')) {
      const { playback } = this.box.get();
      if (playback.sessionId === sessionId && !observation.error && observation.state !== 'buffering') {
        const ended = observation.state === 'ended';
        this.cursor = observation.positionSeconds;
        this.lastPosition = { sessionId, seconds: observation.positionSeconds, ended };
        await this.checkpointDownload(observation.observedAt);
      }
      return { accepted: true };
    }
    const ended = observation.state === 'ended';
    this.lastPosition = { sessionId, seconds: observation.positionSeconds, ended };
    // Known as in flight at once, so a stop issued right after (an advance, Stop) waits for it.
    const held = this.held.get(sessionId);
    const sent = (async () => {
      if (held?.owner && (await this.session.tokens(held.owner.connection))?.viewer.id !== held.owner.viewer) {
        throw new Error('Playback viewer changed');
      }
      const adapter = held?.adapter ?? (await this.session.ready()).adapter;
      return adapter.reportObservation(sessionId, observation);
    })();
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
    // A report from the session's previous source (queued before the plan moved on) names that
    // source's tracks: the last choice made on the current one stands.
    if (!this.localTracks && (snapshot.state === 'playing' || snapshot.state === 'paused')
      && (snapshot.sourceGeneration === undefined || snapshot.sourceGeneration === current.plan?.sourceGeneration)) {
      if (snapshot.audioTrackId) {
        this.audio = snapshot.audioTrackId;
        this.audioChoice = trackChoice(current.plan, current.plan?.audioTracks, this.audio);
      }
      if (snapshot.subtitleTrackId !== undefined) {
        // Off is the viewer's once a subtitle was on this source: reported, or before any report selected by the plan.
        // A report supersedes the choice; none on a source that selected none leaves no choice.
        const before = this.subtitleReported !== undefined ? this.subtitleReported : current.plan?.selectedSubtitleTrackId ?? null;
        this.subtitleOff = snapshot.subtitleTrackId === null && (this.subtitleOff || before !== null);
        this.subtitleReported = snapshot.subtitleTrackId;
        this.subtitle = snapshot.subtitleTrackId;
        this.subtitleChoice = trackChoice(current.plan, current.plan?.subtitleTracks, this.subtitle ?? undefined);
      }
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
      client: target.audio ? this.session.audioClient : this.session.client,
      idempotencyKey: `prepare-title-${target.id}-${randomId()}`,
    });
    if (!('sessionId' in reply)) return null;
    const plan = connection.plan(reply as V.PlaybackPlan);
    if (this.deadSession(plan)) return null;
    this.hold(connection.adapter, plan);
    if (epoch !== this.session.epoch) { this.release(plan); return null; }
    return plan;
  }

  /** The server opens a prepared plan beside the playing session (features.queuedPlayback): asking for
   * it early ends nothing. Without it a server may end the device's playing session (Ether did). */
  get queuedPlayback(): boolean { return !!this.session.features?.queuedPlayback?.available; }
  /** Seconds a superseded queued session keeps serving after its successor takes over (0: none), so
   * two may overlap in a crossfade (features.queuedPlayback.handoverSeconds). */
  get handoverSeconds(): number {
    const seconds = this.session.features?.queuedPlayback?.handoverSeconds;
    return this.queuedPlayback && typeof seconds === 'number' && seconds > 0 ? seconds : 0;
  }

  /** Give back a prepared plan that will not play: the server releases its session. */
  release(plan: V.PlaybackPlan): void {
    this.stopped(plan.sessionId);
    void (async () => {
      const connection = await this.session.ready();
      await connection.adapter.command(plan.sessionId, { kind: 'stop', sourceGeneration: plan.sourceGeneration,
        seekGeneration: plan.seekGeneration, idempotencyKey: `release-${plan.sessionId}` });
    })().catch(() => undefined).finally(() => this.held.delete(plan.sessionId));
  }

  /**
   * Make a prepared plan the playing one (the engine moved on to it, or the viewer skipped to it).
   * An accepted end report retires the old audio session. A skip or an unreported end still
   * needs an explicit stop. For a crossfade, `finishAfterMs` lets the old session play out
   * within the server's handover before that stop.
   */
  adopt(target: PlaybackTarget, plan: V.PlaybackPlan, options: { finishAfterMs?: number } = {}): void {
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
    if (old && old.state !== 'ended' && old.sessionId !== plan.sessionId) {
      const finish = () => void this.finish(old, previous.target, previous.phase, last, reported, true);
      if (options.finishAfterMs && options.finishAfterMs > 0) setTimeout(finish, options.finishAfterMs);
      else finish();
    }
  }

  /** Persist the latest local position before the app is suspended or the view closes. */
  checkpointDownload(observedAt?: string): Promise<void> | undefined {
    const { sessionId, plan } = this.box.get().playback;
    if (!sessionId.startsWith('local-') || !plan?.titleId || this.lastPosition?.sessionId !== sessionId) return;
    return this.downloads?.recordProgress({
      titleId: plan.titleId,
      positionSeconds: this.cursor,
      durationSeconds: plan.durationSeconds,
      completed: this.lastPosition.ended,
      observedAt,
    });
  }

  /** Stop playing: the server releases the session at the plan's generations. */
  async stop(): Promise<void> {
    const { target, phase } = this.box.get().playback;
    const plan = this.box.get().playback.plan ?? this.abandoned;
    const last = plan && this.lastPosition?.sessionId === plan.sessionId ? this.lastPosition : undefined;
    const checkpoint = this.checkpointDownload()?.catch(() => {});
    this.end();
    this.watch = undefined;
    this.box.update('playback', () => initialPlayback);
    if (plan?.sessionId.startsWith('local-')) {
      await checkpoint;
      void this.downloads?.replayProgress();
      return;
    }
    if (plan?.state === 'ended') this.held.delete(plan.sessionId);
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
   * releases the session, instead of the player being re-created forever. `serverEnded`: the
   * server itself stopped a live session (serverEnd), so there is nothing left to release.
   */
  private giveUp(serverEnded = false): void {
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
    if (plan && (plan.state === 'ended' || serverEnded)) this.held.delete(plan.sessionId);
    else if (plan) void this.finish(plan, current.target, current.phase, last, this.reporting);
  }

  /** Release a session that played, then publish the resume state the server kept for it. */
  private async finish(plan: V.PlaybackPlan, target: PlaybackTarget | null, phase: PlaybackPhase, last: LastPosition | undefined, reported: Promise<V.Ack | undefined>, handedOver = false): Promise<void> {
    const held = this.held.get(plan.sessionId);
    const epoch = held?.epoch ?? this.session.epoch;
    const release = () => {
      if (this.held.get(plan.sessionId) === held) this.held.delete(plan.sessionId);
    };
    const owner = held?.owner;
    let viewerChanged = false;
    const canStop = owner && (async () => {
      if ((await this.session.tokens(owner.connection))?.viewer.id === owner.viewer) return true;
      viewerChanged = true;
      release();
      return false;
    });
    let confirmedPosition: number | undefined;
    try {
      const adapter = held?.adapter ?? (await this.session.ready()).adapter;
      const ack = await reported;
      if (canStop && !(await canStop())) return;
      const endedOnHandover = handedOver && last?.ended && ack?.accepted;
      if (!endedOnHandover) {
        this.stopped(plan.sessionId);
        await this.send(adapter, plan.sessionId, {
          kind: 'stop',
          sourceGeneration: plan.sourceGeneration,
          seekGeneration: plan.seekGeneration,
          idempotencyKey: `stop-${plan.sessionId}-${plan.sourceGeneration}-${plan.seekGeneration}`,
        }, 'viewer', canStop);
      }
      release();
      const titleId = plan.titleId ?? (target?.kind === 'title' ? target.id : '');
      if (epoch === this.session.epoch && titleId && plan.purpose !== 'preview') {
        // Some servers return the raw session cursor even though their resume policy drops
        // it. Read the persisted watch state before publishing any resume UI.
        const detail = await adapter.detail(titleId, true);
        confirmedPosition = detail.title.watch?.positionSeconds;
      }
    } catch {
      // Keep a failed stop eligible for pagehide cleanup.
    }
    if (!viewerChanged && epoch === this.session.epoch && phase !== 'ended') this.afterWatching(plan, target, confirmedPosition, last, reported);
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
    const media = target?.kind === 'title' ? target.media : undefined;
    const epoch = this.session.epoch;
    void reported.then(() => { if (epoch === this.session.epoch) this.reconcile(watched, media); });
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
    this.audioChoice = undefined;
    this.subtitleChoice = undefined;
    this.subtitleOff = false;
    this.subtitleReported = undefined;
    this.sessionContext = undefined;
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
   * The episode after `episode` in its series, for the player's Next episode, or null when it is the
   * last (or its series cannot be read). Read from the server's own title details, whatever its kind.
   */
  async nextEpisode(episode: EpisodeRef): Promise<V.Title | null> {
    const connection = await this.session.ready();
    return episodeAfter(episode, id => connection.adapter.detail(id));
  }

  /**
   * The scrub thumbnail at title time `seconds` of the playing session, or null: none offered, no
   * frame there yet, or its sheet still on its way (`onTrickplay` hears when it lands). The image
   * is a `data:` URI; the sheet was read with the session's credentials, which never leave core.
   */
  trickplayFrame(sessionId: string, seconds: number): TrickplayFrame | null {
    const { plan } = this.box.get().playback;
    if (!plan || sessionId.startsWith('local-') || plan.sessionId !== sessionId || plan.live || plan.channelId) return null;
    const offer = plan.trickplay ?? this.readTrickplayOffer(sessionId, plan.sourceGeneration);
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

  /** The offer of a server that tells it apart from the plan, read now and then while asked for; a
   * new source (a version switch) is read afresh. */
  private readTrickplayOffer(sessionId: string, sourceGeneration: number): V.TrickplayMetadata | null {
    const current = this.trickplayOffer;
    const held = current?.sessionId === sessionId && current.sourceGeneration === sourceGeneration ? current : undefined;
    if (held && (held.reading || Date.now() - held.at < TRICKPLAY_OFFER_MS)) return held.offer;
    const entry = { sessionId, sourceGeneration, offer: held?.offer ?? null, at: Date.now(), reading: true };
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
   * Keeps `install` holding the signed-in session's current grant: the one asked for now and, when a
   * rotated credential replaces it, the new one (only the newest answer is installed). Returns the
   * function that stops following; the caller clears what it installed.
   */
  followMediaAccess(install: (grant: MediaAccessGrant | null) => void): () => void {
    let asked = 0;
    let following = true;
    const ask = () => {
      const mine = ++asked;
      this.mediaAccess().then(grant => { if (following && mine === asked) install(grant); }, () => undefined);
    };
    this.mediaListeners.add(ask);
    ask();
    return () => {
      following = false;
      this.mediaListeners.delete(ask);
    };
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
    if (this.media?.identity !== identity) {
      const replaced = this.media !== undefined;
      this.media = { identity, handle: randomId() };
      // A rotated credential (an Ether token refresh) retires the grant the player host holds the
      // next time anyone asks for one (the audio queue asks for every item), so its owner is told.
      if (replaced) for (const listener of [...this.mediaListeners]) listener();
    }
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
    if (change.plan) {
      this.refreshHeld(change.plan);
      // A new source of the session (a version, a part): its own subtitle selection is what its reports are measured against.
      const before = this.box.get().playback.plan;
      if (before?.sessionId === change.plan.sessionId && before.sourceGeneration !== change.plan.sourceGeneration) this.subtitleReported = undefined;
    }
    this.box.update('playback', playback => ({ ...playback, ...change }));
  }

  /** A session this client opened, held until its stop is answered (`held`). */
  private hold(adapter: ServerAdapter, plan: V.PlaybackPlan, owner?: { connection: Connection; viewer: string }): void {
    this.held.set(plan.sessionId, { adapter, plan, epoch: this.session.epoch, owner });
  }

  /** A held session's newer plan (its generations, or the server ending it) replaces the one held. */
  private refreshHeld(plan: V.PlaybackPlan): void {
    const held = this.held.get(plan.sessionId);
    if (held) held.plan = plan;
  }

  /**
   * The page is going away (the web's pagehide: a tab closed or reloaded, or the page navigated
   * away): every session this client still holds, playing, prepared, being recovered or still
   * being stopped, is stopped best-effort, now. Nothing can be awaited by then, so each adapter
   * builds its stop requests synchronously and `send` fires them without waiting (fetch keepalive).
   * A session whose adapter cannot leaves it to the server's timeout. Returns the requests sent.
   */
  stopOnUnload(send: (request: UnloadRequest) => void): number {
    let sent = 0;
    for (const [sessionId, { adapter, plan }] of [...this.held]) {
      this.held.delete(sessionId);
      if (plan.state === 'ended') continue;
      this.stopped(sessionId);
      let requests: UnloadRequest[] = [];
      try { requests = hasUnloadStop(adapter) ? adapter.unloadStop(sessionId, { sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration }) : []; }
      catch { /* Nothing to stop it with: the server's timeout ends it. */ }
      for (const request of requests) {
        try { send(request); sent++; } catch { /* Best-effort. */ }
      }
    }
    return sent;
  }
}

/** What a watch is of, whatever position or track a restart asks it again at. */
function watchOf(target: PlaybackTarget): string {
  return JSON.stringify([target.kind, target.id,
    target.kind === 'programme' ? [target.channelId, target.from ?? '', target.range?.startAt, target.range?.durationSeconds] : target.kind === 'library-live' ? [target.libraryId, target.tab ?? ''] : []]);
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
