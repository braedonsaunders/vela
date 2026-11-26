// Live TV catch-up and timeshift (features.liveCatchUp): which guide programmes can play from the
// provider's archive, and the rewind window of a playing channel. Every rule here is pure: the
// caller passes the clock, so the guide and the chrome agree and the tests need no wall clock.
import { clock, msg } from '../i18n';
import type * as V from '../wire';

const DAY = 86_400_000;

/** What the server offers, read once from its features. */
export interface CatchUpOffer {
  /** Some channel keeps an archive: past programmes and Start over. */
  archive: boolean;
  /** Largest archive available to this viewer. */
  maxDays?: number;
  /** Live channels may carry a rewind window: pause, rewind and Back to live. */
  timeshift: boolean;
}

export function catchUpOffer(features: Partial<V.ServerCapabilities['features']> | null | undefined): CatchUpOffer {
  const feature = features?.liveCatchUp;
  return { archive: !!feature?.available, ...(feature?.available && feature.maxDays ? { maxDays: feature.maxDays } : {}), timeshift: !!feature?.timeshift?.available };
}

/** How a guide programme can play beyond live: from the archive once ended, from its start while on air. */
export type CatchUpKind = 'catchUp' | 'startOver';

export interface ArchiveRange { startAt: string; durationSeconds: number }

/** An id-less listing still needs a stable cell key and a distinct cache entry. */
export function guideProgrammeKey(programme: Pick<V.Programme, 'id' | 'channelId' | 'start'>): string {
  return programme.id || `archive-range:${programme.channelId}:${programme.start}`;
}

/** Why a programme cannot play from the archive, for the programme panel's note. */
export type CatchUpRefusal = 'no-archive' | 'too-old' | 'upcoming';

type Timed = Pick<V.Programme, 'start' | 'end' | 'catchUp' | 'startOver'>;

/**
 * The A4 rule, recomputed with the caller's clock because guide pages are cached for minutes and a
 * programme ends inside that time: ended and wholly inside the archive is catch-up, on air with its
 * start inside the archive is Start over. An explicit flag for the current phase takes precedence.
 * Without archive depth, a cached Start over flag can carry forward when the programme ends.
 */
export function programmeCatchUp(programme: Timed, archiveDays: number | undefined, now: number, offer: CatchUpOffer): CatchUpKind | null {
  if (!offer.archive) return null;
  const start = Date.parse(programme.start), end = Date.parse(programme.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start > now) return null;
  const ended = end <= now;
  const kind: CatchUpKind = ended ? 'catchUp' : 'startOver';
  const flag = ended ? programme.catchUp : programme.startOver;
  const archived = archiveDays !== undefined && archiveDays > 0
    ? start >= now - archiveDays * DAY
    : ended && programme.startOver === true;
  return (flag ?? archived) ? kind : null;
}

/** Why `programmeCatchUp` said no, or null when it did not. */
export function catchUpRefusal(programme: Timed, archiveDays: number | undefined, now: number, offer: CatchUpOffer): CatchUpRefusal | null {
  if (programmeCatchUp(programme, archiveDays, now, offer)) return null;
  const start = Date.parse(programme.start);
  if (Number.isFinite(start) && start > now) return 'upcoming';
  if (offer.archive && archiveDays !== undefined && archiveDays > 0) return 'too-old';
  return 'no-archive';
}

/** The request for a programme from the archive: an ended one plays its range, one on air from its start. */
export function catchUpRequest(channelId: string, programmeId: string, kind: CatchUpKind): { channelId: string; programmeId: string; from?: 'start' } {
  return kind === 'startOver' ? { channelId, programmeId, from: 'start' } : { channelId, programmeId };
}

/** A watch target's programme as a catch-up kind ("Watch from start"), when the archive holds it. */
export function watchFromStart(target: V.WatchTarget, now: number, offer: CatchUpOffer): CatchUpKind | null {
  if (!target.channelId || !target.programme || target.available === false) return null;
  return programmeCatchUp(target.programme, undefined, now, offer);
}

