// When a playback that is not moving is stalled: the policy behind core's session recovery.
// A slow start or seek (a cheap stick decoding in software, weak Wi-Fi, a server transcode spinning
// up) is not a stall while anything still moves: the position, the buffered range, the bytes
// arriving (the engine's loadProgress), its preparation stage, the server saying it is preparing. Only quiet that
// outlasts the attempt's budget is a stall; each restart gets a longer one, and after the last the
// viewer is told (with Try again) instead of being kept in a loop. Pure: the caller owns the clock.

/** Per attempt (the first session, then each restart): how long nothing may move before it is a stall. */
export const QUIET_SECONDS = [10, 20, 40] as const;
/**
 * However much keeps trickling in, an attempt that has not played (or reached a viewer's new
 * position) for this long is a stall too: a stream that drips forever never shows a picture.
 * Generous on purpose: a seek on an Android emulator fed at 100 kbit/s (a 2.5 Mbit/s film) took
 * 113 s to play, and a slow start that is still loading must be allowed to finish.
 */
export const PATIENCE_SECONDS = 180;
/** Playing on this far (in title seconds) proves the session healthy: its attempts start over. */
export const PLAYED_SECONDS = 10;

/** What an engine snapshot says about progress (the player API's Snapshot fields that matter). */
export interface StallSample {
  state?: string;
  position?: number;
  bufferAheadSeconds?: number | null;
  playable?: readonly { start: number; end: number }[] | null;
  throughputBps?: number | null;
  /** Grows while the engine gets somewhere loading: bytes received, packets demuxed, startup steps. */
  loadProgress?: number | null;
  preparation?: string | null;
  sourceGeneration?: number;
  seekGeneration?: number;
}

/** What the server's plan says: a session still preparing its media is progress on its side. */
export interface StallPlan {
  state?: string;
  revision?: number;
  selectedPathId?: string;
  paths?: readonly { id: string; readiness?: string }[];
  fallback?: { state?: string } | null;
}

interface Marks {
  state: string;
  position: number | undefined;
  buffered: number;
  ahead: number;
  throughput: number | null;
  load: number;
  preparation: string | null;
  generations: string;
}

export interface StallWatch {
  /** 0 for the first session; each restart adds one. */
  attempt: number;
  /** The last sign of any progress (ms). */
  heard: number;
  /** The last time playback moved, or the viewer asked for a new position (ms). */
  moved: number;
  /** Paused or ended: the viewer is not waiting, so nothing is due. */
  idle: boolean;
  /** The server says the session's media is still being prepared. */
  serverPreparing: boolean;
  /** Where playback was first seen moving in this attempt, for PLAYED_SECONDS. */
  playedFrom: number | null;
  serverRevision: number | null;
  marks: Marks | null;
}

export type StallVerdict = 'restart' | 'give-up';

/** A new watch: a session that just started (attempt 0) or a restart's replacement. */
export function stallWatch(now: number, attempt = 0): StallWatch {
  return { attempt, heard: now, moved: now, idle: false, serverPreparing: false, playedFrom: null, serverRevision: null, marks: null };
}

const WAITING = new Set(['idle', 'loading', 'buffering', 'recovering']);
const EPSILON = 0.05;

function bufferedEnd(sample: StallSample): number {
  let end = Number.NEGATIVE_INFINITY;
  for (const range of sample.playable ?? []) if (Number.isFinite(range.end) && range.end > end) end = range.end;
  return end;
}

/**
 * A growing measure against its mark: the value it last counted as growth at. Growth is counted
 * from the mark, not the previous sample, so a buffer filling slowly over many snapshots still
 * counts. A measure that first appears, or falls (a new engine counting from zero), sets the mark.
 */
function measure(mark: number, value: number): { mark: number; grew: boolean } {
  if (!Number.isFinite(value)) return { mark, grew: false };
  if (!Number.isFinite(mark) || value < mark) return { mark: value, grew: false };
  return value > mark + EPSILON ? { mark: value, grew: true } : { mark, grew: false };
}

