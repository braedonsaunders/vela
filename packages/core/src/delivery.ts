// When a stream is more than the network carries, and what to play instead. A 2.4 GHz TV box (about
// 15-20 Mbit/s of real throughput) cannot keep a 25 Mbit/s remux fed: it plays a second, waits, plays a
// second. Such a session steps down to one of the plan's server transcodes (its `paths`, the quality
// menu's choices) whose rate the measured throughput carries with room to spare. Only evidence counts:
// playback that keeps stopping to wait for media while the player is loading flat out. A start, a seek
// or a switch starts the evidence over, so their own waits never count: a switch and a server seek bring
// new generations, and a seek the engine makes itself (the TV chrome's 10 s steps, a scrub, a chapter) moves
// the position further than the clock explains. Steps only
// ever go down: a viewer who wants more picks it in the quality menu, and that pick is never undone here.
// Pure: the caller owns the clock.
import type { PlaybackPath, PlaybackPlan } from './wire';

/** What a player snapshot says about delivery (the player API's Snapshot fields that matter). */
export interface DeliverySample {
  sessionId?: string | null;
  sourceGeneration?: number;
  seekGeneration?: number;
  state?: string;
  seekTarget?: number | null;
  /** Media bytes received so far by this engine (Snapshot.loadProgress on Android); only growth counts. */
  loadProgress?: number | null;
  bufferAheadSeconds?: number | null;
  /** Where playback stands (seconds) and how fast it moves: a jump the clock does not explain is a seek. */
  position?: number | null;
  speed?: number | null;
}

interface Mark { at: number; bytes: number | null; state: string; ahead: number; position: number | null }

export interface DeliveryWatch {
  /** `session:source:seek`: evidence belongs to one source at one seek. */
  key: string;
  /** When playback first played at these generations (ms), or null before it has. */
  playedAt: number | null;
  /** Snapshots in the last WINDOW_MS, oldest first. */
  marks: Mark[];
}

/** How far back the evidence reaches. */
export const WINDOW_MS = 60_000;
/** Playing this long at the generations, at least, before a step: one hiccup after a start is not a verdict. */
export const EVIDENCE_MS = 30_000;
/** Waits for media (after playing) in the window, and the share of the wanted time they took, that make a stall. */
export const STALLS = 2;
export const STALLED_SHARE = 0.2;
/** A buffer this deep means the player had stopped loading (it fills to 50 s): bytes then say nothing of the network. */
const FULL_BUFFER_SECONDS = 40;
/** A step picks a rate at most this share of the measured throughput (a transcode's peaks, Wi-Fi's swings). */
export const HEADROOM = 0.65;
/** A step goes at least this far down, or it is not worth a switch. */
const MEANINGFUL = 0.85;
/** A position this far ahead of what the clock explains, or this far behind where it was, is a seek (a wait
 * only ever holds the position still). */
const SEEK_AHEAD_SECONDS = 2;
const SEEK_BACK_SECONDS = 1;

export function deliveryWatch(): DeliveryWatch {
  return { key: '', playedAt: null, marks: [] };
}

const keyOf = (s: DeliverySample) => `${s.sessionId ?? ''}:${s.sourceGeneration ?? 0}:${s.seekGeneration ?? 0}`;
const finite = (value: number | null | undefined): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Whether the position moved since the last mark in a way playing does not: a seek the engine made itself. */
function seeked(last: Mark | undefined, position: number | null, speed: number | null, now: number): boolean {
  if (!last || last.position === null || position === null) return false;
  const moved = position - last.position;
  const explained = Math.max(0, now - last.at) / 1000 * (speed !== null && speed > 0 ? speed : 1);
  return moved > explained + SEEK_AHEAD_SECONDS || moved < -SEEK_BACK_SECONDS;
}

/** Fold a snapshot in. */
export function heardDelivery(watch: DeliveryWatch, sample: DeliverySample, now: number): DeliveryWatch {
  const key = keyOf(sample);
  const state = sample.state ?? 'loading';
  const position = finite(sample.position);
  const fresh = key !== watch.key || seeked(watch.marks.at(-1), position, finite(sample.speed), now);
  // A seek in flight waits for the viewer's new position, not for the network.
  if (sample.seekTarget != null && key === watch.key) return watch;
  const bytes = finite(sample.loadProgress);
  const mark: Mark = { at: now, bytes, state, ahead: sample.bufferAheadSeconds ?? 0, position };
  const marks = (fresh ? [] : watch.marks).filter(m => now - m.at <= WINDOW_MS);
  marks.push(mark);
  const playedAt = fresh ? (state === 'playing' ? now : null) : watch.playedAt ?? (state === 'playing' ? now : null);
  return { key, playedAt, marks };
}

