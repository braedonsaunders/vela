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
import { engineCommandAnswered, engineCommandSent, eventsBack, eventsLost, heardEngine, heardServer, QUIET_SECONDS, stallDeadline, stallVerdict, stallWatch, type StallSample, type StallWatch } from './stall';
import { liveStatus, type LiveObservation } from '../live/player';
import type { Watched } from '../discovery/progress';
import { followSession } from '../protocol/events';
import { randomId } from '../protocol/id';
import { commandFailure, staleGeneration, type CommandOrigin } from './command-failure';
import { VelaError } from '../adapter/errors';
import { hasColdVersion, sessionVersionsOf, type SessionVersions } from './session-versions';
import { withPlaying } from './playing-release';
import { onlyClockMoved } from './plan-clock';
import { serverEnd } from './server-end';
import { carriedTrack, fileOf, trackChoice, type TrackChoice } from './track-match';
import { episodeAfter, type EpisodeRef } from '../adapter/series';
import { matchSeriesTracks, playableLocally } from '../series-tracks';
import { atLiveEdge, liveRestart, liveRestartSeek, type LiveResume } from '../live/recovery';
import { msg } from '../i18n';
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
  /** The saved broadcast instant for a replacement's accepted timeshift seek. */
  timeshiftRecovery?: { sessionId: string; seekGeneration: number; at: number };
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

/** What a track command was sent on: the session, its source generation, version (not one the plan shows unavailable) and file
 * (track-match.ts `fileOf`), the versions taken in by then, the plan and the tracks it asked for. */
interface SentOn { sessionId: string; sourceGeneration: number | undefined; version: string | undefined; file: string | undefined; versions: number;
  plan: V.PlaybackPlan | undefined; tracks: TracksCommand | undefined }

type TracksCommand = Extract<V.SessionCommand, { kind: 'tracks' }>;

/** What each kind showed before a track command: the choice then, what the plan showed and (subtitles) what the player last reported,
 * on the source generation it was sent from; and whether the player has reported the command's choice of a kind since. */
interface Before { audio: (string | undefined)[]; subtitle: (string | null | undefined)[]; sourceGeneration: number | undefined; reported: { audio: boolean; subtitle: boolean } }

/** A selection the player showed, on the source generation it showed it on. */
interface Shown { id: string | null; sourceGeneration: number }

/** A track command not yet answered: a plan the session publishes after it that shows it confirms it, kind by kind (`takePick`).
 * It stays while its request awaits the answer (`inFlight`), and after it timed out or was lost while a kind of it is still to
 * be confirmed; a reply or a refusal ends it. `confirmed`: the source generation of the plan that confirmed a kind. */
/** `left`: the kinds the player showed this command's choice for (`recorded`, or `confirmed` on a later source) and then the viewer's
 * newer choice: for `recorded`, another selection on that source, or on a later source one other than the first it showed there
 * (`first`); for `confirmed`, another selection on that source or a later one. Neither a plan nor its reply records those, and a
 * stale retry does not send them again. `recorded`: for the kinds a playing or paused report of this command's choice recorded, the
 * source generation of the last such report. `first`: for those kinds, the first selection a playing or paused report showed on the
 * newest source later than that (a reopen of the same file), with its generation: that file's own selection, not a choice, so the
 * pick is still the viewer's (`passed`); a still later source has its own. `waiting`: it awaits the session (`session.ready()`);
 * until it is sent, it holds back an older stale retry only for the kinds recorded. `passed`: for the kinds the player showed its
 * choice for, also while buffering, and after it left reported another selection for while playing or paused on a plan newer than
 * it was sent on, the newest such plan: a reply older than that plan does not record those (the player's selection there is newer),
 * a reply as new does, and a stale retry still sends them again (the viewer's pick is still owed). */
interface Pick { at: V.PlaybackPlan; sent: SentOn; command: TracksCommand; origin: CommandOrigin; number: number; before: Before; left: { audio: boolean; subtitle: boolean };
  recorded: { audio?: number; subtitle?: number }; first: { audio?: Shown; subtitle?: Shown }; waiting: boolean; inFlight: boolean; confirmed: { audio?: number; subtitle?: number };
  passed: { audio?: V.PlaybackPlan; subtitle?: V.PlaybackPlan } }

/** After a track command's choice (`to`) was recorded for a kind: what the player showed before it, at the source generation and
 * on the file (track-match.ts `fileOf`) it was recorded on. A report there that still shows one of those is from before the
 * command, not a newer choice (`snapshot`). */
interface Echo { from: Set<string | null>; to: string | null; sourceGeneration: number; file: string | undefined }

interface Intent {
  run: object;
  target: PlaybackTarget;
  key: string;
  /** Asked again under a new key after the server answered with a session that had already ended. */
  fresh?: boolean;
  liveResume?: LiveResume;
  /** A title restart: it asks at the restart position as it is just before its first dispatch, and its retries keep that request. */
  atRestart?: boolean;
}

/** A version switch still waiting for its version: the session, the source generation it was asked from, the version asked
 * for, its number as sent, and whether its request still awaits the answer (else it was answered, timed out or was lost). */
interface VersionSwitch { sessionId: string; sourceGeneration: number; versionId: string; number: number; inFlight: boolean }

/** How many sessions this client stopped are remembered (`stoppedSessions`). */
const STOPPED_REMEMBERED = 32;

const MAX_PREPARATIONS = 30;
const POLL_SECONDS = 5;
/**
 * A session's events stream that drops while its media plays on is followed again after these
 * many seconds (together they span Ether's 15 s disconnect grace) before the session is restarted.
 * A connection up for `REFOLLOW_HELD_SECONDS` from the stream's opening starts them over, events or not.
 */
const REFOLLOW_SECONDS = [1, 2, 4, 4, 4];
const REFOLLOW_HELD_SECONDS = 30;
/** A connection whose snapshot read and stream have not both answered within this many seconds counts as failed. */
const REFOLLOW_OPEN_SECONDS = 10;
/** A plan offered with placeholder versions is read once more this long after it starts. */
const COLD_VERSIONS_SECONDS = 4;
/** A server that offers scrub thumbnails only once a session streams is asked again this often, while the viewer scrubs. */
const TRICKPLAY_OFFER_MS = 20_000;

