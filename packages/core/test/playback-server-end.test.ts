import { expect, test } from 'bun:test';
import { Playback, initialPlayback, type PlaybackTarget } from '../src/store/playback';
import { serverEnd } from '../src/store/server-end';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';

const channel: PlaybackTarget = { kind: 'channel', id: 'news' };
const title: PlaybackTarget = { kind: 'title', id: 'film' };

test('a live session the server ends under the viewer stopped; anything with an end finished', () => {
  expect(serverEnd(channel, false)).toBe('stopped');
  expect(serverEnd({ kind: 'library-live', id: 'stream', libraryId: 'sports' }, false)).toBe('stopped');
  expect(serverEnd(title, false)).toBe('finished');
  expect(serverEnd({ kind: 'extra', id: 'trailer' }, false)).toBe('finished');
  expect(serverEnd({ kind: 'programme', id: 'p', channelId: 'news' }, false)).toBe('finished');
  // The player itself reached the end (a live stream that really ended).
  expect(serverEnd(channel, true)).toBe('finished');
  expect(serverEnd(null, false)).toBe('finished');
});

/** A Playback over a fake polling server on a fake clock; `end` makes the server report a session ended. */
async function withServer(run: (h: { playback: Playback; box: StateBox<VelaState>; end: (id: string) => void; started: string[]; stops: string[]; advance: (ms: number) => Promise<void> }) => Promise<void>) {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalNow = Date.now, warn = console.warn;
  const timers = new Map<number, { at: number; fire: () => unknown }>();
  let sequence = 0, clock = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { at: clock + ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  Date.now = () => clock;
  console.warn = () => {};
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const advance = async (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); clock = due[1].at; await due[1].fire(); await settle();
    }
    clock = end;
    await settle();
  };
  try {
    const started: string[] = [], stops: string[] = [], ended = new Set<string>();
    let sessions = 0;
    let target: PlaybackTarget = channel;
    const plan = (id: string) => ({ sessionId: id, revision: ended.has(id) ? 2 : 1, state: ended.has(id) ? 'ended' : 'playing',
      ...(target.kind === 'channel' ? { channelId: target.id, live: {} } : { titleId: target.id, durationSeconds: 600 }),
      positionSeconds: 0, audioTracks: [], subtitleTracks: [], paths: [], sourceGeneration: 1, seekGeneration: 1 } as unknown as PlaybackPlan);
    const adapter = {
      startPlayback: async (request: { titleId?: string }) => { target = request.titleId ? title : channel; const id = `s${++sessions}`; started.push(id); return plan(id); },
      sessionSnapshot: async (id: string) => ({ plan: plan(id) }),
      command: async (id: string, c: { kind: string }) => { if (c.kind === 'stop') stops.push(id); return plan(id); },
      reportObservation: async () => ({ ok: true }),
      detail: async () => ({ title: {} }),
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    await run({ playback, box, end: id => ended.add(id), started, stops, advance });
  } finally {
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = originalNow; console.warn = warn;
  }
}

test('a live channel the server stops shows the channel error, and Try again tunes afresh', async () => {
  await withServer(async ({ playback, box, end, started, stops, advance }) => {
    await playback.start(channel);
    await advance(1000);
    expect(box.get().playback.phase).toBe('playing');
    // Ether marked the session recovering, then stopped it.
    end('s1');
    await advance(6000);
    const state = box.get().playback;
    expect(state.phase).toBe('failed');
    expect(state.plan).toBeNull();
    expect(state.target).toEqual(channel);
    expect(state.retryAfterSeconds).toBe(0);
    // Nothing is restarted behind the error, and the stopped session is not stopped again.
    await advance(30000);
    expect(started).toEqual(['s1']);
    expect(stops).toEqual([]);
    // Try again: a fresh tune.
    await playback.start(channel);
    expect(started).toEqual(['s1', 's2']);
    expect(box.get().playback.phase).toBe('playing');
    await playback.stop();
  });
});

test('a live session found ended when the player re-reads it also shows the error', async () => {
  await withServer(async ({ playback, box, end, started }) => {
    await playback.start(channel);
    end('s1');
    expect(await playback.refresh('s1')).toBe(true);
    expect(box.get().playback.phase).toBe('failed');
    expect(started).toEqual(['s1']);
  });
});

test('a title the server ends is finished, and a live stream the player played to its end is too', async () => {
  await withServer(async ({ playback, box, end, advance }) => {
    await playback.start(title);
    end('s1');
    await advance(6000);
    expect(box.get().playback.phase).toBe('ended');
  });
  await withServer(async ({ playback, box, end, advance }) => {
    await playback.start(channel);
    await playback.observe('s1', { idempotencyKey: 'o', sourceGeneration: 1, seekGeneration: 1, sequence: 1, observedAt: '', positionSeconds: 30,
      state: 'ended', playableRanges: [], selectedPathId: 'primary' });
    end('s1');
    await advance(6000);
    expect(box.get().playback.phase).toBe('ended');
  });
});

