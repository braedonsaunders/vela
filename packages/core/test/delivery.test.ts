import { expect, test } from 'bun:test';
import { deliveryEvidence, deliveryWatch, heardDelivery, measuredThroughput, pathRate, playerAdapts, stepDown, type DeliverySample, type DeliveryWatch } from '../src/delivery';
import type { PlaybackPath, PlaybackPlan } from '../src/wire';

const transcode = (id: string, average: number, peak = average * 1.2): PlaybackPath => ({
  id, kind: 'transcode', transport: 'hls', readiness: 'on-demand', mimeType: 'application/vnd.apple.mpegurl',
  quality: { width: 1920, height: 1080, bitrate: peak, averageBitrate: average }, qualities: [], boundaries: [],
} as PlaybackPath);

/** The lab's 1080p remux (about 25 Mbit/s) with its server transcodes. */
const plan = (extra: Partial<PlaybackPlan> = {}): PlaybackPlan => ({
  sessionId: 's1', revision: 3, state: 'playing', positionSeconds: 0, durationSeconds: 6106, sourceGeneration: 1, seekGeneration: 1,
  selectedPathId: 'primary', audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null, chapters: [], fallback: { state: 'idle' },
  paths: [
    { id: 'primary', kind: 'remux', transport: 'hls', readiness: 'ready', url: 'u', mimeType: 'application/vnd.apple.mpegurl', boundaries: [],
      qualities: [{ id: 'base', width: 1920, height: 1080, bitrate: 25_000_000, videoCodec: '', url: 'u' }] } as PlaybackPath,
    transcode('quality-1080p20000k', 20_640_000), transcode('quality-1080p12000k', 12_640_000),
    transcode('quality-1080p8000k', 8_640_000), transcode('quality-720p4000k', 4_640_000),
  ],
  ...extra,
} as PlaybackPlan);

/** Snapshots four times a second: `playing` and `waiting` seconds alternating, `bps` arriving while loading. */
function feed(watch: DeliveryWatch, from: number, seconds: number, pattern: (t: number) => DeliverySample['state'], bps: number, ahead = 2, extra: Partial<DeliverySample> = {}) {
  let bytes = (watch.marks.at(-1)?.bytes ?? 0);
  for (let ms = 0; ms <= seconds * 1000; ms += 250) {
    bytes += (bps / 8) * 0.25;
    watch = heardDelivery(watch, { sessionId: 's1', sourceGeneration: 1, seekGeneration: 1, state: pattern(ms / 1000), loadProgress: bytes, bufferAheadSeconds: ahead, seekTarget: null, ...extra }, from + ms);
  }
  return watch;
}
/** A starved remux: plays 2 s, waits 2 s. */
const starved = (t: number) => (Math.floor(t / 2) % 2 === 0 ? 'playing' : 'buffering');

test('a remux the network cannot carry steps down to the best transcode within the measured throughput', () => {
  const watch = feed(deliveryWatch(), 0, 45, starved, 18_000_000);
  const evidence = deliveryEvidence(watch);
  expect(evidence.stalls).toBeGreaterThanOrEqual(2);
  expect(evidence.stalledShare).toBeGreaterThan(0.4);
  expect(Math.round(evidence.throughputBps! / 1e6)).toBe(18);
  // 0.65 × 18 Mbit/s = 11.7: the 8 Mbit/s transcode (8.6 average), not the 12 (12.6).
  expect(stepDown(watch, plan(), 45_000)).toEqual({ pathId: 'quality-1080p8000k', rateBps: 8_640_000, throughputBps: 18_000_000 });
});

test('no step without enough evidence: early, few waits, or a short share', () => {
  // Under EVIDENCE_MS of playing at these generations.
  expect(stepDown(feed(deliveryWatch(), 0, 20, starved, 18_000_000), plan(), 20_000)).toBeNull();
  // One wait in a minute of playing.
  const once = feed(deliveryWatch(), 0, 50, t => (t > 20 && t < 23 ? 'buffering' : 'playing'), 30_000_000);
  expect(stepDown(once, plan(), 50_000)).toBeNull();
  // Smooth playback with a full buffer.
  expect(stepDown(feed(deliveryWatch(), 0, 60, () => 'playing', 30_000_000, 45), plan(), 60_000)).toBeNull();
});