export class Playback {
  get serverHandoff(): boolean { return this.session.features?.adaptiveHLS?.serverHandoff === true; }

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
  /** Where the viewer is, as the session's evidence says (`restartAt`: the newest of these): `settled`, the newest
   * of the session's start, admitted reports, accepted seek replies, taken versions and reopens; and `open`, a
   * published plan taken as the answer of a seek still waiting for its reply, one per seek, until that reply.
   * Each session has its own `open`, so an answer that arrives for an earlier session changes nothing. */
  private settled: Evidence = startOf(undefined);
  private open = new Map<WaitingSeek, Evidence>();
  /** Seeks sent and not yet answered, at the generations each was sent against, that a published plan can still
   * answer (once; a plan on a newer source ends that for seeks sent on an older one). */
  private seeking = new Set<WaitingSeek>();
  /** The generations of the seek, version or reopen the restart position last followed: until a report is the
   * restart position, a report there that does not present is the engine's old clock. */
  private settling: { sourceGeneration: number; seekGeneration: number } | undefined;
  /** The version switches still waiting for their version, in the order sent. A refusal removes its own; a lost reply
   * leaves it. Its reply, or a plan on its session and a newer source that moves to its version, takes it and ends it
   * and those sent before it; a new session ends them all. */
  private switches: VersionSwitch[] = [];
  private switchesSent = 0;
  /** A version whose switch reply came behind a newer plan of another version: taken with that reply, but its tracks
   * are its first usable plan's. Ended by that plan, by another switch taking effect and by a new session. */
  private owedTracks: { sessionId: string; versionId: string } | undefined;
  /** The newest plan held back because it only moved the server's clock (plan-clock.ts): later
   * plans are ordered against it, though the one on show is older. */
  private clockAhead: V.PlaybackPlan | null = null;
  private liveCursor?: { sessionId: string; sourceGeneration: number; seekGeneration: number; seconds: number };
  private liveTransportIntent?: { sessionId: string; atLive: boolean };
  private liveRecoveryNotice?: { sessionId: string; text: string };
  /** The live owner can detach and reattach a replacement before its engine sees the startup seek. */
  private pendingTimeshiftRecovery?: PlaybackState['timeshiftRecovery'];
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
  /** The number of the newest version switch that took effect (its reply, or its version published). */
  private appliedSwitch = 0;
  /** Versions taken in (`takeVersion`): a track command sent before one belongs to the version it was chosen on. */
  private versionsTaken = 0;
  /** The session, version, source generation and file (track-match.ts `fileOf`) the last version was taken on (`takeVersion`), and
   * the plan it was taken on; a new session, a recovery and the end of the session clear it. */
  private versionTaken: { sessionId: string; versionId?: string; sourceGeneration: number; file?: string; plan: V.PlaybackPlan } | undefined;
  /** The track commands not yet answered, with the plan and what they were sent on (`takePick`). */
  private picks: Pick[] = [];
  /** The session's track commands are numbered as sent; for each kind, the number of the newest command or player confirmation
   * whose choice was recorded. A reply records its choice for a kind unless a newer one was (`takeTracks`). */
  private tracksSent = 0;
  private applied = { audio: 0, subtitle: 0 };
  /** For each kind, the numbers of the commands sent and player confirmations the server has not refused: a stale command is
   * sent again only for the kinds it is still the newest of (`latest`). */
  private chosen = { audio: new Set<number>(), subtitle: new Set<number>() };
  /** For each kind, the plan that last confirmed a command (`takePick`): one plan confirms one command at most. */
  private confirmedBy: { audio?: V.PlaybackPlan; subtitle?: V.PlaybackPlan } = {};
  /** For each kind, the selections a report does not take for a newer choice after a command's was recorded (`snapshot`). */
  private echoes: { audio?: Echo; subtitle?: Echo } = {};
  /** The session's track commands awaiting their reply, with their numbers. */
  private outstanding = new Map<TracksCommand, number>();
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
          this.begin(plan);
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
    const recovery = this.pendingTimeshiftRecovery;
    this.end();
    const run = {};
    this.run = run;
    this.externalId = existing.sessionId;
    const connection = await this.session.ready();
    if (this.run !== run) return;
    const plan = connection.plan(existing);
    this.established = true;
    this.begin(plan);
    // The session this watch's own restart started (the owner handing it back) goes on counting.
    const watch = this.watch;
    if (watch?.target !== watchOf(target) || watch.session !== plan.sessionId) this.watch = { target: watchOf(target), session: plan.sessionId, restarts: 0 };
    this.stall = stallWatch(Date.now(), this.watch!.restarts);
    // The live owner can take over a replacement while its recovery notice is still showing.
    const notice = this.liveRecoveryNotice;
    const error = notice?.sessionId === plan.sessionId ? notice.text : '';
    this.patch({ ...initialPlayback, phase: 'playing', target, plan, sessionId: plan.sessionId, error,
      timeshiftRecovery: recovery?.sessionId === plan.sessionId ? recovery : undefined });
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
    const { run } = intent;
    let { target } = intent;
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
      // A start before Home (a deep link) reads the server's features first: the declaration depends on them.
      if (!this.session.features && this.session.knowFeatures) await this.session.knowFeatures(api);
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
      if (intent.atRestart && target.kind === 'title') {
        // A restart asks at the restart position as it is now (a seek answered while it waited counts); retried
        // under the same key, it sends the same request.
        intent.target = target = { ...target, positionSeconds: this.restartAt() };
        intent.atRestart = false;
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
    let evicted = false;
    let timeshiftRecovery: PlaybackState['timeshiftRecovery'];
    if (intent.liveResume) {
      const resume = intent.liveResume;
      const command = async (transport: { kind: 'goLive' } | { kind: 'seek'; positionSeconds: number }) =>
        connection.plan(await this.send(connection.adapter, plan.sessionId, {
          ...transport, sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
          idempotencyKey: `${intent.key}-${transport.kind}`,
        }));
      let failure: { error: unknown } | undefined;
      try {
        if (resume.kind !== 'edge') {
          const position = liveRestartSeek(resume, plan);
          if (position === 'evicted') evicted = true;
          // A fresh live plan can use zero to mean join live. A seek to zero is explicit.
          else if (resume.kind === 'timeshift' || position !== plan.positionSeconds) {
            try {
              plan = await command({ kind: 'seek', positionSeconds: position });
              if (resume.kind === 'timeshift') timeshiftRecovery = { sessionId: plan.sessionId, seekGeneration: plan.seekGeneration, at: resume.at };
            } catch (error) {
              const code = error instanceof VelaError ? error.detail.code : undefined;
              evicted = resume.kind === 'timeshift' &&
                (code === 'timeshift_outside_window' || code === 'timeshift_position_evicted');
              if (!evicted) throw error;
            }
          }
        }
        if ((evicted || resume.kind === 'edge') && plan.live?.timeshift && this.run === run && epoch === this.session.epoch) {
          plan = await command({ kind: 'goLive' });
        }
      } catch (error) {
        failure = { error };
      }
      if (failure || this.run !== run || epoch !== this.session.epoch) {
        this.stopped(plan.sessionId);
        try {
          await this.send(connection.adapter, plan.sessionId, { kind: 'stop', sourceGeneration: plan.sourceGeneration,
            seekGeneration: plan.seekGeneration, idempotencyKey: `cancel-${intent.key}` });
          this.held.delete(plan.sessionId);
        } catch { /* Keep it held for cleanup if the server could not be reached. */ }
        if (failure && this.run === run && epoch === this.session.epoch) {
          this.failed({ ...intent, key: `recover-${randomId()}` }, failure.error, attempt, preparation);
        }
        return;
      }
    }
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
    this.resetTrackNumbers();
    const watchTarget = this.box.get().playback.target ?? target;
    if (this.watch?.target !== watchOf(watchTarget)) this.watch = { target: watchOf(watchTarget), session: '', restarts: 0 };
    this.watch.session = plan.sessionId;
    this.stall = stallWatch(Date.now(), this.watch.restarts);
    this.begin(plan);
    this.switches = [];
    if (intent.liveResume && plan.live?.timeshift) {
      this.liveTransportIntent = { sessionId: plan.sessionId, atLive: evicted || intent.liveResume.kind === 'edge' };
    }
    const notice = evicted ? msg('catchUp.recoveredLive') : '';
    if (notice) this.liveRecoveryNotice = { sessionId: plan.sessionId, text: notice };
    this.pendingTimeshiftRecovery = timeshiftRecovery;
    this.patch({ phase: 'playing', plan, sessionId: plan.sessionId, timeshiftRecovery, error: notice, errorCode: '', errorClass: '', retryAfterSeconds: 0, retryAttempt: 0, versions: null });
    this.snapshot({ sessionId: plan.sessionId, live: null, position: plan.positionSeconds ?? 0, state: 'loading' });
    if (notice) this.clearLiveRecoveryNotice(plan.sessionId, notice);
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
    const show = (raw: V.PlaybackPlan) => {
      if (this.run !== run || controller.signal.aborted || raw.sessionId !== sessionId) return;
      // A snapshot read, a poll or a plan replayed from it, behind the newest plan heard (a command the server has
      // since accepted, a seek or a pause, or a version taken) would roll it back. An end is not held back.
      if (raw.state !== 'ended' && olderThanShown(raw, this.newestShown())) return;
      let plan = this.withLocalTracks(raw);
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
      // A version taken here brings its own tracks, not the previous version's local choices.
      if (!this.recovering) {
        this.published(raw);
        plan = this.withLocalTracks(raw);
      }
      // A plan that only moves the server's clock stays off the screen: a new plan every second
      // redrew the player (and handed the engine a new plan) for nothing.
      const shown = this.box.get().playback.plan;
      if (!ended && shown && this.box.get().playback.phase === 'playing' && onlyClockMoved(shown, plan)) {
        this.clockAhead = plan;
        // It still shows what a pending track command asked for (takePick).
        this.takePick(plan);
        return;
      }
      this.clockAhead = null;
      this.patch({ plan, phase: plan.state === 'ended' ? 'ended' : 'playing' });
      if (ended) this.afterWatching(plan, this.box.get().playback.target, plan.positionSeconds);
    };
    const adapter = connection.adapter;
    this.followNow = hasEventStream(adapter) ? undefined : id => {
      if (id !== sessionId || this.run !== run || controller.signal.aborted) return;
      void adapter.sessionSnapshot(sessionId).then(snapshot => { if (snapshot.plan.sessionId === sessionId) show(present(withPlaying(snapshot.plan, snapshot))); }).catch(() => undefined);
    };
    const loop = async () => {
      let refollows = 0, connected = 0, lost = false;
      while (this.run === run && !controller.signal.aborted && this.box.get().playback.phase === 'playing') {
        try {
          if (hasEventStream(adapter)) {
            connected = 0;
            const resumed = refollows > 0;
            let plans = 0, deadline: ReturnType<typeof setTimeout> | undefined;
            // Each connection has its own signal, so one given up on below cannot follow on later.
            const attempt = new AbortController();
            const abort = () => attempt.abort();
            controller.signal.addEventListener('abort', abort, { once: true });
            // The first plan is the snapshot read before connecting. Followed again after a drop, an end
            // the player never reached in that snapshot means the server let the session go while its events
            // were down (Ether's disconnect grace): it is restarted, not finished. Once the snapshot showed
            // the session alive, an end on the stream is the server's own and takes the end path.
            const onPlan = (plan: V.PlaybackPlan) => {
              const index = plans++;
              if (resumed && index === 0 && plan.state === 'ended' && !(this.lastPosition?.sessionId === sessionId && this.lastPosition.ended)) {
                lost = true;
                throw new Error('Session ended while its events were down');
              }
              show(plan);
            };
            const follow = followSession(adapter, present, sessionId, onPlan, attempt.signal, liveEvent => {
              if (this.run !== run || controller.signal.aborted) return;
              const current = this.box.get().playback.liveEvent;
              if (current?.id !== liveEvent?.id || current?.feed !== liveEvent?.feed) this.patch({ liveEvent });
            }, () => {
              // The stream opened (or sent anything, a heartbeat included): the connection counts as up.
              // An attempt already given up on that answers late is not this connection.
              if (connected || attempt.signal.aborted) return;
              connected = Date.now();
              clearTimeout(deadline);
              if (resumed && this.run === run && this.stall && !this.recovering) this.stall = eventsBack(this.stall);
            });
            // A connection whose snapshot read or stream never answers, the first one included, would otherwise leave a paused viewer waiting for ever.
            const timeout = new Promise<never>((_, reject) => {
              deadline = setTimeout(() => reject(new Error('Session events did not answer')), REFOLLOW_OPEN_SECONDS * 1000);
            });
            try {
              await Promise.race([follow, timeout]);
            } finally {
              clearTimeout(deadline);
              controller.signal.removeEventListener('abort', abort);
              attempt.abort();
            }
            if (controller.signal.aborted || this.box.get().playback.phase !== 'playing') {
              if (!controller.signal.aborted && this.box.get().playback.phase !== 'ended') this.recover(sessionId);
              break;
            }
            throw new Error('Session events ended');
          }
          const snapshot = await adapter.sessionSnapshot(sessionId);
          if (snapshot.plan.sessionId !== sessionId) throw new Error('Invalid session snapshot');
          show(present(withPlaying(snapshot.plan, snapshot)));
          await delay(POLL_SECONDS * 1000, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) break;
          // Only the events connection was lost (it ended, the network dropped it, the server was
          // briefly unavailable): the media plays on, so the stream is followed again. A server's
          // own answer (the session is gone, the request refused, an error event) restarts at once.
          if (hasEventStream(adapter) && !lost && !serverAnswered(error)) {
            // The media is trusted to play on only while it is seen playing (stall.ts eventsLost): a
            // network drop that took its reads down too, or left its engine reloading behind a frozen
            // picture, is restarted once the attempt's quiet budget passes without play.
            if (this.run === run && this.stall && !this.recovering && this.box.get().playback.sessionId === sessionId) {
              this.stall = eventsLost(this.stall, Date.now());
              this.armWatchdog(sessionId);
            }
            if (connected && Date.now() - connected >= REFOLLOW_HELD_SECONDS * 1000) refollows = 0;
            if (refollows < REFOLLOW_SECONDS.length) {
              try { await delay(REFOLLOW_SECONDS[refollows++]! * 1000, controller.signal); } catch { break; }
              continue;
            }
          }
          this.recover(sessionId);
          break;
        }
      }
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
    // A confirmation of what the latest command of this kind awaiting its reply asked for counts as that command, while no later
    // one of this kind was sent; any other is newer than all sent. Either supersedes an older command of this kind not yet
    // answered, and that command too for a plan published later (`takeTracks`, `takePick`), and it is the viewer's even when the
    // player reported something else since.
    let latest: { number: number; trackId: string | null | undefined } | undefined;
    for (const [command, number] of this.outstanding) {
      const asked = kind === 'audio' ? command.audioTrackId : command.subtitleTrackId;
      if (asked !== undefined && number > (latest?.number ?? 0)) latest = { number, trackId: asked };
    }
    if (latest?.trackId === trackId && latest.number === this.latest(kind)) this.applied[kind] = Math.max(this.applied[kind], latest.number);
    else this.chosen[kind].add(this.applied[kind] = ++this.tracksSent);
    this.echoes[kind] = undefined;
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
  recover(sessionId: string, reason = 'failed', livePosition?: number): void {
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
    this.switches = [];
    this.versionTaken = undefined;
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
    const { plan } = current;
    const sample = this.liveCursor;
    const saved = sample?.sessionId === sessionId && sample.sourceGeneration === plan?.sourceGeneration &&
      sample.seekGeneration === plan?.seekGeneration ? sample.seconds : plan?.positionSeconds ?? 0;
    const position = livePosition !== undefined && Number.isFinite(livePosition) ? livePosition : saved;
    const transport = this.liveTransportIntent;
    const restart = plan && liveRestart(current.target, plan, Math.max(0, position),
      transport?.sessionId === sessionId ? transport.atLive : !current.live?.canCatchUp && atLiveEdge(plan, position));
    const target = current.target.kind === 'title'
      ? { ...current.target, positionSeconds: this.restartAt(), audioTrackId: this.audio ?? current.plan?.selectedAudioTrackId }
      : restart?.target ?? current.target;
    this.abandoned = current.plan;
    this.patch({ phase: 'preparing', plan: null, error: '', errorClass: '', retryAfterSeconds: 1, versions: null });
    this.scheduleRecovery({ run, target, key: `recover-${randomId()}`, liveResume: restart?.resume, atRestart: current.target.kind === 'title' });
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
   * added none (it is still indexing), the session moved on meanwhile, or the plan shown does not list it. */
  async downloadSubtitle(id: string): Promise<string | null> {
    const connection = await this.session.ready();
    const api = connection.adapter;
    if (!hasSubtitleSearch(api)) throw new Error('Subtitle search is unavailable on this server');
    const sessionId = this.box.get().playback.sessionId;
    const previous = this.box.get().playback.plan;
    const plan = connection.plan(await api.downloadSubtitle(sessionId, id, this.session.key()));
    if (this.box.get().playback.sessionId !== sessionId || this.recovering) return null;
    // A new track, or (the same file chosen again) the one the server selected for it.
    const added = plan.subtitleTracks.find(t => !previous?.subtitleTracks.some(p => p.id === t.id))?.id;
    const chosen = plan.selectedSubtitleTrackId && plan.selectedSubtitleTrackId !== previous?.selectedSubtitleTrackId ? plan.selectedSubtitleTrackId : null;
    // Like a command reply, a reply behind the newest plan heard is not shown. Its track is given only when the plan
    // shown is of the same version and lists it, after one read of the session when it does not yet; another version
    // (the previous one) may lack it.
    const shown = this.newestShown();
    if (olderThanShown(plan, shown)) {
      const track = added ?? chosen;
      // Only while the same session and version are still playing.
      const listed = () => {
        const { phase, sessionId: current, plan: now } = this.box.get().playback;
        return !this.recovering && phase === 'playing' && current === sessionId && now?.sessionId === sessionId &&
          now.state !== 'ended' && now.selectedVersionId === plan.selectedVersionId &&
          now.subtitleTracks.some(t => t.id === track);
      };
      if (!track || shown?.selectedVersionId !== plan.selectedVersionId) return null;
      if (listed()) return track;
      // Unless the read says the session ended or is gone, the plan shown then decides, also when the read fails (a
      // plan heard meanwhile may list it).
      let ended = false;
      await this.refresh(sessionId, () => { ended = true; });
      return !ended && listed() ? track : null;
    }
    // A reply naming the version a switch still waits for brings it, as a command reply would.
    if (this.tookVersion(plan)) this.taken(plan);
    this.expire(plan.sourceGeneration);
    this.patch({ plan: this.withLocalTracks(plan) });
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
    // A track command belongs to the file and version it was chosen on: refused as stale, it is sent again only
    // while no switch of the session awaits its answer and it still plays that file (`stillOn`), and only for the
    // kinds no newer command the server did not refuse was sent for and no newer choice confirmed since (`latest`), nor those
    // the player showed and then left. A switch whose request timed out or was lost may have moved the session to its version:
    // then it is sent again only when a read of the session shows that file and version, at the generations read.
    const at = current.plan?.sessionId === sessionId ? current.plan : undefined;
    const sent: SentOn = { sessionId, sourceGeneration: at?.sourceGeneration, version: at?.sourceFailure === 'version_unavailable' ? undefined : at?.selectedVersionId,
      file: fileOf(at), versions: this.versionsTaken, plan: at, tracks: command.kind === 'tracks' ? command : undefined };
    let tracks = command.kind === 'tracks' && current.sessionId === sessionId ? command : undefined;
    const number = tracks ? ++this.tracksSent : 0;
    const chosen = this.chosen;
    if (tracks) this.outstanding.set(tracks, number);
    if (tracks?.audioTrackId !== undefined) chosen.audio.add(number);
    if (tracks?.subtitleTrackId !== undefined) chosen.subtitle.add(number);
    const before: Before = { audio: [this.audio, at?.selectedAudioTrackId], subtitle: [this.subtitle, at && (at.selectedSubtitleTrackId ?? null), this.subtitleReported],
      sourceGeneration: at?.sourceGeneration, reported: { audio: false, subtitle: false } };
    const pick: Pick | undefined = command.kind === 'tracks' && at
      ? { at, sent, command, origin, number, before, left: { audio: false, subtitle: false }, recorded: {}, first: {},
        waiting: true, inFlight: true, confirmed: {}, passed: {} } : undefined;
    const retry = command.kind === 'tracks' ? async (generations: { sourceGeneration: number; seekGeneration: number }): Promise<V.SessionCommand | undefined> => {
      const switching = () => this.switches.filter(s => s.sessionId === sessionId && s.number > this.appliedSwitch);
      const blocked = () => switching().some(s => s.inFlight) || !this.stillOn(sent, this.box.get().playback.plan);
      if (blocked()) return undefined;
      if (switching().length) {
        const read = await this.server.sessionSnapshot(sessionId).then(snapshot => withPlaying(snapshot.plan, snapshot), () => undefined);
        if (!read || !sent.file || fileOf(read) !== sent.file || read.selectedVersionId !== at?.selectedVersionId
          || !this.stillOn(sent, read) || blocked()) return undefined;
        generations = { sourceGeneration: read.sourceGeneration, seekGeneration: read.seekGeneration };
      }
      const { audioTrackId, subtitleTrackId, ...rest } = command;
      const again = { ...rest, ...generations,
        ...(audioTrackId !== undefined && (!tracks || this.latest('audio', true) === number) && !pick?.left.audio ? { audioTrackId } : {}),
        ...(subtitleTrackId !== undefined && (!tracks || this.latest('subtitle', true) === number) && !pick?.left.subtitle ? { subtitleTrackId } : {}) };
      if (again.audioTrackId === undefined && again.subtitleTrackId === undefined) return undefined;
      // The reply answers the kinds sent again; the others are no longer this command's choice.
      if (tracks) {
        if (again.audioTrackId === undefined) chosen.audio.delete(number);
        if (again.subtitleTrackId === undefined) chosen.subtitle.delete(number);
        this.outstanding.delete(tracks);
        this.outstanding.set(tracks = again, number);
      }
      if (pick) pick.command = again;
      return again;
    } : undefined;
    // Kept from now on, so a player report of its choice before the session is ready counts.
    if (pick) this.picks.push(pick);
    const seek: WaitingSeek | undefined = command.kind === 'seek'
      ? { sessionId, seconds: command.positionSeconds, sourceGeneration: command.sourceGeneration, seekGeneration: command.seekGeneration, open: this.open } : undefined;
    if (seek) this.seeking.add(seek);
    try {
      let connection: Connection;
      // A command that never left is no choice sent, as a refused one, unless a report of the player already recorded it.
      try { connection = await this.session.ready(); } catch (error) {
        if (pick) this.dropPick(pick);
        if (tracks && pick?.recorded.audio === undefined) chosen.audio.delete(number);
        if (tracks && pick?.recorded.subtitle === undefined) chosen.subtitle.delete(number);
        throw error;
      }
      if (pick) pick.waiting = false;
      // A command lost on its way stays to be confirmed by a plan the session publishes; a reply or a refusal ends it. Refused,
      // it is no longer a choice sent: an earlier one of its kinds is the newest again.
      const plan = await this.send(connection.adapter, sessionId, command, origin, undefined, retry)
        .catch(error => {
          if (tracks && serverRefused(error)) { chosen.audio.delete(number); chosen.subtitle.delete(number); }
          if (pick) {
            pick.inFlight = false;
            if (serverRefused(error) || !this.eligible(pick).length) this.dropPick(pick);
          }
          throw error;
        });
      if (pick) this.dropPick(pick);
      answered(plan);
      // An accepted seek is the viewer's place at its reply's position and generations, also behind the plan shown,
      // in place of a published plan taken as its answer, while its session is still the one shown.
      if (seek) {
        seek.open.delete(seek);
        if (this.owns(seek)) this.offer(evidenceOf(plan, CONFIRMED));
      }
      if (!this.recovering && this.box.get().playback.sessionId === sessionId) {
        // A late reply behind the plan already shown on its generations (a newer seek's, a version switch's)
        // is not published, though an accepted seek's evidence was offered above. One behind it only on revision
        // is not published either, but what it confirms (its seek, its tracks) still counts. The revision is the
        // newest heard, a plan held back for moving only the clock included.
        const shown = this.box.get().playback.plan;
        let nextPlan = connection.plan(plan);
        // The plan shown, with what a track reply behind the newest plan heard brings in.
        let held = shown;
        // A track reply that brought the version a switch still waits for (below).
        let took = false;
        if (command.kind === 'tracks') {
          // Not for the kinds the player showed and then left, nor those it reported another selection for on a plan newer than the reply,
          // nor, after a reopen where the player first showed the file's own selection (also when it then showed this command's on the
          // source shown), for a reply behind the newest plan heard, those a later command not yet answered chose on a plan that already
          // showed it, when the plan shown shows that and not this command's.
          const passed = (kind: 'audio' | 'subtitle') => !!pick?.passed[kind] && olderPlan(plan, pick.passed[kind]!);
          const later = (kind: 'audio' | 'subtitle') => !!shown && !!pick && (reopenedOther(pick, kind)
            || (pick.first[kind]?.sourceGeneration === shown.sourceGeneration
              && pick.first[kind]!.id !== (kind === 'audio' ? pick.command.audioTrackId : pick.command.subtitleTrackId)))
            && olderThanShown(nextPlan, this.newestShown()) && !showsKind(shown, pick.command, kind)
            && this.picks.some(other => other.number > number && showsKind(other.at, other.command, kind) && showsKind(shown, other.command, kind));
          const left = pick && { audio: pick.left.audio || passed('audio') || later('audio'), subtitle: pick.left.subtitle || passed('subtitle') || later('subtitle') };
          const asked = left ? without(pick!.command, left) : tracks ?? command;
          // A reply for an older source than the plan shown does not replace it. Its choice stands while the
          // session plays the same file (a reopen); after a version switch or on another file it does not.
          // Nor, from behind a further reopen, the kinds the player showed another selection for first after a reopen (that file's own).
          if (shown?.sessionId === sessionId && nextPlan.sourceGeneration < shown.sourceGeneration) {
            const reopened = { audio: !!pick && reopenedOther(pick, 'audio'), subtitle: !!pick && reopenedOther(pick, 'subtitle') };
            if (this.stillOn(sent, shown)) this.takeTracks(without(asked, reopened), nextPlan, origin, number, before);
            return false;
          }
          // A reply that brings the version a switch still waits for, not behind the newest plan heard, is that version's first
          // plan: the version is taken from the reply as the server sent it, and no choice of the previous version is put on it.
          took = !olderThanShown(nextPlan, this.newestShown()) && this.tookVersion(nextPlan);
          // A kind takes when it was asked for and no later choice was recorded for it. For the others the plan shown keeps its
          // selection when a later choice was recorded or the player left it, unless the reply already shows the choice recorded;
          // a reply older than the newest plan heard only brings in the kinds that take.
          const kinds = ['audio', 'subtitle'] as const;
          const takes = (kind: 'audio' | 'subtitle') => this.onVersion(sent, shown, nextPlan)
            && (kind === 'audio' ? asked.audioTrackId : asked.subtitleTrackId) !== undefined && number >= this.applied[kind];
          const recorded = (kind: 'audio' | 'subtitle') => kind === 'audio'
            ? this.audio !== undefined && nextPlan.selectedAudioTrackId === this.audio
            : this.subtitle !== undefined && (nextPlan.selectedSubtitleTrackId ?? null) === this.subtitle;
          const keeps = (kind: 'audio' | 'subtitle') => !takes(kind) && (number < this.applied[kind] || !!left?.[kind]) && !recorded(kind);
          const older = shown?.sessionId === sessionId && olderThanShown(nextPlan, this.newestShown());
          const from = took ? [] : older ? kinds.filter(takes) : shown?.sessionId === sessionId ? kinds.filter(keeps) : [];
          // A command sent before a version was taken does not choose on that version. Behind the newest plan heard on the
          // same source, what it chose is recorded on the plan shown with the kinds that take.
          const recordOn = nextPlan;
          if (from.length) {
            const [base, other] = older ? [shown!, nextPlan] : [nextPlan, shown!];
            const joined = { ...base, ...(from.includes('audio') ? { selectedAudioTrackId: other.selectedAudioTrackId } : {}),
              ...(from.includes('subtitle') ? { selectedSubtitleTrackId: other.selectedSubtitleTrackId } : {}) };
            if (older) held = joined;
            else nextPlan = joined;
          }
          if (this.onVersion(sent, shown, nextPlan)) this.takeTracks(asked, older && from.length ? held! : recordOn, origin, number, before);
        }
        if (nextPlan.live && (command.kind === 'goLive' || command.kind === 'seek' || command.kind === 'pause')) {
          this.liveTransportIntent = { sessionId, atLive: command.kind === 'goLive' };
        }
        if (origin === 'viewer' && command.kind === 'goLive') this.resetRestartBudget(sessionId);
        // Behind the plan shown on its generations, the reply is not shown, but the kinds it brought in are.
        if (shown && olderPlan(plan, shown, false) && held === shown) return true;
        const behind = olderThanShown(plan, this.newestShown());
        const newer = behind ? held : undefined;
        // A reply naming the version a switch still waits for brings it, as a published plan would; one behind the
        // newest plan heard is not shown and brings nothing (that version's next plan still may).
        if (!behind && (took || this.tookVersion(nextPlan))) this.taken(nextPlan);
        this.expire(plan.sourceGeneration);
        nextPlan = this.withLocalTracks(nextPlan);
        this.patch({ plan: newer ? this.withLocalTracks(newer) : nextPlan });
        return true;
      }
      return false;
    } catch (error) {
      answered(null);
      // A plan published at the target of a seek the server refused did not answer it (a track change at that
      // position), so it goes. A lost reply (no answer from the server) says nothing against that plan: it stays.
      const match = seek?.open.get(seek);
      if (seek && match) {
        seek.open.delete(seek);
        if (this.owns(seek) && !serverRefused(error)) this.offer(match);
        // Left with a report or the session's start, there is no followed position whose old clock to wait out.
        else if (this.owns(seek) && [REPORTED, UNPRESENTED, STARTED].includes(this.newest().rank)) this.settling = undefined;
      }
      const words = commandFailure(command, error, origin);
      if (words && this.box.get().playback.sessionId === sessionId) this.patch({ error: words });
      return false;
    } finally {
      if (tracks) this.outstanding.delete(tracks);
      if (seek) this.seeking.delete(seek);
    }
  }

  /** What the answer to track command `number` selected becomes the viewer's choice, for each kind no newer choice was recorded for. */
  private takeTracks(command: TracksCommand, plan: V.PlaybackPlan, origin: CommandOrigin, number: number, before?: Before): void {
    if (command.audioTrackId !== undefined && plan.selectedAudioTrackId && this.recordNewest('audio', number, plan, plan.selectedAudioTrackId, before)) {
      this.audio = plan.selectedAudioTrackId;
      this.audioChoice = trackChoice(plan, plan.audioTracks, this.audio);
    }
    if (command.subtitleTrackId !== undefined && this.recordNewest('subtitle', number, plan, plan.selectedSubtitleTrackId ?? null, before)) {
      this.subtitle = plan.selectedSubtitleTrackId;
      this.subtitleChoice = trackChoice(plan, plan.subtitleTracks, this.subtitle ?? undefined);
      // Subtitles off the viewer asked for are carried to a replacement; a subtitle asked for ends that.
      if (origin === 'viewer') this.subtitleOff = command.subtitleTrackId === null;
    }
  }

  /** Track command `number` is not older than the newest choice recorded for `kind`: it is recorded now. Recorded for the first
   * time, what was there before it (and before the commands recorded just ahead of it on this source) is not taken from a report
   * on the source generation it was sent from for a newer choice, until the player reports something else (`snapshot`); not
   * when the player already reported its choice while it was awaited. */
  private recordNewest(kind: 'audio' | 'subtitle', number: number, plan: V.PlaybackPlan, chosen: string | null, before?: Before): boolean {
    if (number < this.applied[kind]) return false;
    if (number > this.applied[kind]) {
      const earlier = this.echoes[kind] && this.echoedOn(this.echoes[kind], plan) ? this.echoes[kind] : undefined;
      const from = new Set([...earlier?.from ?? [], earlier && (kind === 'audio' ? this.audio : this.subtitle), ...before?.[kind] ?? []]
        .filter((id): id is string | null => id !== undefined && id !== chosen));
      this.echoes[kind] = from.size && before?.sourceGeneration !== undefined && !before.reported[kind]
        ? { from, to: chosen, sourceGeneration: before.sourceGeneration, file: fileOf(plan) } : undefined;
    }
    this.applied[kind] = number;
    return true;
  }

  /** No version came in since a track command was sent, or only the one it was sent on a usable plan of, on that file, taken on that
   * session and source generation (a version shown there before its switch reply) while `shown` is still that version and file: its
   * reply chooses on the plan shown. When the plans do not name their file, only a reply (`reply`) not older than the plan the version
   * was taken on, and only while each track it asked for is the same track on the plan shown as on the plan it was sent on. */
  private onVersion(sent: SentOn, shown: V.PlaybackPlan | null | undefined, reply?: V.PlaybackPlan): boolean {
    const last = this.versionTaken;
    const same = (plan: V.PlaybackPlan, id: string | null | undefined, from: V.Track[], to: V.Track[]) =>
      id === undefined || id === null || (!!sent.plan && carriedTrack(id, trackChoice(sent.plan, from, id), plan, to) === id);
    return sent.versions === this.versionsTaken || (sent.versions + 1 === this.versionsTaken && sent.version !== undefined
      && last?.sessionId === sent.sessionId && last.versionId === sent.version && last.sourceGeneration === sent.sourceGeneration
      && last.file === sent.file && shown?.sessionId === sent.sessionId && shown.selectedVersionId === sent.version && fileOf(shown) === sent.file
      && (sent.file !== undefined || ((!reply || !olderPlan(reply, last.plan))
        && same(shown, sent.tracks?.audioTrackId, sent.plan?.audioTracks ?? [], shown.audioTracks)
        && same(shown, sent.tracks?.subtitleTrackId, sent.plan?.subtitleTracks ?? [], shown.subtitleTracks))));
  }

  private echoedOn(echo: Echo, plan: V.PlaybackPlan | null | undefined): boolean {
    return !!plan && echo.sourceGeneration === plan.sourceGeneration && echo.file === fileOf(plan);
  }

  private resetTrackNumbers(): void {
    this.tracksSent = 0;
    this.applied = { audio: 0, subtitle: 0 };
    this.chosen = { audio: new Set(), subtitle: new Set() };
    this.confirmedBy = {};
    this.echoes = {};
    this.picks = [];
    this.outstanding.clear();
    this.versionTaken = undefined;
  }

  /** `shown` still plays what a track command was sent on: the same session, no version taken in since, not an older
   * source generation, not another file, and the same source generation or the same file named by more than its
   * version row (track-match.ts `fileOf`). */
  private stillOn(sent: SentOn, shown: V.PlaybackPlan | null | undefined): boolean {
    const file = fileOf(shown);
    return !!shown && shown.sessionId === sent.sessionId && sent.versions === this.versionsTaken
      && (sent.sourceGeneration === undefined || shown.sourceGeneration >= sent.sourceGeneration)
      && !(sent.file && file && file !== sent.file)
      && (shown.sourceGeneration === sent.sourceGeneration || (!!sent.file && file === sent.file));
  }

  /** The session published a plan of the file a track command not yet answered was sent on, which moved since it was sent
   * and shows, for a kind, what it asked for, which the plan at sending did not: that kind was taken. For each kind a plan
   * confirms one command, the oldest it fits, and only a plan newer than the one that confirmed the last. */
  private takePick(plan: V.PlaybackPlan): void {
    if (this.recovering) return;
    const newer = (kind: 'audio' | 'subtitle') => {
      const by = this.confirmedBy[kind];
      return !by || plan.sourceGeneration > by.sourceGeneration || (plan.sourceGeneration === by.sourceGeneration && (plan.revision ?? 0) > (by.revision ?? 0));
    };
    for (const pick of [...this.picks].sort((a, b) => a.number - b.number)) {
      const moved = plan.sourceGeneration > pick.at.sourceGeneration || (plan.revision ?? 0) > (pick.at.revision ?? 0);
      const kinds = moved && this.stillOn(pick.sent, plan)
        ? this.eligible(pick).filter(kind => newer(kind) && !showsKind(pick.at, pick.command, kind) && showsKind(plan, pick.command, kind)) : [];
      for (const kind of kinds) {
        this.confirmedBy[kind] = plan;
        pick.confirmed[kind] = plan.sourceGeneration;
      }
      if (kinds.length) this.takeTracks(without(pick.command, { audio: !kinds.includes('audio'), subtitle: !kinds.includes('subtitle') }),
        plan, pick.origin, pick.number, pick.before);
      // Awaiting its reply, it stays: the player may still show its choice and leave it.
      if (!pick.inFlight && !this.eligible(pick).length) this.dropPick(pick);
    }
  }

  /** The kinds of a pick a plan can still confirm: not those a later command or a player confirmation (of this command too)
   * recorded, nor those the player showed and then left, nor those a report recorded and the player then followed with another
   * selection on a later source (`passed`, `first`, also while it awaits the session): only an answer as new as that source records
   * those. */
  private eligible(pick: Pick): ('audio' | 'subtitle')[] {
    return (['audio', 'subtitle'] as const).filter(kind => (kind === 'audio' ? pick.command.audioTrackId : pick.command.subtitleTrackId) !== undefined
      && pick.number > this.applied[kind] && !pick.left[kind] && !reopenedOther(pick, kind)
      && !(pick.recorded[kind] !== undefined && (pick.passed[kind]?.sourceGeneration ?? -1) > pick.recorded[kind]!));
  }

  /** The newest number of `kind` sent or confirmed that the server has not refused, or recorded: a refusal does not undo a
   * confirmation. For a stale retry (`retry`), not that of a pick still awaiting the session whose choice no report recorded. */
  private latest(kind: 'audio' | 'subtitle', retry = false): number {
    const waiting = (number: number) => retry && this.picks.some(pick => pick.number === number && pick.waiting && pick.recorded[kind] === undefined);
    return Math.max(this.applied[kind], ...[...this.chosen[kind]].filter(number => !waiting(number)));
  }

  private dropPick(pick: Pick): void {
    this.picks = this.picks.filter(other => other !== pick);
  }

  async switchVersion(sessionId: string, versionId: string, positionSeconds?: number): Promise<V.PlaybackPlan> {
    const current = this.box.get().playback;
    const plan = current.sessionId === sessionId ? current.plan : null;
    if (!plan) throw new Error('Playback session is unavailable');
    const connection = await this.session.ready();
    if (!hasVersions(connection.adapter)) throw new Error('Versions are unavailable');
    // Until its version is taken, a published plan on this session that moves to this version is the one the viewer chose.
    // One whose request timed out or was lost may still have been taken: so it can until a later one takes effect.
    const switching: VersionSwitch = { sessionId, sourceGeneration: plan.sourceGeneration, versionId, number: ++this.switchesSent, inFlight: true };
    this.switches = [...this.switches, switching];
    let next: V.PlaybackPlan;
    try {
      next = connection.plan(await connection.adapter.switchVersion(sessionId, {
        kind: 'version', versionId, ...(positionSeconds !== undefined ? { positionSeconds } : {}),
        sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
        idempotencyKey: this.session.key(),
      }));
    } catch (error) {
      switching.inFlight = false;
      // A refusal ends this switch only. A lost reply says nothing against it: a plan naming the version still counts as it.
      if (serverRefused(error)) this.dropSwitch(switching);
      throw error;
    }
    switching.inFlight = false;
    // Neither a published plan nor a later switch has taken it yet: the reply does, also when its source is already
    // shown, but not when it shows this version unavailable, nor from behind a plan that does: its first usable plan
    // still takes it. Nor from an older source than a usable plan of another version a later switch still waiting asked for.
    const newest = this.newestShown();
    const unavailable = next.sourceFailure === 'version_unavailable';
    const unseen = !unavailable && this.switches.includes(switching) && !(olderThanShown(next, newest) &&
      newest?.selectedVersionId === switching.versionId && newest.sourceFailure === 'version_unavailable')
      && !(newest && newest.sourceFailure !== 'version_unavailable' && next.sourceGeneration < newest.sourceGeneration
        && this.switches.some(other => other.number > switching.number && other.versionId === newest.selectedVersionId && other.versionId !== switching.versionId));
    if (unseen) this.applySwitch(switching.number);
    const now = this.box.get().playback;
    // A restart (stall recovery) asks for the file now playing, not the one first asked for. Once a published plan
    // brought this version or a later switch was taken, a reply behind the plan shown (that later version's, a
    // seek's on this one) changes nothing, nor does a reply arriving while recovering, but for the version a later
    // recovery asks for (below). Any reply behind the newest plan heard (a seek, track change or pause on its version,
    // also one held back for moving only the clock) neither replaces the plan shown nor takes its tracks.
    const fresh = !olderThanShown(next, newest);
    const failed = this.newestShown(this.abandoned);
    if (now.sessionId === sessionId && !this.recovering && (unseen || fresh)) {
      // The version is taken once, with a fresh restart budget: here, unless a published plan already brought it.
      if (unseen) {
        this.resetRestartBudget(sessionId);
        // Its version already taken on this source, by a usable plan of it shown: the choices made on it stand.
        const last = this.versionTaken;
        const already = now.plan?.sessionId === sessionId && now.plan.sourceGeneration === next.sourceGeneration
          && now.plan.selectedVersionId === next.selectedVersionId && now.plan.sourceFailure !== 'version_unavailable'
          && last?.sessionId === sessionId && last.versionId === next.selectedVersionId && last.sourceGeneration === next.sourceGeneration;
        if (fresh && !already) this.takeVersion(next);
        // Behind a newer plan of another version, the reply's tracks are not the player's: the first usable plan of
        // its version brings them.
        else if (!fresh && newest?.selectedVersionId !== switching.versionId) this.owedTracks = { sessionId, versionId: switching.versionId };
        this.taken(next);
      }
      // A reply showing its version unavailable is shown, with the local choices, and changes nothing else.
      if (!unavailable) this.expire(next.sourceGeneration);
      const target = unseen && now.target?.kind === 'title' ? { target: { ...now.target, versionId: next.selectedVersionId ?? versionId } } : {};
      this.patch(fresh ? { plan: unavailable ? this.withLocalTracks(next) : next, error: '', ...target } : target);
    } else if (now.sessionId === sessionId && this.recovering && !unavailable && switching.number > this.appliedSwitch
      && !olderThanShown(next, failed) && !(failed?.selectedVersionId === switching.versionId && failed.sourceFailure === 'version_unavailable'
        && !olderThanShown(failed, next))) {
      // A reply that comes while the session is recovered changes neither the plan nor the choices; a later recovery asks for its
      // version, unless it is behind the failed session's last plan heard or, no newer than that plan, that plan shows its version
      // unavailable.
      this.applySwitch(switching.number);
      if (now.target?.kind === 'title') this.patch({ target: { ...now.target, versionId: next.selectedVersionId ?? versionId } });
    }
    return next;
  }

  private dropSwitch(switching: VersionSwitch): void {
    this.switches = this.switches.filter(other => other !== switching);
  }

  /** Switch `number` took effect: it and those sent before it are no longer awaited. */
  private applySwitch(number: number): void {
    this.appliedSwitch = number;
    this.switches = this.switches.filter(other => other.number > number);
    this.owedTracks = undefined;
  }

  /** A new version's plan: track IDs and local choices belong to the previous version. Keep the negotiated
   * selection through later snapshots and recovery, even when a track ID is reused. */
  private takeVersion(next: V.PlaybackPlan): void {
    this.owedTracks = undefined;
    this.versionsTaken++;
    // Numbered on from the commands sent before it: one sent on a plan of this version may still be answered (`onVersion`).
    const sent = this.tracksSent, picks = this.picks;
    this.resetTrackNumbers();
    this.tracksSent = sent;
    this.versionTaken = { sessionId: next.sessionId, versionId: next.selectedVersionId, sourceGeneration: next.sourceGeneration, file: fileOf(next), plan: next };
    // A pick sent on a plan of this version and file stays: the player's reports of its choice still count for it.
    this.picks = picks.filter(pick => this.onVersion(pick.sent, next));
    this.localTracks = false;
    this.audio = next.selectedAudioTrackId;
    this.subtitle = next.selectedSubtitleTrackId;
    this.audioChoice = trackChoice(next, next.audioTracks, this.audio);
    this.subtitleChoice = trackChoice(next, next.subtitleTracks, this.subtitle ?? undefined);
    // An Off chosen on the previous version is not the viewer's on this one; its reports start from its own selection.
    this.subtitleOff = false;
    this.subtitleReported = undefined;
  }

  private resetRestartBudget(sessionId: string): void {
    if (!this.stall || this.watch?.session !== sessionId) return;
    this.watch.restarts = 0;
    // A drop of the events stream still in progress outlives the new allowance.
    const { played, eventsLost: lost, eventsDown } = this.stall;
    this.stall = lost === null ? stallWatch(Date.now()) : { ...stallWatch(Date.now()), played, eventsLost: lost, eventsDown };
    this.armWatchdog(sessionId);
  }

  private async send(api: ServerAdapter, sessionId: string, command: V.SessionCommand, origin: CommandOrigin = 'viewer',
    canRetry?: () => Promise<boolean>, again?: (generations: { sourceGeneration: number; seekGeneration: number }) => Promise<V.SessionCommand | undefined>): Promise<V.PlaybackPlan> {
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
      const wanted = command.kind === 'switch' && 'pathId' in command && origin === 'viewer' && this.offersPath(sessionId, command.pathId);
      if ((!absolute && !wanted) || !generations) throw error;
      if (canRetry && !(await canRetry())) throw error;
      // What to send again, and at which generations, is decided as it is sent: a command may have been superseded meanwhile.
      const retry = again ? await again(generations) : { ...command, ...generations };
      if (!retry) throw error;
      return sendCommand(api, sessionId, { ...retry, idempotencyKey: this.session.key() });
    }
  }

  /** A plan the server published on the session: the version a switch still waits for or else, when it is newer
   * than the plan shown, the answer of the oldest waiting seek at its target and past the seek generation that seek
   * was sent against (each seek and each plan once). A track change can also land at a waiting seek's target: the
   * plan counts until the seek's reply. It ends the matching of seeks sent on an older source. */
  private published(plan: V.PlaybackPlan): void {
    const shown = this.box.get().playback.plan;
    if (this.tookVersion(plan)) this.taken(plan);
    else if (!shown || plan.sourceGeneration > shown.sourceGeneration || plan.seekGeneration > shown.seekGeneration) {
      const seek = [...this.seeking].find(seek => seek.sessionId === plan.sessionId && plan.sourceGeneration >= seek.sourceGeneration &&
        plan.seekGeneration > seek.seekGeneration && Math.abs(seek.seconds - plan.positionSeconds) < 0.001);
      if (seek) {
        this.seeking.delete(seek);
        const entry = evidenceOf(plan, MATCHED);
        this.open.set(seek, entry);
        this.fence(entry);
      }
    }
    this.expire(plan.sourceGeneration);
  }

  /** A usable plan on the session that moves from the version shown to the version a switch still waits for, on a newer
   * source than that switch was sent against, is that version (the oldest such switch): recovery asks for it and its
   * tracks, as after the switch reply, with a fresh restart budget. One that moves to a version owed its tracks
   * (`owedTracks`) brings only those. */
  private tookVersion(plan: V.PlaybackPlan): boolean {
    // A version shown only as unavailable has not been brought yet: its first usable plan still is.
    if (plan.sourceFailure === 'version_unavailable') return false;
    const shown = this.box.get().playback.plan;
    if (plan.selectedVersionId === shown?.selectedVersionId && shown?.sourceFailure !== 'version_unavailable') return false;
    const switching = this.switches.find(other => other.sessionId === plan.sessionId && other.versionId === plan.selectedVersionId &&
      plan.sourceGeneration > other.sourceGeneration);
    if (!switching) {
      const owed = this.owedTracks;
      if (owed?.sessionId === plan.sessionId && owed.versionId === plan.selectedVersionId) this.takeVersion(plan);
      return false;
    }
    this.applySwitch(switching.number);
    this.resetRestartBudget(plan.sessionId);
    this.takeVersion(plan);
    const { target } = this.box.get().playback;
    if (target?.kind === 'title') this.patch({ target: { ...target, versionId: plan.selectedVersionId } });
    return true;
  }

  /** A version taken or an original reopened is where the viewer is, at its plan's position; seeks sent on the
   * older source no longer answer for it. */
  private taken(plan: V.PlaybackPlan): void {
    for (const seek of this.open.keys()) if (seek.sourceGeneration < plan.sourceGeneration) this.open.delete(seek);
    this.offer(evidenceOf(plan, CONFIRMED));
  }

  /** A plan on a newer source ends the matching of seeks sent on an older one; their replies still count. */
  private expire(sourceGeneration: number): void {
    for (const seek of this.seeking) if (seek.sourceGeneration < sourceGeneration) this.seeking.delete(seek);
  }

  /** Settled evidence: it replaces the settled entry when it is at least as new. */
  private offer(entry: Evidence): void {
    if (compareEvidence(entry, this.settled) >= 0) this.settled = entry;
    this.fence(entry);
  }

  /** New evidence that is now the restart position: a report lifts the fence on old clocks; a followed seek,
   * version or reopen puts it at its generations, never back from newer ones it was put at. */
  private fence(entry: Evidence): void {
    if (this.newest() !== entry) return;
    if (entry.rank === REPORTED || entry.rank === UNPRESENTED) this.settling = undefined;
    else if (!this.settling || (entry.sourceGeneration - this.settling.sourceGeneration || entry.seekGeneration - this.settling.seekGeneration) >= 0) {
      this.settling = { sourceGeneration: entry.sourceGeneration, seekGeneration: entry.seekGeneration };
    }
  }

  /** A seek's reply is evidence only while its session is the one shown, in the same incarnation (its own `open`). */
  private owns(seek: WaitingSeek): boolean {
    return seek.open === this.open && seek.sessionId === this.box.get().playback.sessionId;
  }

  /** The newest evidence by source generation, seek generation and rank; a waiting seek's match wins a tie. */
  private newest(): Evidence {
    let newest = this.settled;
    for (const entry of this.open.values()) if (compareEvidence(entry, newest) >= 0) newest = entry;
    return newest;
  }

  /** Where a title restarts: the newest evidence's position. */
  private restartAt(): number {
    return this.newest().seconds;
  }

  /** The newest source and seek generations the session has shown or has evidence at. */
  private marks(): { sourceGeneration: number; seekGeneration: number } {
    const { plan } = this.box.get().playback;
    let sourceGeneration = Math.max(plan?.sourceGeneration ?? 0, this.settled.sourceGeneration);
    let seekGeneration = Math.max(plan?.seekGeneration ?? 0, this.settled.seekGeneration);
    for (const entry of this.open.values()) {
      sourceGeneration = Math.max(sourceGeneration, entry.sourceGeneration);
      seekGeneration = Math.max(seekGeneration, entry.seekGeneration);
    }
    return { sourceGeneration, seekGeneration };
  }

  /** A new session: its evidence starts at its plan. */
  private begin(plan: V.PlaybackPlan | undefined): void {
    this.settled = startOf(plan);
    this.open = new Map();
    this.settling = undefined;
    this.owedTracks = undefined;
  }

  private offersPath(sessionId: string, pathId: string): boolean {
    const { plan } = this.box.get().playback;
    return plan?.sessionId === sessionId && plan.paths.some(path => path.id === pathId);
  }

  /** Read the session's authoritative plan again (the player found its grant expired or a reply stale).
   * False when the session is gone (the server ended it, or it cannot be read): the caller starts over. `ended` is
   * called when the read says the session ended or is no longer known. */
  async refresh(sessionId: string, ended?: () => void): Promise<boolean> {
    if (sessionId.startsWith('local-')) return this.box.get().playback.sessionId === sessionId;
    try {
      const connection = await this.session.ready();
      const snapshot = await connection.adapter.sessionSnapshot(sessionId);
      if (snapshot.plan.sessionId !== sessionId) throw new Error('Invalid session snapshot');
      if (snapshot.plan.state === 'ended') {
        ended?.();
        const current = this.box.get().playback;
        const playerEnded = this.lastPosition?.sessionId === sessionId && this.lastPosition.ended;
        if (this.recovering || current.sessionId !== sessionId || current.phase !== 'playing' || serverEnd(current.target, playerEnded) !== 'stopped') return false;
        // A live session the server stopped: the viewer is told (Try again), as when its events say so.
        console.warn(`Vela playback: session ${sessionId} stopped by the server; giving up`);
        this.giveUp(true);
        return true;
      }
      if (!this.recovering && this.box.get().playback.sessionId === sessionId) {
        const plan = connection.plan(snapshot.plan);
        // As on the event stream, a read from before a command the server has since accepted is not put back.
        if (!olderThanShown(plan, this.newestShown())) {
          this.published(plan);
          this.patch({ plan: this.withLocalTracks(plan) });
        }
      }
      return true;
    } catch (error) {
      // A session the server no longer knows has ended as well.
      if (error instanceof VelaError && error.detail.code === 'session_not_found') ended?.();
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
      const raw = connection.plan(snapshot.plan);
      let plan = this.withLocalTracks(raw);
      if (plan.sourceFailure === 'version_unavailable') {
        // The caller's position is where the viewer is, as a report there at the newest generations, the returned
        // plan's included; no published plan stands for a seek.
        const seconds = Math.max(0, positionSeconds);
        const shown = this.marks();
        const marks = { sourceGeneration: Math.max(shown.sourceGeneration, plan.sourceGeneration), seekGeneration: Math.max(shown.seekGeneration, plan.seekGeneration) };
        this.open.clear();
        this.offer({ ...marks, rank: REPORTED, seconds });
        this.lastPosition = { sessionId, seconds, ended: false };
        this.patch({ plan, phase: 'playing', versions: sessionVersionsOf(plan) ?? this.box.get().playback.versions });
        return 'version_unavailable';
      }
      if (plan.state === 'ended' || plan.sourceGeneration <= (failedSourceGeneration ?? before.sourceGeneration)) return 'gone';
      // A version taken (or owed its tracks) here brings its own tracks, not the previous version's local choices.
      plan = this.tookVersion(raw) ? raw : this.withLocalTracks(raw);
      // The reopened source is where playback is.
      this.taken(plan);
      this.expire(plan.sourceGeneration);
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
        this.offer({ ...this.marks(), rank: REPORTED, seconds: observation.positionSeconds });
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

  private clearLiveRecoveryNotice(sessionId: string, notice: string): void {
    setTimeout(() => {
      if (this.liveRecoveryNotice?.sessionId === sessionId) this.liveRecoveryNotice = undefined;
      const { playback } = this.box.get();
      if (playback.sessionId === sessionId && playback.error === notice) this.patch({ error: '' });
    }, 5000);
  }

  /** A player snapshot: live status (reconnecting, delivery, drift) when the engine observes it. */
  /** The plan on show (or `shown`, as the plan a recovery left), with the revision of a newer one of the same generations held
   * back for moving only the clock: later plans are ordered against what was heard, not what was drawn. */
  private newestShown(shown = this.box.get().playback.plan): V.PlaybackPlan | null {
    const ahead = this.clockAhead;
    if (!shown || !ahead || ahead.sessionId !== shown.sessionId || ahead.sourceGeneration !== shown.sourceGeneration
      || ahead.seekGeneration !== shown.seekGeneration || typeof ahead.revision !== 'number') return shown;
    return typeof shown.revision !== 'number' || ahead.revision > shown.revision ? { ...shown, revision: ahead.revision } : shown;
  }

  snapshot(snapshot: LiveObservation & StallSample & { audioTrackId?: string | null; subtitleTrackId?: string | null; timeshiftRecoveryEvicted?: boolean | null }): void {
    const current = this.box.get().playback;
    if (snapshot.sessionId !== current.sessionId || this.recovering) return;
    const presenting = snapshot.state === 'playing' || snapshot.state === 'paused';
    // A report is at the generations it gives, a missing one at the newest the session has. One behind those
    // (a late report from before an accepted seek or a version) is not the viewer's place; one ahead of the
    // plan is newer than a reply the store has heard.
    const plan = current.plan;
    const marks = this.marks();
    const at = { sourceGeneration: snapshot.sourceGeneration ?? marks.sourceGeneration, seekGeneration: snapshot.seekGeneration ?? marks.seekGeneration };
    const stale = at.sourceGeneration < marks.sourceGeneration || at.seekGeneration < marks.seekGeneration;
    // An engine (re)loading a source reports a reset clock of zero before it presents: not the viewer's place.
    // Nor, after the restart position followed a seek, a version or a reopen, is a report at its generations
    // before the engine presents it (an old clock while it loads, buffers or seeks).
    const settling = !presenting && this.settling?.sourceGeneration === at.sourceGeneration && this.settling.seekGeneration === at.seekGeneration;
    if (snapshot.position !== undefined && !stale && !settling && (snapshot.position > 0 || presenting)) {
      // Until the player presents at these generations, a report there that does not present ranks below a seek's
      // answer at them; once it has, later ones advance the clock as any report.
      const shown = presenting || (this.settled.rank === REPORTED &&
        this.settled.sourceGeneration === at.sourceGeneration && this.settled.seekGeneration === at.seekGeneration);
      this.offer({ ...at, rank: shown ? REPORTED : UNPRESENTED, seconds: snapshot.position });
    }
    if (snapshot.timeshiftRecoveryEvicted && plan?.live?.timeshift
      && current.timeshiftRecovery?.sessionId === plan.sessionId && current.timeshiftRecovery.seekGeneration === plan.seekGeneration
      && snapshot.sourceGeneration === plan.sourceGeneration && snapshot.seekGeneration === plan.seekGeneration) {
      const notice = msg('catchUp.recoveredLive');
      this.liveTransportIntent = { sessionId: plan.sessionId, atLive: true };
      this.liveRecoveryNotice = { sessionId: plan.sessionId, text: notice };
      this.pendingTimeshiftRecovery = undefined;
      this.patch({ error: notice, timeshiftRecovery: undefined });
      this.clearLiveRecoveryNotice(plan.sessionId, notice);
    }
    if ((plan?.catchUp || plan?.live?.timeshift) && snapshot.state !== 'loading' && snapshot.state !== 'idle' && snapshot.state !== 'failed'
      && snapshot.seekTarget == null && snapshot.position !== undefined && Number.isFinite(snapshot.position)
      && snapshot.sourceGeneration === plan.sourceGeneration && snapshot.seekGeneration === plan.seekGeneration) {
      this.liveCursor = { sessionId: plan.sessionId, sourceGeneration: plan.sourceGeneration,
        seekGeneration: plan.seekGeneration, seconds: snapshot.position };
    }
    // A report from the session's previous source (queued before the plan moved on) names that
    // source's tracks: the last choice made on the current one stands. So does one on this source that still
    // shows what was there before a command whose choice was recorded, until the player shows something else.
    const echo = (kind: 'audio' | 'subtitle', id: string | null) => {
      const before = this.echoes[kind];
      if (before && this.echoedOn(before, current.plan) && before.from.has(id)) return true;
      this.echoes[kind] = undefined;
      return false;
    };
    // A choice the player shows on the source a report recorded a pick's on, or on the source a plan that confirmed the pick moved
    // to, is no longer that pick's to record. A report that did not record it (one while buffering) only showed it. On a later source
    // than the one a report recorded it on (a reopen), the first selection shown is that file's own: only another one after it there
    // is the viewer's.
    const generation = snapshot.sourceGeneration ?? current.plan?.sourceGeneration;
    const leave = (kind: 'audio' | 'subtitle', id: string | null) => {
      for (const pick of this.picks) {
        const asked = kind === 'audio' ? pick.command.audioTrackId : pick.command.subtitleTrackId;
        const confirmed = pick.confirmed[kind], recorded = pick.recorded[kind], first = pick.first[kind];
        const later = recorded !== undefined && generation !== undefined && generation > recorded;
        if (later && !(first && first.sourceGeneration >= generation)) pick.first[kind] = { id, sourceGeneration: generation };
        const shown = (recorded !== undefined && (generation === undefined || generation <= recorded))
          || (later && first?.sourceGeneration === generation && first.id !== id)
          || (confirmed !== undefined && confirmed > pick.at.sourceGeneration && generation !== undefined && generation >= confirmed);
        if (shown && asked !== undefined && asked !== id) pick.left[kind] = true;
        // Shown, also while buffering, and then another selection on a plan newer than it was sent on (a reopen, a seek): that plan.
        const newer = !!current.plan && (current.plan.sourceGeneration > pick.at.sourceGeneration || current.plan.seekGeneration > pick.at.seekGeneration);
        if (pick.before.reported[kind] && !pick.waiting && newer && asked !== undefined && asked !== id) pick.passed[kind] = current.plan!;
      }
    };
    // A playing or paused report of a pick's choice records it for that pick, on the report's source (a buffering one only shows it).
    const record = (kind: 'audio' | 'subtitle', id: string | null) => {
      for (const pick of this.picks) {
        if ((kind === 'audio' ? pick.command.audioTrackId : pick.command.subtitleTrackId) === id) pick.recorded[kind] = generation ?? pick.at.sourceGeneration;
      }
    };
    // A report behind the newest generations the session has shown or has evidence at (an older source, or a seek
    // since accepted on the same one) names tracks the player has since left; one without generations is at the newest.
    const onSource = snapshot.sourceGeneration === undefined || snapshot.sourceGeneration === current.plan?.sourceGeneration;
    if (!this.localTracks && (snapshot.state === 'playing' || snapshot.state === 'paused' || snapshot.state === 'buffering') && onSource && !stale) {
      // The player showed a pending command's choice, also while buffering: once recorded, a report of what was there before it
      // is a newer change; shown once it was recorded, it ends the hold on such reports. Only a playing or paused report records
      // the choice itself (`record`).
      for (const pick of this.picks) {
        if (snapshot.audioTrackId && pick.command.audioTrackId === snapshot.audioTrackId) pick.before.reported.audio = true;
        if (snapshot.subtitleTrackId !== undefined && pick.command.subtitleTrackId === snapshot.subtitleTrackId) pick.before.reported.subtitle = true;
      }
      if (snapshot.audioTrackId && this.echoes.audio?.to === snapshot.audioTrackId && this.echoedOn(this.echoes.audio, current.plan)) this.echoes.audio = undefined;
      if (snapshot.subtitleTrackId !== undefined && this.echoes.subtitle?.to === snapshot.subtitleTrackId
        && this.echoedOn(this.echoes.subtitle, current.plan)) this.echoes.subtitle = undefined;
    }
    if (!this.localTracks && presenting && onSource && !stale) {
      if (snapshot.audioTrackId && !echo('audio', snapshot.audioTrackId)) {
        leave('audio', snapshot.audioTrackId);
        record('audio', snapshot.audioTrackId);
        this.audio = snapshot.audioTrackId;
        this.audioChoice = trackChoice(current.plan, current.plan?.audioTracks, this.audio);
      }
      if (snapshot.subtitleTrackId !== undefined && !echo('subtitle', snapshot.subtitleTrackId)) {
        leave('subtitle', snapshot.subtitleTrackId);
        // Off is the viewer's once a subtitle was on this source: reported, or before any report selected by the plan.
        // A report supersedes the choice; none on a source that selected none leaves no choice.
        const before = this.subtitleReported !== undefined ? this.subtitleReported : current.plan?.selectedSubtitleTrackId ?? null;
        this.subtitleOff = snapshot.subtitleTrackId === null && (this.subtitleOff || before !== null);
        // An Off that only repeats what was there is no report of a pick of Off.
        if (snapshot.subtitleTrackId !== null || before !== null) record('subtitle', snapshot.subtitleTrackId);
        this.subtitleReported = snapshot.subtitleTrackId;
        this.subtitle = snapshot.subtitleTrackId;
        this.subtitleChoice = trackChoice(current.plan, current.plan?.subtitleTracks, this.subtitle ?? undefined);
      }
    }
    if (this.stall && snapshot.sessionId && current.phase === 'playing') {
      this.stall = heardEngine(this.stall, snapshot, Date.now());
      if (this.watch?.session === snapshot.sessionId) this.watch.restarts = this.stall.attempt;
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
    this.begin(plan);
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
      positionSeconds: this.restartAt(),
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
    this.begin(undefined);
    this.seeking.clear();
    this.switches = [];
    this.liveCursor = undefined;
    this.liveTransportIntent = undefined;
    this.localTracks = false;
    this.audio = undefined;
    this.subtitle = undefined;
    this.audioChoice = undefined;
    this.subtitleChoice = undefined;
    this.subtitleOff = false;
    this.subtitleReported = undefined;
    this.resetTrackNumbers();
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
      this.takePick(change.plan);
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

/** A seek sent and not yet answered, at the generations it was sent against, with the open evidence of its session. */
type WaitingSeek = { sessionId: string; seconds: number; sourceGeneration: number; seekGeneration: number; open: Map<WaitingSeek, Evidence> };

/** A position the viewer was at, with the generations it belongs to and its rank among evidence at those
 * generations: a report the player made, then an accepted seek reply, a taken version or a reopen, then a
 * published plan taken as a waiting seek's answer, then a report that does not present (loading, buffering)
 * made before the player presented at those generations, then the session's start. */
type Evidence = { sourceGeneration: number; seekGeneration: number; rank: number; seconds: number };
const STARTED = 0, UNPRESENTED = 1, MATCHED = 2, CONFIRMED = 3, REPORTED = 4;

const evidenceOf = (plan: V.PlaybackPlan, rank: number): Evidence =>
  ({ sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration, rank, seconds: plan.positionSeconds });

const startOf = (plan: V.PlaybackPlan | undefined): Evidence =>
  ({ sourceGeneration: plan?.sourceGeneration ?? 0, seekGeneration: plan?.seekGeneration ?? 0, rank: STARTED, seconds: plan?.positionSeconds ?? 0 });

const compareEvidence = (a: Evidence, b: Evidence) =>
  a.sourceGeneration - b.sourceGeneration || a.seekGeneration - b.seekGeneration || a.rank - b.rank;

/** A plan older than the one shown: behind on its source generation, then its seek generation, then (unless
 * `revision` is false) its revision when both carry one. */
function olderPlan(plan: V.PlaybackPlan, shown: V.PlaybackPlan, revision = true): boolean {
  if (plan.sourceGeneration !== shown.sourceGeneration) return plan.sourceGeneration < shown.sourceGeneration;
  if (plan.seekGeneration !== shown.seekGeneration) return plan.seekGeneration < shown.seekGeneration;
  return revision && typeof plan.revision === 'number' && typeof shown.revision === 'number' && plan.revision < shown.revision;
}

/** What a watch is of, whatever position or track a restart asks it again at. */
function watchOf(target: PlaybackTarget): string {
  return JSON.stringify([target.kind, target.id,
    target.kind === 'programme' ? [target.channelId, target.from ?? '', target.range?.startAt, target.range?.durationSeconds] : target.kind === 'library-live' ? [target.libraryId, target.tab ?? ''] : []]);
}

/** An answer from the server itself (a 4xx refusal, a session that is gone, an error event), as opposed to a lost connection. */
function serverAnswered(error: unknown): boolean {
  return error instanceof VelaError && error.status < 500 && error.status !== 408 && error.status !== 429;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** The plan shows what a track command asked for of `kind`. */
function showsKind(plan: V.PlaybackPlan, command: TracksCommand, kind: 'audio' | 'subtitle'): boolean {
  return kind === 'audio' ? command.audioTrackId !== undefined && plan.selectedAudioTrackId === command.audioTrackId
    : command.subtitleTrackId !== undefined && (plan.selectedSubtitleTrackId ?? null) === command.subtitleTrackId;
}

/** A report recorded `pick`'s choice of `kind`, and on a later source (a reopen) the player first showed another selection (`first`). */
function reopenedOther(pick: Pick, kind: 'audio' | 'subtitle'): boolean {
  const first = pick.first[kind], recorded = pick.recorded[kind];
  return !!first && recorded !== undefined && first.sourceGeneration > recorded
    && first.id !== (kind === 'audio' ? pick.command.audioTrackId : pick.command.subtitleTrackId);
}

/** The track command without the kinds `drop` names. */
function without(command: TracksCommand, drop: { audio?: boolean; subtitle?: boolean }): TracksCommand {
  return { ...command, ...(drop.audio ? { audioTrackId: undefined } : {}), ...(drop.subtitle ? { subtitleTrackId: undefined } : {}) };
}

/**
 * Whether `plan` is from an earlier source or seek generation of the session than the one shown, or, in the same
 * generations, from an earlier revision (a pause accepted since) when both carry one.
 */
function olderThanShown(plan: V.PlaybackPlan, shown: V.PlaybackPlan | null): boolean {
  if (!shown || shown.sessionId !== plan.sessionId) return false;
  if (plan.sourceGeneration !== shown.sourceGeneration) return plan.sourceGeneration < shown.sourceGeneration;
  if (plan.seekGeneration !== shown.seekGeneration) return plan.seekGeneration < shown.seekGeneration;
  return typeof plan.revision === 'number' && typeof shown.revision === 'number' && plan.revision < shown.revision;
}
