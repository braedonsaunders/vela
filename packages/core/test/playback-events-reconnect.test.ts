import { expect, test } from 'bun:test';
import { Playback, initialPlayback, type PlaybackTarget } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import { VelaError } from '../src/adapter/errors';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { LiveEventRef, PlaybackPlan } from '../src/wire';
import { readEvents } from '../src/protocol/sse';
import { EtherAdapter } from '../src/adapter/ether';
import { FakeCredentials, restoreFetch } from './helpers';

type Connect = (emit: (event: unknown) => Promise<void>, attempt: number) => Promise<void>;

/**
 * An Ether-like server whose events stream behaves as `connect` says, under a deterministic
 * clock (no wall-clock sleeps). Media keeps playing on the player throughout unless a test says otherwise.
 */
async function harness(connect: Connect, target: PlaybackTarget = { kind: 'title', id: 'movie' }) {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalNow = Date.now;
  const timers = new Map<number, { at: number; fire: () => unknown }>();
  let sequence = 0, clock = 1_000_000;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { at: clock + ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  Date.now = () => clock;
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const restore = () => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = originalNow; };
  const starts: unknown[] = [], stops: string[] = [], cursors: string[] = [];
  let snapshotFailure: (() => Error) | null = null, snapshotWait = 0, snapshotHang = false, connections = 0;
  const plan = (id: string, extra: Partial<PlaybackPlan> = {}) => ({ sessionId: id, state: 'playing', positionSeconds: 0, audioTracks: [], subtitleTracks: [], sourceGeneration: 1, seekGeneration: 1, ...extra } as PlaybackPlan);
  const server: { plan: PlaybackPlan; cursor: number; liveEvent?: LiveEventRef } = { plan: plan('s1'), cursor: 1 };
  const adapter = {
    startPlayback: async (request: unknown) => { starts.push(request); return plan(`s${starts.length}`); },
    sessionSnapshot: async (id: string) => {
      if (snapshotHang && id === 's1') return new Promise(() => {});
      if (snapshotFailure && id === 's1') {
        const failure = snapshotFailure;
        if (snapshotWait) await new Promise(resolve => setTimeout(resolve, snapshotWait));
        throw failure();
      }
      if (id !== 's1') return { plan: plan(id), revision: 1, cursor: '1', publishedRanges: [] };
      return { plan: server.plan, revision: server.cursor, cursor: String(server.cursor), publishedRanges: [], ...(server.liveEvent ? { liveEvent: server.liveEvent } : {}) };
    },
    streamViewerEvents: async () => {},
    streamSession: async (id: string, cursor: string, emit: (event: unknown) => Promise<void>, signal?: AbortSignal) => {
      cursors.push(cursor);
      if (id !== 's1') return new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
      // Like Ether, only what follows the requested cursor is sent.
      return connect(async frame => { const { id: at } = frame as { id?: string }; if (!at || Number(at) > Number(cursor)) await emit(frame); }, ++connections);
    },
    reportObservation: async () => ({}),
    command: async (id: string, c: { kind: string }) => { if (c.kind === 'stop') stops.push(id); return plan(id); },
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
  const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  let position = 100;
  const media = { moving: true, paused: false };
  const play = () => playback.snapshot(media.paused
    ? { sessionId: 's1', live: null, position, state: 'paused' }
    : media.moving
    ? { sessionId: 's1', live: null, position: position += 1, state: 'playing' }
    : { sessionId: 's1', live: null, position, state: 'buffering' });
  /** Moves the clock `ms` on, firing what falls due on the way, with media advancing each second. */
  const advance = async (ms: number) => {
    const until = clock + ms;
    while (clock < until) {
      const next = Math.min(until, clock + 1000);
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= next).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        clock = Math.max(clock, due[1].at);
        timers.delete(due[0]);
        await due[1].fire();
        await settle();
      }
      clock = next;
      if (box.get().playback.sessionId === 's1' && box.get().playback.phase === 'playing') play();
      await settle();
    }
  };
  await playback.start(target);
  await settle();
  play();
  await settle();
  return {
    box, playback, media, starts, stops, cursors, server, advance, settle, restore, plan, timers,
    connections: () => connections,
    failSnapshots: (failure: (() => Error) | null, afterMs = 0) => { snapshotFailure = failure; snapshotWait = afterMs; },
    hangSnapshots: (hang: boolean) => { snapshotHang = hang; },
  };
}

const event = (type: string, revision: number, extra: object) =>
  ({ event: type, id: String(revision), data: JSON.stringify({ type, sessionId: 's1', revision, cursor: String(revision), ...extra }) });