export interface DeliveryEvidence {
  /** Waits for media after playing, in the window. */
  stalls: number;
  /** Their share of the time the viewer wanted playback (playing or waiting). */
  stalledShare: number;
  /** Received bits per second while the player was loading (its buffer short of full), or null if unmeasured. */
  throughputBps: number | null;
}

/** What the window shows, from when the session first played at these generations. */
export function deliveryEvidence(watch: DeliveryWatch): DeliveryEvidence {
  let stalls = 0, stalled = 0, wanted = 0, bits = 0, loading = 0;
  const played = watch.playedAt;
  for (let i = 1; i < watch.marks.length; i++) {
    const before = watch.marks[i - 1]!, mark = watch.marks[i]!;
    if (played === null || before.at < played) continue;
    const span = mark.at - before.at;
    const waiting = before.state === 'buffering';
    if (waiting || before.state === 'playing') wanted += span;
    if (waiting) stalled += span;
    if (mark.state === 'buffering' && before.state === 'playing') stalls++;
    // Bytes say what the network carries only while the player is asking for more.
    if (before.bytes !== null && mark.bytes !== null && mark.bytes >= before.bytes && before.ahead < FULL_BUFFER_SECONDS
      && (waiting || before.state === 'playing')) {
      bits += (mark.bytes - before.bytes) * 8;
      loading += span;
    }
  }
  return {
    stalls,
    stalledShare: wanted > 0 ? stalled / wanted : 0,
    throughputBps: loading >= 10_000 && bits > 0 ? bits / (loading / 1000) : null,
  };
}

/** A path's rate in bits per second: its quality's average (else peak), the top rung it lists, or its file's
 * size over the plan's duration; null when unknown. */
export function pathRate(path: PlaybackPath, durationSeconds?: number): number | null {
  const quality = path.quality;
  if (quality) return quality.averageBitrate ?? quality.bitrate;
  const top = Math.max(0, ...path.qualities.map(q => q.averageBitrate ?? q.bitrate));
  if (top > 0) return top;
  if (path.byteLength && durationSeconds && durationSeconds > 0) return (path.byteLength * 8) / durationSeconds;
  return null;
}

/** Where a measurement for the server stops looking back (Ether wants a fresh active download rate). */
const MEASURE_MS = 20_000;

/**
 * The player's active download rate for the server's observations (Ether 0.3.25 `throughputBps`): bits received
 * per second while the player was loading (its buffer short of full) over the last MEASURE_MS, the start and a
 * seek included. Null without 5 s of loading in that stretch: the field is omitted until there is a fresh one.
 */
export function measuredThroughput(watch: DeliveryWatch, now: number): number | null {
  let bits = 0, loading = 0;
  for (let i = 1; i < watch.marks.length; i++) {
    const before = watch.marks[i - 1]!, mark = watch.marks[i]!;
    if (now - before.at > MEASURE_MS) continue;
    if (before.bytes === null || mark.bytes === null || mark.bytes < before.bytes || before.ahead >= FULL_BUFFER_SECONDS) continue;
    bits += (mark.bytes - before.bytes) * 8;
    loading += mark.at - before.at;
  }
  if (loading < 5000 || bits <= 0) return null;
  const bps = bits / (loading / 1000);
  return bps > 0 && bps <= 10_000_000_000 ? Math.round(bps) : null;
}

/** A step to one of the plan's transcode paths (the quality menu's), or, on a plan with no such ladder and a
 * server that takes it (Ether 0.3.25), a switch by bitrate: the server's best rung at or under `maxBitrate`. */
export type StepDown =
  | { pathId: string; rateBps: number; throughputBps: number; adaptive?: undefined }
  /** The plan's adaptive HLS path (Ether 0.3.25): the player then picks its own rung, down and back up. Taken on
   * the stalls alone, so the throughput is null when the engine reports no bytes to measure it by. */
  | { pathId: string; adaptive: true; throughputBps: number | null }
  | { maxBitrate: number; throughputBps: number };

