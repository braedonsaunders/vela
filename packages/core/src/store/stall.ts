// When a playback that is not moving is stalled: the policy behind core's session recovery.
// A slow start or seek (a cheap stick decoding in software, weak Wi-Fi, a server transcode spinning
// up) is not a stall while anything still moves: the position, the buffered range, the bytes
// arriving (the engine's loadProgress), its preparation stage, the server preparing media or making it
// ready. What an engine does to recover on its own is not progress: switching between waiting states
// while it reconnects or reloads, or a path switch or fallback it asks the server for (a new plan and
// new generations, not a position the viewer asked for). Nor is the server echoing the player: every
// observation the player sends gives the plan a new revision (and "buffering" makes it "recovering"),
// so only what the server prepares counts, never the revision or state alone. Only quiet that
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
  sourceGeneration?: number;
  seekGeneration?: number;
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
  /** What the server last said it prepares and plays (serverMark), or null before its first plan. */
  serverMark: string | null;
  /** Session commands the engine sent on its own that the server has not answered yet. */
  engineCommands: number;
  /** The generations (`source:seek`) an engine command of its own moved the session to. */
  engineGenerations: string | null;
  marks: Marks | null;
}

export type StallVerdict = 'restart' | 'give-up';

/** A new watch: a session that just started (attempt 0) or a restart's replacement. */
export function stallWatch(now: number, attempt = 0): StallWatch {
  return { attempt, heard: now, moved: now, idle: false, serverPreparing: false, playedFrom: null, serverMark: null,
    engineCommands: 0, engineGenerations: null, marks: null };
}

const WAITING = new Set(['idle', 'loading', 'buffering', 'recovering']);
const EPSILON = 0.05;

function bufferedEnd(sample: StallSample): number {
  let end = Number.NEGATIVE_INFINITY;
  for (const range of sample.playable ?? []) if (Number.isFinite(range.end) && range.end > end) end = range.end;
  return end;
}

/** A hole this wide in front of the playhead is one it cannot play into on its own. */
const PARKED_GAP_SECONDS = 0.5;

/**
 * The playhead parked in front of media it cannot reach: outside every playable range, with one
 * starting beyond a gap ahead of it (a live start whose media begins later than its playlist says).
 * Media arriving beyond the gap is not progress for the viewer, who sees nothing.
 */
export function parkedBeforeGap(sample: Pick<StallSample, 'position' | 'playable'>): boolean {
  const position = sample.position;
  const ranges = sample.playable ?? [];
  if (position === undefined || !Number.isFinite(position) || !ranges.length) return false;
  if (ranges.some(r => position >= r.start - EPSILON && position <= r.end + EPSILON)) return false;
  return ranges.some(r => r.start > position + PARKED_GAP_SECONDS);
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
  // The engine's own path switch or fallback moves the generations, and its new source may start a
  // moment off the old position: neither is a position the viewer asked for, nor progress.
  if (marks.generations !== last.generations && marks.generations === watch.engineGenerations) return next;
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
  // it moves through its preparation, unless its playhead is parked in front of a gap that all of
  // that lands beyond. One that says it is playing must move its position.
  const loading = WAITING.has(state) && !parkedBeforeGap(sample) && (
    buffered.grew || ahead.grew || load.grew ||
    (marks.throughput !== null && marks.throughput > 0 && marks.throughput !== last.throughput) ||
    marks.preparation !== last.preparation);
  // A move between playing and waiting is news; one between waiting states (an engine reconnecting,
  // reloading or re-preparing its source over and over) is not.
  const changedState = state !== last.state && !(WAITING.has(state) && WAITING.has(last.state));
  if (loading || changedState) return { ...next, heard: now };
  return next;
}

/** The engine is sending a session command of its own (a recovery path switch, a fallback it
 * prepares): until the server answers, a changed plan is that command's doing, not progress. */
export function engineCommandSent(watch: StallWatch): StallWatch {
  return { ...watch, engineCommands: watch.engineCommands + 1 };
}

/** The server answered the engine's own command (`plan` is null when it refused): its plan and
 * generations are the engine's move, neither progress nor a position the viewer asked for. */
export function engineCommandAnswered(watch: StallWatch, plan: StallPlan | null): StallWatch {
  const engineCommands = Math.max(0, watch.engineCommands - 1);
  if (!plan) return { ...watch, engineCommands };
  return { ...watch, engineCommands, serverMark: serverMark(plan), engineGenerations: `${plan.sourceGeneration ?? ''}:${plan.seekGeneration ?? ''}` };
}

/** What the server prepares and plays: the selected path, each path's readiness, the fallback. Not
 * the revision, state or position, which follow the player's own observations. */
function serverMark(plan: StallPlan): string {
  return JSON.stringify([plan.selectedPathId ?? '', (plan.paths ?? []).map(path => `${path.id}=${path.readiness ?? ''}`), plan.fallback?.state ?? '']);
}

/** Fold the server's plan in: a change in what it prepares, or media it says it is still preparing. */
export function heardServer(watch: StallWatch, plan: StallPlan, now: number): StallWatch {
  const path = plan.paths?.find(p => p.id === plan.selectedPathId);
  const serverPreparing = path?.readiness === 'preparing' || plan.fallback?.state === 'preparing';
  const mark = serverMark(plan);
  // News only when what it prepares changed, and not by the engine's own command.
  const changed = watch.serverMark !== null && mark !== watch.serverMark && watch.engineCommands === 0;
  return { ...watch, serverPreparing, serverMark: mark, heard: changed || serverPreparing ? now : watch.heard };
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