/** Fold an engine snapshot in. */
export function heardEngine(watch: StallWatch, sample: StallSample, now: number): StallWatch {
  const state = sample.state ?? watch.marks?.state ?? 'loading';
  const last = watch.marks;
  const buffered = measure(last?.buffered ?? Number.NEGATIVE_INFINITY, bufferedEnd(sample));
  const ahead = measure(last?.ahead ?? Number.NEGATIVE_INFINITY, sample.bufferAheadSeconds ?? Number.NEGATIVE_INFINITY);
  const load = measure(last?.load ?? Number.NEGATIVE_INFINITY, sample.loadProgress ?? Number.NEGATIVE_INFINITY);
  const marks: Marks = {
    state,
    position: sample.position ?? last?.position,
    buffered: buffered.mark,
    ahead: ahead.mark,
    throughput: sample.throughputBps ?? null,
    load: load.mark,
    preparation: sample.preparation ?? null,
    generations: `${sample.sourceGeneration ?? ''}:${sample.seekGeneration ?? ''}`,
  };
  if (state === 'paused' || state === 'ended') {
    return { ...watch, idle: true, heard: now, moved: now, playedFrom: null, marks };
  }
  const next: StallWatch = { ...watch, idle: false, marks };
  // Coming back from a pause, or a first sample: the clocks start now.
  if (watch.idle || !last) return { ...next, heard: now, moved: now };
  const positionChanged = marks.position !== undefined && last.position !== undefined && Math.abs(marks.position - last.position) > EPSILON;
  const newIntent = marks.generations !== last.generations;
  // Playing forward: real progress. Any other move (a seek honoured, a new generation) is a new
  // position the viewer asked for, and its own wait starts now.
  const playing = state === 'playing' && last.state === 'playing' && positionChanged && marks.position! > last.position!;
  if (playing) {
    const from = watch.playedFrom ?? last.position!;
    if (marks.position! - from >= PLAYED_SECONDS) return { ...next, attempt: 0, heard: now, moved: now, playedFrom: marks.position! };
    return { ...next, heard: now, moved: now, playedFrom: from };
  }
  if (positionChanged || newIntent) return { ...next, heard: now, moved: now, playedFrom: null };
  // An engine that says it is waiting is believed while its buffer grows, bytes keep arriving or
  // it moves through its preparation. One that says it is playing must move its position.
  const loading = WAITING.has(state) && (
    buffered.grew || ahead.grew || load.grew ||
    (marks.throughput !== null && marks.throughput > 0 && marks.throughput !== last.throughput) ||
    marks.preparation !== last.preparation);
  if (loading || state !== last.state) return { ...next, heard: now };
  return next;
}

/** Fold the server's plan in: a new revision, or media it says it is still preparing. */
export function heardServer(watch: StallWatch, plan: StallPlan, now: number): StallWatch {
  const path = plan.paths?.find(p => p.id === plan.selectedPathId);
  const serverPreparing = plan.state === 'recovering' || path?.readiness === 'preparing' || plan.fallback?.state === 'preparing';
  const revision = typeof plan.revision === 'number' ? plan.revision : null;
  const changed = revision !== null && revision !== watch.serverRevision;
  return { ...watch, serverPreparing, serverRevision: revision ?? watch.serverRevision, heard: changed || serverPreparing ? now : watch.heard };
}

/** When the current attempt is stalled (ms), or null while nothing is due (paused, ended). */
export function stallDeadline(watch: StallWatch): number | null {
  if (watch.idle) return null;
  const quiet = QUIET_SECONDS[Math.min(watch.attempt, QUIET_SECONDS.length - 1)]! * 1000;
  const patience = watch.moved + PATIENCE_SECONDS * 1000;
  // While the server says it is preparing, only patience bounds the wait.
  return watch.serverPreparing ? patience : Math.min(watch.heard + quiet, patience);
}

/** At the deadline (or after a failure the engine could not ride out): restart, or tell the viewer. */
export function stallVerdict(watch: Pick<StallWatch, 'attempt'>): StallVerdict {
  return watch.attempt + 1 < QUIET_SECONDS.length ? 'restart' : 'give-up';
}