/** What the engine reports about the window, in its own timeline (the same one as its position). */
export interface EngineWindow {
  edgeSeconds: number | null;
  windowStartSeconds: number | null;
  /** The engine's own verdict that playback trails live by more than its latency target. */
  canCatchUp?: boolean;
  /** When (ms, the caller's clock) the engine's edge last moved. A paused engine stops reading the
   * playlist and its edge stands still; the broadcast does not, so the edge grows from here. */
  edgeMovedAt?: number;
}

export interface WindowInput {
  live: NonNullable<V.PlaybackPlan['live']>;
  /** When the plan arrived (ms, the caller's clock): the edge grows in real time from here. */
  receivedAt: number;
  now: number;
  position: number;
  engine?: EngineWindow | null;
}

/** A live session's rewind window, in the timeline playback positions use. */
export interface TimeshiftWindow {
  start: number;
  edge: number;
  edgeAt: number;
  /** The playhead, held inside the window. */
  position: number;
  /** Seconds the playhead trails the live edge (the stream's own latency included). */
  behind: number;
  /** Playback trails live by more than the stream's latency: Back to live is offered and the delay shown. */
  delayed: boolean;
  /** The viewer can seek in it (a rewind window, or Start over's growing programme). */
  seekable: boolean;
  startOver: boolean;
}

/** An engine edge unchanged for this long has stopped reading the playlist (several segments' time). */
const EDGE_STALE_MS = 15_000;

/** Normal live latency: a few segments short of the newest one, on purpose. */
export const LIVE_SLACK_SECONDS = 15;

/**
 * The window to draw. The engine's own report wins when it has one (its edge and its position share
 * a timeline); otherwise the plan's, with the edge grown by the time since the plan arrived and a
 * bounded window's start following it. Start over never loses its beginning.
 */
export function timeshiftWindow({ live, receivedAt, now, position, engine }: WindowInput): TimeshiftWindow | null {
  const startOver = live.mode === 'startOver';
  const issuedEdgeAt = Date.parse(live.edgeAt ?? '');
  const hasClock = Number.isFinite(issuedEdgeAt);
  let edge: number, start: number;
  if (engine?.edgeSeconds != null && Number.isFinite(engine.edgeSeconds)) {
    edge = engine.edgeSeconds + (engine.edgeMovedAt !== undefined ? Math.max(0, now - engine.edgeMovedAt) / 1000 : 0);
    start = engine.windowStartSeconds ?? live.windowStartSeconds ?? engine.edgeSeconds;
    const max = live.timeshift?.maxMinutes;
    if (!startOver && max && max > 0) start = Math.max(start, edge - max * 60);
  } else {
    if (live.liveEdgeSeconds === undefined) return null;
    edge = live.liveEdgeSeconds + Math.max(0, now - (hasClock ? issuedEdgeAt : receivedAt)) / 1000;
    start = live.windowStartSeconds ?? live.liveEdgeSeconds;
    const max = live.timeshift?.maxMinutes;
    if (!startOver && max && max > 0) start = Math.max(start, edge - max * 60);
  }
  if (!(edge >= start)) return null;
  const at = Math.min(edge, Math.max(start, position));
  const behind = Math.max(0, edge - position);
  const seekable = startOver || (!!live.timeshift && edge - start > LIVE_SLACK_SECONDS * 2);
  // An engine reading its playlist judges "behind" against its own latency target, which it widens
  // after stalls; its verdict stands. One whose edge has stood still (paused) judges nothing current,
  // and neither does a plan alone: then the picture is behind once it trails the grown edge by more
  // than the stream's latency. Without a rewind window the engine's report is all there is.
  const fresh = engine?.edgeSeconds != null && (engine.edgeMovedAt === undefined || now - engine.edgeMovedAt <= EDGE_STALE_MS);
  const delayed = !seekable ? !!engine?.canCatchUp : fresh ? !!engine!.canCatchUp : behind > LIVE_SLACK_SECONDS * 2;
  const edgeAt = hasClock && live.liveEdgeSeconds !== undefined
    ? issuedEdgeAt + (edge - live.liveEdgeSeconds) * 1000 : now;
  return { start, edge, edgeAt, position: at, behind, delayed, seekable, startOver };
}