test('the wait of a start, a seek or a switch is never evidence', () => {
  // Loading before the first play does not count, nor waits under a seek in flight.
  let watch = feed(deliveryWatch(), 0, 20, () => 'loading', 18_000_000);
  watch = feed(watch, 20_250, 40, t => (t < 30 ? 'playing' : 'buffering'), 18_000_000, 2, {});
  expect(deliveryEvidence(watch).stalls).toBe(1);
  // New generations (a seek accepted, a switch) start over.
  const after = heardDelivery(watch, { sessionId: 's1', sourceGeneration: 1, seekGeneration: 2, state: 'buffering', loadProgress: 0 }, 61_000);
  expect(after.marks).toHaveLength(1);
  expect(after.playedAt).toBeNull();
  expect(stepDown(after, plan({ seekGeneration: 2 }), 61_000)).toBeNull();
});

test('a slow network below every transcode takes the lowest; nothing lower than playing, no step', () => {
  const watch = feed(deliveryWatch(), 0, 45, starved, 3_000_000);
  expect(stepDown(watch, plan(), 45_000)).toMatchObject({ pathId: 'quality-720p4000k' });
  // Already on the lowest transcode: nothing below it.
  const lowest = plan({ selectedPathId: 'quality-720p4000k' });
  expect(stepDown(watch, lowest, 45_000)).toBeNull();
  // A live plan is the live machinery's.
  expect(stepDown(watch, plan({ live: { mode: 'adaptive' } }), 45_000)).toBeNull();
});

test('bytes while the buffer is full say nothing of the network', () => {
  const watch = feed(deliveryWatch(), 0, 45, starved, 18_000_000, 45);
  expect(deliveryEvidence(watch).throughputBps).toBeNull();
  expect(stepDown(watch, plan(), 45_000)).toBeNull();
});

test('a path\'s rate: its quality, its top rung, or its size over the duration', () => {
  expect(pathRate(transcode('t', 8_640_000))).toBe(8_640_000);
  expect(pathRate(plan().paths[0]!)).toBe(25_000_000);
  expect(pathRate({ id: 'f', kind: 'direct', qualities: [], byteLength: 19_100_000_000 } as unknown as PlaybackPath, 6106)).toBeCloseTo(25_024_566, -3);
  expect(pathRate({ id: 'f', kind: 'direct', qualities: [] } as unknown as PlaybackPath)).toBeNull();
});

test('a plan without a ladder asks the server for its best rung under the cap, when the server takes it', () => {
  const watch = feed(deliveryWatch(), 0, 45, starved, 18_000_000);
  const direct = plan({ paths: [plan().paths[0]!] });
  expect(stepDown(watch, direct, 45_000)).toBeNull();
  expect(stepDown(watch, direct, 45_000, { bitrateSwitch: true })).toEqual({ maxBitrate: 11_700_000, throughputBps: 18_000_000 });
  // A plan with a ladder keeps naming the path.
  expect(stepDown(watch, plan(), 45_000, { bitrateSwitch: true })).toMatchObject({ pathId: 'quality-1080p8000k' });
  // A plan whose playlist adapts is the player's to step down.
  expect(stepDown(watch, plan(), 45_000, { adaptive: true, bitrateSwitch: true })).toBeNull();
});

test('the server is told the active download rate: bytes while loading over the last 20 s, start included', () => {
  // Loading before the first play counts here (not for the step-down's evidence).
  const loading = feed(deliveryWatch(), 0, 8, () => 'loading', 12_000_000);
  expect(Math.round(measuredThroughput(loading, 8000)! / 1e6)).toBe(12);
  // Under 5 s of loading in the stretch: no measurement yet.
  expect(measuredThroughput(feed(deliveryWatch(), 0, 3, () => 'loading', 12_000_000), 3000)).toBeNull();
  // A full buffer is the player idling, not the network.
  expect(measuredThroughput(feed(deliveryWatch(), 0, 30, () => 'playing', 12_000_000, 45), 30_000)).toBeNull();
  // Only the last 20 s.
  const old = feed(deliveryWatch(), 0, 30, () => 'playing', 12_000_000);
  expect(measuredThroughput(old, 80_000)).toBeNull();
});

