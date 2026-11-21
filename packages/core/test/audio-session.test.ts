import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Audio, initialAudio, type AudioEngine, type AudioEngineEvent } from '../src/store/audio';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { Card } from '../src/models';
import type { PlaybackPlan } from '../src/wire';

// The audio queue drives an ordinary playback session, whose stall watchdog replaces a session
// whose player stops reporting progress. A paused, stopped or finished item is not stalled.

const timers = new Map<number, { at: number; fire: () => unknown }>();
let now = 0, sequence = 0;
const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalNow = Date.now;

beforeEach(() => {
  timers.clear(); now = 1_000_000; sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms = 0) => { const id = ++sequence; timers.set(id, { at: now + ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  Date.now = () => now;
});
afterEach(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = originalNow; });

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
/** Advance the clock, firing due timers in order. */
async function advance(ms: number): Promise<void> {
  const end = now + ms;
  for (;;) {
    const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]); now = due[1].at; await due[1].fire(); await settle();
  }
  now = end;
}

function harness() {
  const starts: string[] = [], stops: string[] = [], loads: string[] = [];
  const lost = new Set<string>();
  const plan = (id: string, titleId: string): PlaybackPlan => ({
    sessionId: id, revision: 1, sourceGeneration: 1, seekGeneration: 1, titleId, state: 'ready', media: 'audio', positionSeconds: 0, durationSeconds: 200,
    paths: [{ id: 'direct', kind: 'direct', transport: 'file', url: `/media/${id}`, mimeType: 'audio/flac', readiness: 'ready', qualities: [], boundaries: [] }],
    selectedPathId: 'direct', audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null,
  } as unknown as PlaybackPlan);
  const adapter = {
    startPlayback: async (request: { titleId: string }) => { starts.push(request.titleId); return plan(`s${starts.length}`, request.titleId); },
    // A session that never streams events is read again every five seconds.
    sessionSnapshot: async (id: string) => { if (lost.has(id)) throw new Error('session follow lost'); return { plan: plan(id, 'x') }; },
    command: async (id: string, command: { kind: string }) => { if (command.kind === 'stop') stops.push(id); return plan(id, 'x'); },
    reportObservation: async () => ({ ok: true }),
    detail: async (id: string) => ({ title: { id, watch: { positionSeconds: 0 } } }),
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
  const box = new StateBox({ playback: initialPlayback, audio: initialAudio, auth: { phase: 'signed-in' } } as unknown as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  const audio = new Audio(box, session as unknown as Session, playback, () => 0);
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  let position = 0, playing = false;
  const engine: AudioEngine = {
    load(url, start) { loads.push(url); position = start; },
    play() { playing = true; for (const l of listeners) l('playing'); },
    pause() { if (!playing) return; playing = false; for (const l of listeners) l('paused'); },
    seek(seconds) { position = seconds; },
    setRate() {},
    unload() { playing = false; },
    position: () => position,
    duration: () => 200,
    buffered: () => [],
    error: () => '',
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  audio.attach(engine);
  /** The engine plays on for `seconds`, reporting time four times a second. */
  const play = async (seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) {
      if (playing) { position += 0.25; for (const l of listeners) l('time'); }
      await advance(250);
    }
  };
  const end = () => { playing = false; for (const l of listeners) l('ended'); };
  return { audio, box, starts, stops, loads, lost, play, end, isPlaying: () => playing, position: () => position };
}

const track = (id: string) => ({ id, kind: 'episode', name: id, durationSeconds: 200 } as unknown as Card);

test('a paused track keeps its session and its place', async () => {
  const h = harness();
  h.audio.play({ items: [track('t1'), track('t2')], index: 0 });
  await settle();
  await h.play(4);
  expect(h.starts).toEqual(['t1']);
  h.audio.pause();
  await advance(60_000);
  expect(h.starts).toEqual(['t1']);
  expect(h.stops).toEqual([]);
  expect(h.box.get().audio.phase).toBe('paused');
  expect(h.box.get().audio.positionSeconds).toBe(4);
  h.audio.resume();
  expect(h.isPlaying()).toBe(true);
  await h.play(2);
  expect(h.starts).toEqual(['t1']);
});

test('stop and clear releases the session and nothing restarts it', async () => {
  const h = harness();
  h.audio.play({ items: [track('t1')], index: 0 });
  await settle();
  await h.play(3);
  await h.audio.stop();
  await settle();
  expect(h.stops).toEqual(['s1']);
  await advance(60_000);
  expect(h.starts).toEqual(['t1']);
  expect(h.box.get().audio.queue).toBeNull();
});

test('a pause while the plan loads holds the item paused', async () => {
  const h = harness();
  h.audio.play({ items: [track('t1')], index: 0 });
  h.audio.pause();
  await settle();
  expect(h.isPlaying()).toBe(false);
  await advance(60_000);
  expect(h.starts).toEqual(['t1']);
  h.audio.resume();
  expect(h.isPlaying()).toBe(true);
});

test('sleeping at the end of an item ends its session; resuming starts the next one', async () => {
  const h = harness();
  h.audio.play({ items: [track('t1'), track('t2')], index: 0 });
  await settle();
  h.audio.setSleep('item');
  await h.play(2);
  h.end();
  await settle();
  expect(h.stops).toEqual(['s1']);
  await advance(60_000);
  expect(h.starts).toEqual(['t1']);
  expect(h.box.get().audio.phase).toBe('paused');
  h.audio.resume();
  await settle();
  expect(h.starts).toEqual(['t1', 't2']);
});

test('a paused item whose session is recovered stays paused at its place on the new session', async () => {
  const h = harness();
  h.audio.play({ items: [track('t1')], index: 0 });
  await settle();
  await h.play(4);
  h.audio.pause();
  // The session can no longer be followed: playback replaces it.
  h.lost.add('s1');
  await advance(60_000);
  expect(h.starts).toEqual(['t1', 't1']);
  expect(h.stops).toEqual(['s1']);
  expect(h.loads).toEqual(['/media/s1', '/media/s2']);
  expect(h.isPlaying()).toBe(false);
  expect(h.position()).toBe(4);
  expect(h.box.get().audio.phase).toBe('paused');
  h.audio.resume();
  expect(h.isPlaying()).toBe(true);
  await h.play(2);
  expect(h.starts).toEqual(['t1', 't1']);
});