test('a dropped events stream is followed again while the media plays: no restart, replayed plan applied', async () => {
  for (const drop of ['eof', 'reset']) {
    const h = await harness(async (emit, attempt) => {
      if (attempt === 1) {
        if (drop === 'reset') throw new TypeError('network connection was lost');
        return;
      }
      // The server replays what the viewer missed: a failover's new plan.
      await emit(event('plan', 2, { plan: { sessionId: 's1', state: 'playing', positionSeconds: 0, audioTracks: [], subtitleTracks: [], sourceGeneration: 2, seekGeneration: 1 } }));
      await new Promise(() => {});
    });
    try {
      expect(h.connections()).toBe(1);
      await h.advance(1000);
      expect(h.connections()).toBe(2);
      expect(h.box.get().playback.phase).toBe('playing');
      expect(h.box.get().playback.plan?.sourceGeneration).toBe(2);
      await h.advance(10_000);
      expect(h.starts).toHaveLength(1);
      expect(h.stops).toEqual([]);
      await h.playback.stop();
    } finally { h.restore(); }
  }
});

test('a ten second outage is bridged with backoff, then the stream is followed again', async () => {
  const h = await harness(async (_emit, attempt) => {
    if (attempt === 1) return;
    await new Promise(() => {});
  });
  try {
    h.failSnapshots(() => new TypeError('network is unreachable'));
    await h.advance(10_000);
    // Attempts at 1, 3 and 7 s found no network; the session is still the same one.
    expect(h.box.get().playback.phase).toBe('playing');
    expect(h.box.get().playback.sessionId).toBe('s1');
    h.failSnapshots(null);
    await h.advance(2000);
    expect(h.connections()).toBe(2);
    await h.advance(30_000);
    expect(h.starts).toHaveLength(1);
    expect(h.stops).toEqual([]);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('a stream that keeps ending at once runs out of attempts and recovers', async () => {
  const h = await harness(async () => {});
  try {
    await h.advance(14_000);
    expect(h.box.get().playback.phase).toBe('playing');
    expect(h.starts).toHaveLength(1);
    await h.advance(1000);
    // Five reconnections (1, 2, 4, 4, 4 s apart) each ended at once: the session is restarted.
    expect(h.connections()).toBe(6);
    expect(h.box.get().playback.phase).toBe('preparing');
    await h.advance(2000);
    expect(h.starts).toHaveLength(2);
    expect(h.stops).toEqual(['s1']);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('a connection that stayed up starts its backoff over', async () => {
  let drops = 0;
  const h = await harness(async emit => {
    drops++;
    // Every connection delivers an event and holds for a minute, then the network drops it.
    await emit(event('plan', 2, { plan: { sessionId: 's1', state: 'playing', positionSeconds: 0, audioTracks: [], subtitleTracks: [], sourceGeneration: 1, seekGeneration: 1 } }));
    await new Promise<void>(resolve => setTimeout(resolve, 60_000));
  });
  try {
    await h.advance(10 * 61_000);
    expect(drops).toBeGreaterThan(8);
    expect(h.starts).toHaveLength(1);
    expect(h.stops).toEqual([]);
    await h.playback.stop();
  } finally { h.restore(); }
});

const refusal = (status: number) => () => new VelaError({ class: 'not-found', code: 'session_not_found', message: 'answer', retry: { allowed: false } }, status);
const planFrame = (revision: number, extra: Partial<PlaybackPlan> = {}) =>
  event('plan', revision, { plan: { sessionId: 's1', state: 'playing', positionSeconds: 0, audioTracks: [], subtitleTracks: [], sourceGeneration: 1, seekGeneration: 1, ...extra } });

test('a server refusal recovers at once; a server briefly unavailable is followed again', async () => {
  for (const [status, recovers] of [[404, true], [410, true], [401, true], [500, false], [408, false], [429, false]] as const) {
    const h = await harness(async (_emit, attempt) => { if (attempt > 1) await new Promise(() => {}); });
    try {
      h.failSnapshots(refusal(status));
      // The first reconnection (1 s) reads the answer; a restart follows its own 1 s backoff.
      await h.advance(2500);
      expect([status, h.starts.length]).toEqual([status, recovers ? 2 : 1]);
      expect(h.stops).toEqual(recovers ? ['s1'] : []);
      if (!recovers) {
        h.failSnapshots(null);
        await h.advance(5000);
        expect([status, h.connections(), h.starts.length]).toEqual([status, 2, 1]);
      }
      expect(h.connections()).toBe(recovers ? 1 : 2);
      await h.playback.stop();
    } finally { h.restore(); }
  }
});

test('an end in the first frame after a reconnection whose snapshot had the session takes the end path', async () => {
  const h = await harness(async (emit, attempt) => {
    if (attempt === 1) return;
    // The snapshot read first still had the session; the stream it opened then says ended.
    await emit(event('ended', 2, { reason: 'finished' }));
  });
  try {
    await h.advance(3000);
    expect(h.connections()).toBe(2);
    expect(h.box.get().playback.phase).toBe('ended');
    expect(h.starts).toHaveLength(1);
    expect(h.stops).toEqual([]);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('a server stop long after a reconnection on a quiet stream ends a title and fails a live channel', async () => {
  for (const target of [{ kind: 'title', id: 'movie' }, { kind: 'channel', id: 'fox' }] as PlaybackTarget[]) {
    let stop: (() => void) | undefined;
    const h = await harness(async (emit, attempt) => {
      if (attempt === 1) return;
      // Only heartbeats and live-event updates follow the reconnection, then the server stops the session.
      await emit({ event: 'liveEvent', data: JSON.stringify({ liveEvent: null }) });
      await new Promise<void>(resolve => { stop = resolve; });
      await emit(event('ended', 2, { reason: 'stopped' }));
      await new Promise(() => {});
    }, target);
    try {
      await h.advance(1000);
      expect(h.connections()).toBe(2);
      await h.advance(60_000);
      expect(h.box.get().playback.phase).toBe('playing');
      stop!();
      await h.settle();
      expect(h.box.get().playback.phase).toBe(target.kind === 'title' ? 'ended' : 'failed');
      await h.advance(20_000);
      expect(h.starts).toHaveLength(1);
      expect(h.stops).toEqual([]);
      expect(h.box.get().playback.phase).toBe(target.kind === 'title' ? 'ended' : 'failed');
      await h.playback.stop();
    } finally { h.restore(); }
  }
});

test('a later end on a reconnected stream, and an end the player reported during the wait, both finish', async () => {
  const later = await harness(async (emit, attempt) => {
    if (attempt === 1) return;
    await emit(planFrame(2));
    await new Promise(resolve => setTimeout(resolve, 5000));
    await emit(event('ended', 3, { reason: 'finished' }));
  });
  try {
    await later.advance(8000);
    expect(later.box.get().playback.phase).toBe('ended');
    expect(later.starts).toHaveLength(1);
    expect(later.stops).toEqual([]);
  } finally { later.restore(); }
  const reported = await harness(async () => {});
  try {
    await reported.playback.observe('s1', { state: 'ended', positionSeconds: 5400 } as never);
    reported.server.plan = reported.plan('s1', { state: 'ended' });
    await reported.advance(3000);
    expect(reported.box.get().playback.phase).toBe('ended');
    expect(reported.starts).toHaveLength(1);
    expect(reported.stops).toEqual([]);
  } finally { reported.restore(); }
});

test('time spent reading snapshots that fail does not count as a connection that held', async () => {
  const h = await harness(async () => {});
  try {
    // Each snapshot would take 31 s to fail. The media plays on, so the stall watchdog does not step in.
    h.failSnapshots(() => new TypeError('network connection timed out'), 31_000);
    // Five reconnections (1, 2, 4, 4 and 4 s apart), each given up after 10 s: the session is restarted.
    await h.advance(60_000);
    expect(h.starts).toHaveLength(1);
    await h.advance(10_000);
    expect(h.connections()).toBe(1);
    expect(h.starts).toHaveLength(2);
    expect(h.stops).toEqual(['s1']);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('the attempts start over after a connection held 30 s from its first event, not after 29 s', async () => {
  for (const [held, over] of [[29_000, false], [30_000, true]] as const) {
    const h = await harness(async (emit, attempt) => {
      if (attempt < 6) return;
      if (attempt > 6) await new Promise(() => {});
      await emit(planFrame(2));
      await new Promise(resolve => setTimeout(resolve, held));
    });
    try {
      // Five reconnections that end at once (1 + 2 + 4 + 4 + 4 s), then one that holds.
      await h.advance(15_000 + held + 1500);
      expect([held, h.starts.length]).toEqual([held, over ? 1 : 2]);
      expect(h.connections()).toBe(over ? 7 : 6);
      await h.playback.stop();
    } finally { h.restore(); }
  }
});

test('a reconnection follows from the fresh snapshot, so an older replayed event is not shown again', async () => {
  const log = [
    { event: 'liveEvent', id: '11', data: JSON.stringify({ liveEvent: { id: 'game-a', feed: 'sports' } }) },
    { event: 'liveEvent', id: '12', data: JSON.stringify({ liveEvent: { id: 'game-b', feed: 'sports' } }) },
  ];
  const h = await harness(async (emit, attempt) => {
    if (attempt === 1) {
      await emit(planFrame(10));
      return;
    }
    for (const frame of log) await emit(frame);
    await new Promise(() => {});
  });
  try {
    h.server.cursor = 12;
    h.server.liveEvent = { id: 'game-b', feed: 'sports' };
    const seen: (string | undefined)[] = [];
    h.box.subscribe(() => { const id = h.box.get().playback.liveEvent?.id; if (seen.at(-1) !== id) seen.push(id); });
    await h.advance(1500);
    expect(h.cursors).toEqual(['1', '12']);
    expect(seen).toEqual(['game-b']);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('a stream event that cannot be handled releases the connection it came on', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('event: plan\ndata: {\n\n')); },
    cancel() { cancelled = true; },
  });
  await expect(readEvents(new Response(body), event => { JSON.parse(event.data); })).rejects.toThrow();
  expect(cancelled).toBe(true);
});

test('a reconnection whose snapshot read never answers counts as failed, so a paused film is recovered', async () => {
  const h = await harness(async () => {});
  try {
    // Paused: no media is read, so the stall watchdog does not step in.
    h.media.paused = true;
    h.hangSnapshots(true);
    // Five reconnections (1, 2, 4, 4 and 4 s apart), each given up after 10 s.
    await h.advance(60_000);
    expect(h.starts).toHaveLength(1);
    expect(h.box.get().playback.sessionId).toBe('s1');
    await h.advance(10_000);
    expect(h.connections()).toBe(1);
    expect(h.starts).toHaveLength(2);
    expect(h.stops).toEqual(['s1']);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('a stream event that cannot be handled ends the request it came on, not only its reader', async () => {
  let request: AbortSignal | undefined, response: Response | undefined;
  globalThis.fetch = Object.assign(async (_input: unknown, init?: RequestInit) => {
    request = init?.signal ?? undefined;
    response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('event: plan\ndata: {\n\n')); },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
    return response;
  }, { preconnect: () => {} }) as typeof fetch;
  try {
    const watch = new AbortController();
    const api = new EtherAdapter('https://ether.example', new FakeCredentials(), '');
    await expect(api.streamSession('s1', '1', event => { JSON.parse(event.data); }, watch.signal)).rejects.toThrow();
    expect(request?.aborted).toBe(true);
    expect(response?.body?.locked).toBe(false);
    expect(watch.signal.aborted).toBe(false);
  } finally { restoreFetch(); }
});

test('a server error event on the stream recovers at once, as before', async () => {
  const h = await harness(async emit => {
    await emit(event('error', 2, { error: { class: 'playback', code: 'session_failed', message: 'failed', retry: { allowed: false } } }));
  });
  try {
    expect(h.box.get().playback.phase).toBe('preparing');
    await h.advance(1000);
    expect(h.connections()).toBe(1);
    expect(h.starts).toHaveLength(2);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('an explicit end follows the end path: a title finishes, a live channel keeps its failed phase', async () => {
  for (const target of [{ kind: 'title', id: 'movie' }, { kind: 'channel', id: 'fox' }] as PlaybackTarget[]) {
    const h = await harness(async emit => { await emit(event('ended', 2, { reason: 'finished' })); }, target);
    try {
      expect(h.box.get().playback.phase).toBe(target.kind === 'title' ? 'ended' : 'failed');
      await h.advance(20_000);
      expect(h.connections()).toBe(1);
      expect(h.starts).toHaveLength(1);
      expect(h.box.get().playback.phase).toBe(target.kind === 'title' ? 'ended' : 'failed');
      await h.playback.stop();
    } finally { h.restore(); }
  }
});

test('a session the server ended while the stream was down, unseen by the player, is recovered', async () => {
  const h = await harness(async () => {});
  try {
    // Ether ended it during the outage (its disconnect grace ran out); the player never reached the end.
    h.server.plan = h.plan('s1', { state: 'ended' });
    await h.advance(3000);
    expect(h.starts).toHaveLength(2);
    expect(h.stops).toEqual(['s1']);
    expect(h.box.get().playback.sessionId).toBe('s2');
    await h.playback.stop();
  } finally { h.restore(); }
});

test('media that stalls during the outage still recovers', async () => {
  const h = await harness(async () => {});
  try {
    h.failSnapshots(() => new TypeError('network is unreachable'));
    // The player stops moving: buffering at the same position.
    h.media.moving = false;
    await h.advance(12_000);
    expect(h.starts).toHaveLength(2);
    expect(h.stops).toEqual(['s1']);
    await h.playback.stop();
    expect(h.timers.size).toBe(0);
  } finally { h.restore(); }
});

test('Stop during the backoff ends the watch with nothing left behind', async () => {
  const h = await harness(async () => {});
  try {
    await h.advance(500);
    await h.playback.stop();
    expect(h.stops).toEqual(['s1']);
    await h.advance(20_000);
    expect(h.connections()).toBe(1);
    expect(h.starts).toHaveLength(1);
    expect(h.timers.size).toBe(0);
  } finally { h.restore(); }
});