test('a plan whose playing HLS path is an adaptive master is the player\'s to step down', () => {
  const adaptive = plan({ paths: [{ ...plan().paths[0]!, adaptive: true }, ...plan().paths.slice(1)] });
  expect(playerAdapts(adaptive)).toBe(true);
  expect(playerAdapts(plan())).toBe(false);
  expect(playerAdapts(plan({ selectedPathId: 'quality-1080p8000k' }))).toBe(false);
  expect(playerAdapts(null)).toBe(false);
});

test('an adaptive path offered beside what plays is preferred over any fixed rung', () => {
  const watch = feed(deliveryWatch(), 0, 45, starved, 18_000_000);
  const master = { ...plan().paths[1]!, id: 'adaptive', kind: 'transcode', readiness: 'ready', url: 'u', adaptive: true, quality: undefined } as PlaybackPath;
  const offered = plan({ paths: [...plan().paths, master] });
  expect(stepDown(watch, offered, 45_000)).toEqual({ pathId: 'adaptive', adaptive: true, throughputBps: 18_000_000 });
  // Playing it already: the player adapts, nothing to step to.
  expect(stepDown(watch, plan({ paths: offered.paths, selectedPathId: 'adaptive' }), 45_000, { adaptive: playerAdapts(plan({ paths: offered.paths, selectedPathId: 'adaptive' })) })).toBeNull();
});

test('waits after seeks the engine makes itself (the TV chrome\'s 10 s steps) are not evidence; a starved stream still is', () => {
  // tx1-box, 2026-11-27: direct play on a healthy link, five 10 s steps 2-3 s apart and a scrub, each followed by a
  // 1-6 s refill at the same generations. Before, that read as six stalls and stepped a healthy original down.
  const at = (t: number) => t * 1000;
  let watch = deliveryWatch(), position = 0, bytes = 0, last = 0;
  const hear = (t: number, state: string, jump = 0) => {
    if (state === 'playing') position += t - last;
    position += jump;
    bytes += 500_000 * (t - last);
    last = t;
    watch = heardDelivery(watch, { sessionId: 's1', sourceGeneration: 1, seekGeneration: 1, state, loadProgress: bytes, bufferAheadSeconds: 3, seekTarget: null, position, speed: 1 }, at(t));
  };
  for (let t = 0; t <= 31; t += 0.25) hear(t, 'playing');
  for (const start of [31.25, 33.5, 35.75, 38, 40.25]) {
    hear(start, 'buffering', 10);
    for (let t = start + 0.25; t < start + 1.5; t += 0.25) hear(t, 'buffering');
    for (let t = start + 1.5; t < start + 2.25; t += 0.25) hear(t, 'playing');
  }
  for (let t = 42.5; t < 66; t += 0.25) hear(t, 'playing');
  hear(66, 'buffering', 30);
  for (let t = 66.25; t <= 72; t += 0.25) hear(t, 'buffering');
  for (let t = 72.25; t <= 73; t += 0.25) hear(t, 'playing');
  expect(deliveryEvidence(watch).stalls).toBe(0);
  expect(stepDown(watch, plan(), at(73))).toBeNull();
  // A backward step is a seek too; the position held still through a wait is not.
  expect(heardDelivery(watch, { sessionId: 's1', sourceGeneration: 1, seekGeneration: 1, state: 'buffering', position: position - 10, speed: 1 }, at(73.25)).marks).toHaveLength(1);
  // A starved stream whose position moves only while it plays still steps down.
  watch = deliveryWatch(); position = 0; bytes = 0; last = 0;
  for (let t = 0; t <= 45; t += 0.25) hear(t, starved(t));
  expect(stepDown(watch, plan(), at(45))).toMatchObject({ pathId: 'quality-720p4000k' });
});