/** Where a seek may land: inside the window, short of the edge by the stream's latency. */
export function clampSeek(window: Pick<TimeshiftWindow, 'start' | 'edge'>, seconds: number): number {
  const latest = Math.max(window.start, window.edge - LIVE_SLACK_SECONDS);
  return Math.min(latest, Math.max(window.start, seconds));
}

/** A step that would land within the stream's latency of the edge is a return to live instead. */
export function stepLandsLive(window: Pick<TimeshiftWindow, 'edge' | 'position'>, seconds: number): boolean {
  return seconds > 0 && window.position + seconds >= window.edge - LIVE_SLACK_SECONDS;
}

/** The playhead's share of the window, 0..1. */
export function windowFraction(window: Pick<TimeshiftWindow, 'start' | 'edge' | 'position'>): number {
  const span = window.edge - window.start;
  return span > 0 ? Math.min(1, Math.max(0, (window.position - window.start) / span)) : 1;
}

/** "-12:30": how far behind live the picture is. Empty at live. */
export function delayLabel(behindSeconds: number): string {
  return behindSeconds >= 1 ? `-${clock(behindSeconds)}` : '';
}

/** The real time (ms) the picture shows: now less the delay. Frame-free, so any engine's window works. */
export function pictureTime(now: number, behindSeconds: number): number {
  return now - Math.max(0, behindSeconds) * 1000;
}

/** A finite catch-up plan's picture time: the programme's start plus the position. */
export function catchUpPictureTime(plan: Pick<V.PlaybackPlan, 'catchUp'>, position: number): number | null {
  const start = plan.catchUp ? Date.parse(plan.catchUp.startAt) : NaN;
  return Number.isFinite(start) ? start + Math.max(0, position) * 1000 : null;
}

/** How long a paused live picture may keep the server window before the score bug stops trusting live data. */
export const SPOILER_DELAY_SECONDS = 30;

/** The score bug's view of a delayed picture. */
export type DelayedScores =
  | { kind: 'live' }
  /** Scores as of the picture, from plays the plugin timed and scored. */
  | { kind: 'asOf'; scores: Record<string, string> }
  /** Behind live with no way to know the score on screen: scores are hidden. */
  | { kind: 'hidden' };

/**
 * Spoiler-aware scores: within the stream's normal delay the live score stands. Further behind, the
 * newest timed and scored play no later than the picture gives the score on screen; plays carry no
 * times or scores on most feeds, and then the scores are hidden rather than shown ahead of the picture.
 */
export function delayedScores(plays: readonly V.LivePlay[] | undefined, pictureAt: number, behindSeconds: number): DelayedScores {
  if (behindSeconds <= SPOILER_DELAY_SECONDS) return { kind: 'live' };
  let best: { at: number; score: Record<string, string> } | null = null;
  let timed = false, untimedScore = false;
  for (const play of plays ?? []) {
    const at = play.at ? Date.parse(play.at) : NaN;
    if (!Number.isFinite(at) || !play.score) {
      if (play.emphasis === 'score') untimedScore = true;
      continue;
    }
    timed = true;
    if (at <= pictureAt && (!best || at >= best.at)) best = { at, score: play.score };
  }
  if (best) return { kind: 'asOf', scores: best.score };
  // Every score timed and all after the picture: nothing had been scored yet on screen.
  if (timed && !untimedScore) return { kind: 'asOf', scores: {} };
  return { kind: 'hidden' };
}

/** The viewer's words for a catch-up or timeshift refusal (C6), or '' for any other error. */
export function catchUpErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'catchup_not_supported': return msg('catchUp.notSupported');
    case 'catchup_outside_archive': return msg('catchUp.outsideArchive');
    case 'catchup_unavailable': return msg('catchUp.unavailable');
    case 'timeshift_outside_window': return msg('catchUp.outsideWindow');
    case 'timeshift_position_evicted': return msg('catchUp.evicted');
    case 'provider_busy': return msg('catchUp.providerBusy');
    default: return '';
  }
}

/** The programme panel's note for a programme that cannot play from the archive. */
export function catchUpRefusalMessage(refusal: CatchUpRefusal): string {
  return refusal === 'too-old' ? msg('catchUp.tooOld') : refusal === 'no-archive' ? msg('catchUp.noArchive') : '';
}
