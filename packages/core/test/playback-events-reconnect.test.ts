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

type Connect = (emit: (event: unknown) => Promise<void>, attempt: number, heartbeat: () => void) => Promise<void>;
/** Takes over the stream request numbered `request` (1 is the first) when it returns a promise. */
type Request = (request: number, signal: AbortSignal | undefined, activity: (() => void) | undefined) => Promise<void> | undefined;

/**
 * An Ether-like server whose events stream behaves as `connect` says, under a deterministic
 * clock (no wall-clock sleeps). Media keeps playing on the player throughout unless a test says otherwise.
 */
async function harness(connect: Connect, target: PlaybackTarget = { kind: 'title', id: 'movie' }, first: Request | null = null) {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalNow = Date.now;
  const timers = new Map<number, { at: number; fire: () => unknown }>();
  let sequence = 0, clock = 1_000_000;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { at: clock + ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  Date.now = () => clock;
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const restore = () => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = originalNow; };
  const starts: unknown[] = [], stops: string[] = [], cursors: string[] = [];
  let snapshotFailure: (() => Error) | null = null, snapshotWait = 0, snapshotHang = false, streamHang = false, connections = 0;
  let request: Request | null = first, held: (() => void)[] | null = null, answer: ((id: string) => PlaybackPlan) | null = null;
  const snapshotSignals: (AbortSignal | undefined)[] = [];
  const plan = (id: string, extra: Partial<PlaybackPlan> = {}) => ({ sessionId: id, state: 'playing', positionSeconds: 0, audioTracks: [], subtitleTracks: [], sourceGeneration: 1, seekGeneration: 1, ...extra } as PlaybackPlan);
  const server: { plan: PlaybackPlan; cursor: number; liveEvent?: LiveEventRef } = { plan: plan('s1'), cursor: 1 };
  const adapter = {
    startPlayback: async (request: unknown) => { starts.push(request); return plan(`s${starts.length}`); },
    sessionSnapshot: async (id: string, signal?: AbortSignal) => {
      if (id === 's1') snapshotSignals.push(signal);
      if (snapshotHang && id === 's1') return new Promise(() => {});
      if (held && id === 's1') {
        // Answered later with what the server held when it was asked.
        const answer = { plan: server.plan, revision: server.cursor, cursor: String(server.cursor), publishedRanges: [] };
        return new Promise(resolve => held!.push(() => resolve(answer)));
      }
      if (snapshotFailure && id === 's1') {
        const failure = snapshotFailure;
        if (snapshotWait) await new Promise(resolve => setTimeout(resolve, snapshotWait));
        throw failure();
      }
      if (id !== 's1') return { plan: plan(id), revision: 1, cursor: '1', publishedRanges: [] };
      return { plan: server.plan, revision: server.cursor, cursor: String(server.cursor), publishedRanges: [], ...(server.liveEvent ? { liveEvent: server.liveEvent } : {}) };
    },
    streamViewerEvents: async () => {},
    streamSession: async (id: string, cursor: string, emit: (event: unknown) => Promise<void>, signal?: AbortSignal, activity?: () => void) => {
      cursors.push(cursor);
      const own = request?.(cursors.length, signal, activity);
      if (own) return own;
      // A stream request that never answers: no response, no bytes.
      if (id !== 's1' || streamHang) return new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
      // The stream opened; every frame and heartbeat comment is activity on it.
      activity?.();
      // Like Ether, only what follows the requested cursor is sent.
      return connect(async frame => { activity?.(); const { id: at } = frame as { id?: string }; if (!at || Number(at) > Number(cursor)) await emit(frame); }, ++connections, () => activity?.());
    },
    reportObservation: async () => ({}),
    command: async (id: string, c: { kind: string }) => { if (c.kind === 'stop') stops.push(id); return answer?.(id) ?? plan(id); },
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
    box, playback, media, starts, stops, cursors, server, advance, settle, restore, plan, timers, snapshotSignals,
    connections: () => connections,
    failSnapshots: (failure: (() => Error) | null, afterMs = 0) => { snapshotFailure = failure; snapshotWait = afterMs; },
    hangSnapshots: (hang: boolean) => { snapshotHang = hang; },
    hangStreams: (hang: boolean) => { streamHang = hang; },
    requests: (take: Request) => { request = take; },
    /** Snapshot reads wait until `release` answers them, each with the state it was asked in. */
    holdSnapshots: () => { held = []; return () => { const waiting = held ?? []; held = null; for (const release of waiting) release(); }; },
    answerCommands: (take: (id: string) => PlaybackPlan) => { answer = take; },
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

test('the attempts start over after a connection held 30 s from opening, not after 29 s', async () => {
  for (const [held, over] of [[29_000, false], [30_000, true]] as const) {
    const h = await harness(async (emit, attempt) => {
      if (attempt < 6) return;
      if (attempt > 6) await new Promise(() => {});
      // No plan event: only the stream's opening starts the clock.
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

test('a reconnection whose stream request never answers counts as failed, so a paused film is recovered', async () => {
  const h = await harness(async () => {});
  try {
    // Paused: no media is read, so the stall watchdog does not step in.
    h.media.paused = true;
    // The snapshot answers; the events request that follows it never does.
    h.hangStreams(true);
    // Five reconnections (1, 2, 4, 4 and 4 s apart), each given up 10 s after it started.
    await h.advance(60_000);
    expect(h.starts).toHaveLength(1);
    expect(h.box.get().playback.sessionId).toBe('s1');
    await h.advance(10_000);
    expect(h.cursors.slice(0, 6)).toEqual(['1', '1', '1', '1', '1', '1']);
    expect(h.starts).toHaveLength(2);
    expect(h.stops).toEqual(['s1']);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('a quiet stream open for 31 s with only heartbeats starts its backoff over', async () => {
  let drops = 0;
  const h = await harness(async (_emit, _attempt, heartbeat) => {
    drops++;
    // No plan event: a heartbeat comment every 5 s, then the network drops the connection after 31 s.
    for (let at = 5000; at <= 30_000; at += 5000) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      heartbeat();
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  });
  try {
    await h.advance(10 * 33_000);
    expect(drops).toBeGreaterThan(8);
    expect(h.starts).toHaveLength(1);
    expect(h.stops).toEqual([]);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('an open events stream reports activity for heartbeat comments, not only for events', async () => {
  let beats = 0;
  globalThis.fetch = Object.assign(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } }), { preconnect: () => {} }) as typeof fetch;
  try {
    const events: unknown[] = [];
    const api = new EtherAdapter('https://ether.example', new FakeCredentials(), '');
    await api.streamSession('s1', '1', event => { events.push(event); }, undefined, () => { beats++; });
    expect(events).toEqual([]);
    // Opened, then each heartbeat.
    expect(beats).toBeGreaterThanOrEqual(2);
  } finally { restoreFetch(); }
});

test('an attempt given up on that opens late does not cut short the next one', async () => {
  const h = await harness(async (_emit, attempt) => { if (attempt > 4) await new Promise(() => {}); });
  try {
    h.requests((request, signal, activity) => {
      // The fourth reconnection (at 11 s) never answers and is given up at 21 s; its request still opens 4.5 s later.
      if (request === 5) return new Promise<void>((_, reject) => signal?.addEventListener('abort', () => {
        setTimeout(() => activity?.(), 4500);
        reject(signal.reason);
      }, { once: true }));
      // The fifth (at 25 s) opens after 1.5 s and stays up.
      if (request === 6) return new Promise<void>(resolve => setTimeout(resolve, 1500)).then(() => { activity?.(); return new Promise<void>(() => {}); });
      return undefined;
    });
    await h.advance(60_000);
    expect(h.starts).toHaveLength(1);
    expect(h.stops).toEqual([]);
    expect(h.box.get().playback.phase).toBe('playing');
    expect(h.cursors).toHaveLength(6);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('the very first events request that never answers is given up on and retried, so a paused film is not left waiting', async () => {
  let first: AbortSignal | undefined;
  // The first snapshot answers; the first stream request's response headers never come.
  const h = await harness(async () => { await new Promise(() => {}); }, { kind: 'title', id: 'movie' }, (request, signal) => {
    if (request !== 1) return undefined;
    first = signal;
    return new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  try {
    h.media.paused = true;
    expect(h.cursors).toHaveLength(1);
    // Given up 10 s after it started, then followed again after the first 1 s backoff.
    await h.advance(12_000);
    expect(first?.aborted).toBe(true);
    expect(h.cursors).toHaveLength(2);
    expect(h.box.get().playback.phase).toBe('playing');
    await h.advance(60_000);
    expect(h.cursors).toHaveLength(2);
    expect(h.starts).toHaveLength(1);
    expect(h.stops).toEqual([]);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('a reconnection snapshot or replayed plan older than a seek accepted meanwhile is not shown over it', async () => {
  let replay: () => void = () => {}, own: () => void = () => {};
  const h = await harness(async (emit, attempt) => {
    if (attempt === 1) return;
    // Ether replays the plans after the snapshot's cursor: one from before the seek, then the seek's own.
    await new Promise<void>(resolve => { replay = resolve; });
    await emit(planFrame(2, { positionSeconds: 100 }));
    await new Promise<void>(resolve => { own = resolve; });
    await emit(planFrame(3, { positionSeconds: 1200, seekGeneration: 2 }));
    await new Promise(() => {});
  });
  try {
    // The stream dropped at once; the reconnection after 1 s reads a snapshot the server answers late, at generation 1.
    const release = h.holdSnapshots();
    await h.advance(1500);
    expect(h.connections()).toBe(1);
    h.answerCommands(id => h.plan(id, { positionSeconds: 1200, seekGeneration: 2 }));
    h.server.plan = h.plan('s1', { positionSeconds: 1200, seekGeneration: 2 });
    await h.playback.command('s1', { kind: 'seek', positionSeconds: 1200, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek' } as never);
    expect(h.box.get().playback.plan?.seekGeneration).toBe(2);
    // The old answer arrives; the stream it opens stays quiet.
    release();
    await h.settle();
    expect(h.connections()).toBe(2);
    expect(h.box.get().playback.plan?.seekGeneration).toBe(2);
    expect(h.box.get().playback.plan?.positionSeconds).toBe(1200);
    replay();
    await h.settle();
    expect(h.box.get().playback.plan?.seekGeneration).toBe(2);
    expect(h.box.get().playback.plan?.positionSeconds).toBe(1200);
    own();
    await h.settle();
    expect(h.box.get().playback.plan?.seekGeneration).toBe(2);
    expect(h.box.get().playback.plan?.positionSeconds).toBe(1200);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('completed reconnection delays leave no abort listeners on the watch', async () => {
  const listeners = new Map<EventTarget, number>();
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
    if (type === 'abort') listeners.set(this, (listeners.get(this) ?? 0) + 1);
    return (add as (...args: unknown[]) => void).call(this, type, ...rest);
  } as never;
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
    if (type === 'abort') listeners.set(this, (listeners.get(this) ?? 0) - 1);
    return (remove as (...args: unknown[]) => void).call(this, type, ...rest);
  } as never;
  try {
    // Four connections end at once; the fifth stays up.
    const h = await harness(async (_emit, attempt) => { if (attempt === 5) await new Promise(() => {}); });
    try {
      await h.advance(12_000);
      expect(h.connections()).toBe(5);
      const watch = (h.playback as unknown as { follow: AbortController }).follow.signal;
      // Only the open connection's own listener is left after the 1, 2, 4 and 4 s delays.
      expect(listeners.get(watch)).toBe(1);
      await h.playback.stop();
    } finally { h.restore(); }
  } finally {
    EventTarget.prototype.addEventListener = add;
    EventTarget.prototype.removeEventListener = remove;
  }
});

test('a reconnection snapshot read that never answers is ended with its attempt', async () => {
  const h = await harness(async () => {});
  try {
    h.hangSnapshots(true);
    // The reconnection after 1 s is given up 10 s later; its snapshot request ends with it.
    await h.advance(11_500);
    const reconnect = h.snapshotSignals[1];
    expect(reconnect).toBeDefined();
    expect(reconnect?.aborted).toBe(true);
    await h.playback.stop();
  } finally { h.restore(); }
});

test('the Ether session snapshot read is ended by its caller\'s signal', async () => {
  let request: AbortSignal | undefined, asked = false;
  globalThis.fetch = Object.assign(async (_input: unknown, init?: RequestInit) => {
    asked = true;
    request = init?.signal ?? undefined;
    return new Promise<Response>((_, reject) => request?.addEventListener('abort', () => reject(request?.reason), { once: true }));
  }, { preconnect: () => {} }) as typeof fetch;
  try {
    const attempt = new AbortController();
    const api = new EtherAdapter('https://ether.example', new FakeCredentials(), '');
    const read = (api.sessionSnapshot as (id: string, signal?: AbortSignal) => Promise<unknown>).call(api, 's1', attempt.signal);
    read.catch(() => {});
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(asked).toBe(true);
    attempt.abort();
    expect(request?.aborted).toBe(true);
  } finally { restoreFetch(); }
});
