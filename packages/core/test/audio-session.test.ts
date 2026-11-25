import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Audio, initialAudio, type AudioEngine, type AudioEngineEvent } from '../src/store/audio';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { Card } from '../src/models';
import type { PlaybackPlan } from '../src/wire';
import { VelaError } from '../src/adapter/errors';

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

/** Ether's answer while it is still preparing a start: retry allowed, after a second. */
const preparing = () => new VelaError({ class: 'transient', code: 'preparation_pending', message: 'Playback is being prepared', retry: { allowed: true, afterSeconds: 1 } }, 503, '1');

/**
 * `eagerPause`: the engine says 'paused' on every pause, at once, as the web's engines do.
 * `answer`: what the server says to the nth start (1-based) instead of a new session: an error it
 * throws, or the id of an earlier session it hands back.
 */
function harness({ eagerPause = false, answer }: { eagerPause?: boolean; answer?: (n: number) => Error | string | undefined } = {}) {
  const starts: string[] = [], stops: string[] = [], loads: string[] = [];
  const lost = new Set<string>();
  const plan = (id: string, titleId: string): PlaybackPlan => ({
    sessionId: id, revision: 1, sourceGeneration: 1, seekGeneration: 1, titleId, state: 'ready', media: 'audio', positionSeconds: 0, durationSeconds: 200,
    paths: [{ id: 'direct', kind: 'direct', transport: 'file', url: `/media/${id}`, mimeType: 'audio/flac', readiness: 'ready', qualities: [], boundaries: [] }],
    selectedPathId: 'direct', audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null,
  } as unknown as PlaybackPlan);
  const adapter = {
    startPlayback: async (request: { titleId: string }) => {
      starts.push(request.titleId);
      const scripted = answer?.(starts.length);
      if (scripted instanceof Error) throw scripted;
      return plan(scripted ?? `s${starts.length}`, request.titleId);
    },
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
    pause() { if (!playing && !eagerPause) return; playing = false; for (const l of listeners) l('paused'); },
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
  return { audio, box, playback, starts, stops, loads, lost, play, end, isPlaying: () => playing, position: () => position };
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

test('a film starting over paused music leaves the music paused, with an engine that reports its pause at once', async () => {
  const h = harness({ eagerPause: true });
  h.audio.play({ items: [track('t1')], index: 0 });
  await settle();
  await h.play(2);
  h.audio.pause();
  // Another title takes the playback session: the audio store lets go of its own.
  await h.playback.start({ kind: 'title', id: 'film' });
  await settle();
  expect(h.starts).toEqual(['t1', 'film']);
  expect(h.box.get().playback.sessionId).toBe('s2');
  expect(h.box.get().audio.phase).toBe('paused');
  expect(h.isPlaying()).toBe(false);
});

test('a track whose first start is refused as still preparing plays once the retry answers', async () => {
  const h = harness({ answer: n => n === 1 ? preparing() : undefined });
  h.audio.play({ items: [track('t1')], index: 0 });
  await settle();
  // The server allowed a retry: the item waits for it, it has not failed.
  expect(h.box.get().audio.phase).toBe('loading');
  await advance(1000);
  expect(h.starts).toEqual(['t1', 't1']);
  expect(h.loads).toEqual(['/media/s2']);
  expect(h.isPlaying()).toBe(true);
  expect(h.box.get().audio.phase).toBe('playing');
  await h.play(30);
  // Playing on: the stall watchdog has nothing to recover.
  expect(h.starts).toEqual(['t1', 't1']);
  expect(h.stops).toEqual([]);
});

test('a pause while a refused start waits for its retry holds the item paused once it arrives', async () => {
  const h = harness({ answer: n => n === 1 ? preparing() : undefined });
  h.audio.play({ items: [track('t1')], index: 0 });
  await settle();
  h.audio.pause();
  await advance(1000);
  expect(h.loads).toEqual(['/media/s2']);
  expect(h.isPlaying()).toBe(false);
  expect(h.box.get().audio.phase).toBe('paused');
  h.audio.resume();
  expect(h.isPlaying()).toBe(true);
});

test('a start refused until the server stops allowing retries fails the item', async () => {
  const h = harness({ answer: () => preparing() });
  h.audio.play({ items: [track('t1')], index: 0 });
  await settle();
  await advance(60_000);
  expect(h.starts).toEqual(['t1', 't1', 't1']);
  expect(h.loads).toEqual([]);
  expect(h.box.get().audio.phase).toBe('failed');
});

test('a recovery the server answers with the session just stopped asks once more afresh, then plays', async () => {
  // s1 stalls; the recovery's first start is answered with s1 again (stopped, though it says ready).
  const h = harness({ answer: n => n === 2 ? 's1' : undefined });
  h.audio.play({ items: [track('t1')], index: 0 });
  await settle();
  await h.play(2);
  h.lost.add('s1');
  // The follow fails at the next five-second read; the recovery asks a second later.
  await h.play(7);
  expect(h.stops).toEqual(['s1']);
  expect(h.starts).toEqual(['t1', 't1', 't1']);
  expect(h.loads).toEqual(['/media/s1', '/media/s3']);
  expect(h.box.get().playback.sessionId).toBe('s3');
  expect(h.isPlaying()).toBe(true);
  await h.play(30);
  expect(h.starts).toEqual(['t1', 't1', 't1']);
});

test('a recovery answered twice with the stopped session fails the item instead of playing it', async () => {
  const h = harness({ answer: n => n >= 2 ? 's1' : undefined });
  h.audio.play({ items: [track('t1')], index: 0 });
  await settle();
  await h.play(2);
  h.lost.add('s1');
  await advance(60_000);
  // One fresh attempt after the stopped session came back, then the error: no endless loop.
  expect(h.starts).toEqual(['t1', 't1', 't1']);
  expect(h.loads).toEqual(['/media/s1']);
  expect(h.box.get().playback.phase).toBe('failed');
  expect(h.box.get().playback.sessionId).toBe('');
  expect(h.box.get().audio.phase).toBe('failed');
  expect(h.isPlaying()).toBe(false);
});