/** What decides how a step is sent. */
export interface StepOptions {
  /** The server takes `switch {maxBitrate}` (a refused one stops further tries on the session). */
  bitrateSwitch?: boolean;
  /** The plan's own playlist adapts (Ether's multi-variant HLS): the player steps down on its own. */
  adaptive?: boolean;
  /** The viewer chose a quality in this session (a rung, the original, Automatic): an automatic step never
   * overrides it. */
  viewerChose?: boolean;
}

/** The plan's adaptive HLS path offered beside what plays (a multi-variant master the player adapts across, Ether
 * 0.3.25 `adaptive`), or undefined. */
export function adaptivePath(plan: PlaybackPlan | null): PlaybackPath | undefined {
  return plan?.paths.find(path => path.id !== plan.selectedPathId && path.transport === 'hls' && path.adaptive === true
    && (path.readiness === 'ready' || path.readiness === 'on-demand'));
}

/**
 * The path to switch to: the plan's adaptive HLS path when it offers one beside what plays, else the server
 * transcode (or the bitrate to ask the server for, StepOptions); null to stay. A step needs EVIDENCE_MS of playing at these
 * generations and STALLS waits for media taking STALLED_SHARE of the wanted time in the window. The adaptive path
 * needs nothing more: the player picks its own rung there, so no throughput has to say which (an engine that reports
 * no bytes still gets off a stream it cannot keep fed). A fixed rung needs a throughput measurement too: it takes the
 * best transcode within HEADROOM of that throughput, else the lowest one, and never one that is not clearly below what
 * plays now. Live plans are left to the live machinery.
 */
export function stepDown(watch: DeliveryWatch, plan: PlaybackPlan | null, now: number, options: StepOptions = {}): StepDown | null {
  if (!plan || plan.live || options.adaptive || options.viewerChose || watch.playedAt === null || now - watch.playedAt < EVIDENCE_MS) return null;
  if (watch.key !== `${plan.sessionId}:${plan.sourceGeneration}:${plan.seekGeneration}`) return null;
  const evidence = deliveryEvidence(watch);
  if (evidence.stalls < STALLS || evidence.stalledShare < STALLED_SHARE) return null;
  // An adaptive path offered beside what plays (direct play, a fixed rung) beats any fixed rung: the player then
  // follows the network down and back up on its own.
  const adaptive = adaptivePath(plan);
  const measured = evidence.throughputBps === null ? null : Math.round(evidence.throughputBps);
  if (adaptive) return { pathId: adaptive.id, adaptive: true, throughputBps: measured };
  if (evidence.throughputBps === null) return null;
  const selected = plan.paths.find(path => path.id === plan.selectedPathId);
  const current = selected ? pathRate(selected, plan.durationSeconds) : null;
  const ceiling = current === null ? Infinity : current * MEANINGFUL;
  const offers = plan.paths
    .filter(path => path.id !== plan.selectedPathId && path.kind === 'transcode' && path.quality
      && (path.readiness === 'ready' || path.readiness === 'on-demand'))
    .map(path => ({ path, rate: pathRate(path)! }))
    .filter(offer => offer.rate > 0 && offer.rate < ceiling)
    .sort((a, b) => b.rate - a.rate);
  if (!offers.length) {
    // No ladder on the plan to pick from: the server picks the rung under the cap, when it can.
    const ladder = plan.paths.some(path => path.kind === 'transcode' && path.quality);
    const maxBitrate = Math.floor(evidence.throughputBps * HEADROOM);
    return options.bitrateSwitch && !ladder && maxBitrate > 0 && maxBitrate < ceiling
      ? { maxBitrate, throughputBps: Math.round(evidence.throughputBps) } : null;
  }
  const fits = offers.find(offer => offer.rate <= evidence.throughputBps! * HEADROOM) ?? offers[offers.length - 1]!;
  return { pathId: fits.path.id, rateBps: fits.rate, throughputBps: Math.round(evidence.throughputBps) };
}

/**
 * Whether the plan's playlist adapts on its own: its playing HLS path is a multi-variant master (Ether 0.3.25
 * `adaptive`, offered to a client declaring features.adaptiveHLS). Then the player picks its rung and Vela does
 * not step down.
 */
export function playerAdapts(plan: PlaybackPlan | null): boolean {
  const path = plan?.paths.find(candidate => candidate.id === plan.selectedPathId);
  return path?.transport === 'hls' && path.adaptive === true;
}
