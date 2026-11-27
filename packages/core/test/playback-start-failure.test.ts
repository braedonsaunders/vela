import { expect, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { Playback, initialPlayback } from '../src/store/playback';
import { finalRefusal, startRefusal, startRetry } from '../src/store/start-retry';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan, ProtocolError } from '../src/wire';

const refused = (retry: ProtocolError['retry'], status = 503, header: string | null = null) => new VelaError(
  { class: 'source', code: 'network', message: 'The connection to the Live TV provider failed.', retry }, status, header);

function harness(answers: (() => Promise<PlaybackPlan>)[]) {
  let requests = 0;
  const adapter = {
    startPlayback: () => (answers[Math.min(requests++, answers.length - 1)]!)(),
    sessionSnapshot: () => new Promise<never>(() => {}),
    command: async () => ({}) as PlaybackPlan,
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, client: {} };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  return { box, playback, requests: () => requests };
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test('a start the server refuses as final fails at once with its words, and is asked only once', async () => {
  const { box, playback, requests } = harness([async () => { throw refused({ allowed: false }); }]);
  await playback.start({ kind: 'channel', id: 'bbc-one' });
  const state = box.get().playback;
  expect(state.phase).toBe('failed');
  expect(state.error).toBe('The connection to the Live TV provider failed.');
  expect(state.errorClass).toBe('source');
  expect(state.retryAfterSeconds).toBe(0);
  expect(state.retryAttempt).toBe(0);
  await wait(30);
  expect(requests()).toBe(1);
  await playback.stop();
});

test('a refused first start is never taken over by recovery: no session, no endless backoff', async () => {
  const { box, playback, requests } = harness([async () => { throw refused({ allowed: false }); }]);
  await playback.start({ kind: 'channel', id: 'bbc-one' });
  // The engine or a stale view can report a failure for "no session" ('').
  playback.recover('');
  playback.recover(box.get().playback.sessionId);
  expect(box.get().playback.phase).toBe('failed');
  expect(box.get().playback.retryAfterSeconds).toBe(0);
  await wait(1200);
  expect(requests()).toBe(1);
  await playback.stop();
});

test('a retryable refusal is asked again on the server\'s terms, then ends in the failed state', async () => {
  const { box, playback, requests } = harness([async () => { throw refused({ allowed: true, afterSeconds: 1, maxAttempts: 2 }); }]);
  await playback.start({ kind: 'channel', id: 'bbc-one' });
  expect(box.get().playback.phase).toBe('failed');
  expect(box.get().playback.retryAfterSeconds).toBe(1);
  expect(box.get().playback.retryAttempt).toBe(1);
  await wait(1150);
  expect(requests()).toBe(2);
  expect(box.get().playback.phase).toBe('failed');
  expect(box.get().playback.retryAfterSeconds).toBe(0);
  expect(box.get().playback.error).toContain('Live TV provider');
  await playback.stop();
});

test('a retry that succeeds plays and clears the refusal', async () => {
  const plan = { sessionId: 's', sourceGeneration: 0, seekGeneration: 0, state: 'playing', channelId: 'c', audioTracks: [], subtitleTracks: [] } as unknown as PlaybackPlan;
  const { box, playback, requests } = harness([
    async () => { throw refused({ allowed: true, afterSeconds: 1, maxAttempts: 3 }); },
    async () => plan,
  ]);
  await playback.start({ kind: 'channel', id: 'c' });
  expect(box.get().playback.retryAfterSeconds).toBe(1);
  await wait(1150);
  expect(requests()).toBe(2);
  expect(box.get().playback.phase).toBe('playing');
  expect(box.get().playback.error).toBe('');
  expect(box.get().playback.retryAttempt).toBe(0);
  await playback.stop();
});

test('startRetry follows retry.allowed, afterSeconds, Retry-After and maxAttempts within bounds', () => {
  expect(startRetry(refused({ allowed: false, afterSeconds: 2 }), 0)).toBe(0);
  expect(startRetry(new Error('offline'), 0)).toBe(0);
  expect(startRetry(refused({ allowed: true, afterSeconds: 3 }), 0)).toBe(3);
  expect(startRetry(refused({ allowed: true }, 503, '7'), 0)).toBe(7);
  // Exponential floor between attempts.
  expect(startRetry(refused({ allowed: true, maxAttempts: 5 }), 2)).toBe(4);
  // Three attempts by default: two retries.
  expect(startRetry(refused({ allowed: true }), 1)).toBe(2);
  expect(startRetry(refused({ allowed: true }), 2)).toBe(0);
  expect(startRetry(refused({ allowed: true, maxAttempts: 1 }), 0)).toBe(0);
  // A server asking for more is capped at five attempts.
  expect(startRetry(refused({ allowed: true, maxAttempts: 50 }), 3)).toBeGreaterThan(0);
  expect(startRetry(refused({ allowed: true, maxAttempts: 50 }), 4)).toBe(0);
  // Not waited for behind a spinner beyond a minute.
  expect(startRetry(refused({ allowed: true, afterSeconds: 120 }), 0)).toBe(0);
});

const preparing = (message: string, retry: ProtocolError['retry'], header: string | null = null) =>
  new VelaError({ class: 'source', code: 'preparing', message, retry }, 503, header);

test('Ether still preparing a title is waited out on its own attempt count and waits, not ended as a failure', () => {
  // Its maxAttempts is honoured past the five a refusal gets: forty attempts, thirty-nine waits.
  expect(startRetry(preparing('Finding a source…', { allowed: true, afterSeconds: 30, maxAttempts: 40 }), 4)).toBe(30);
  expect(startRetry(preparing('Finding a source…', { allowed: true, afterSeconds: 30, maxAttempts: 40 }), 38)).toBe(30);
  expect(startRetry(preparing('Finding a source…', { allowed: true, afterSeconds: 30, maxAttempts: 40 }), 39)).toBe(0);
  // The server's wait, not a doubling backoff; a long one is waited a minute at a time, not final.
  expect(startRetry(preparing('Finding a source…', { allowed: true, afterSeconds: 2, maxAttempts: 40 }), 10)).toBe(2);
  expect(startRetry(preparing('Waiting for the download service…', { allowed: true, afterSeconds: 300, maxAttempts: 3 }), 0)).toBe(60);
  expect(startRetry(preparing('Finding a source…', { allowed: true, maxAttempts: 40 }, '12'), 0)).toBe(12);
  // Bounded however many the server allows, and never when it forbids asking again.
  expect(startRetry(preparing('Finding a source…', { allowed: true, afterSeconds: 1, maxAttempts: 10_000 }), 118)).toBe(1);
  expect(startRetry(preparing('Finding a source…', { allowed: true, afterSeconds: 1, maxAttempts: 10_000 }), 119)).toBe(0);
  expect(startRetry(preparing('Finding a source…', { allowed: false, afterSeconds: 5 }), 0)).toBe(0);
});

test('a title Ether is still preparing keeps waiting with each answer\'s message, then plays', async () => {
  const { box, playback, requests } = harness([
    async () => { throw preparing('Finding a source…', { allowed: true, afterSeconds: 1, maxAttempts: 40 }, '1'); },
    async () => { throw preparing('Waiting for the download service (queued at TorBox behind 3 active downloads)…', { allowed: true, afterSeconds: 1, maxAttempts: 40 }, '1'); },
    async () => { throw preparing('Waiting for the download service (queued at TorBox behind 2 active downloads)…', { allowed: true, afterSeconds: 1, maxAttempts: 40 }, '1'); },
    async () => { throw preparing('Waiting for the download service (queued at TorBox behind 1 active downloads)…', { allowed: true, afterSeconds: 1, maxAttempts: 40 }, '1'); },
    async () => { throw preparing('Waiting for the download service…', { allowed: true, afterSeconds: 1, maxAttempts: 40 }, '1'); },
    async () => titlePlan('s6'),
  ]);
  await playback.start({ kind: 'title', id: 'movie' });
  expect(box.get().playback).toMatchObject({ phase: 'failed', errorCode: 'preparing', retryAfterSeconds: 1, error: 'Finding a source…' });
  await wait(1100);
  expect(box.get().playback.error).toBe('Waiting for the download service (queued at TorBox behind 3 active downloads)…');
  // Past the five attempts a plain refusal gets, still waiting rather than failed.
  await wait(3300);
  expect(requests()).toBe(5);
  expect(box.get().playback).toMatchObject({ phase: 'failed', errorCode: 'preparing', retryAfterSeconds: 1, retryAttempt: 5 });
  await wait(1100);
  expect(requests()).toBe(6);
  expect(box.get().playback).toMatchObject({ phase: 'playing', sessionId: 's6', error: '', errorCode: '' });
  await playback.stop();
}, 10_000);

test('startRefusal carries the server\'s message and class, or a fallback', () => {
  expect(startRefusal(refused({ allowed: false }))).toEqual({ message: 'The connection to the Live TV provider failed.', code: 'network', errorClass: 'source' });
  expect(startRefusal(new Error('boom'), 'x')).toEqual({ message: 'boom', code: '', errorClass: '' });
  expect(startRefusal('weird', 'Playback failed').message).toBe('Playback failed');
});

// Ether's answer for a title with no source at all (frontends/vela: ErrNotAvailable), verbatim.
const notAvailable = () => new VelaError({ class: 'source', code: 'not_available', message: 'not available', retry: { allowed: false } }, 409, null);

test('Ether\'s terminal 409 not_available fails at once with its message after exactly one request', async () => {
  const { box, playback, requests } = harness([async () => { throw notAvailable(); }]);
  await playback.start({ kind: 'title', id: 'plugin-item' });
  expect(box.get().playback).toMatchObject({ phase: 'failed', error: 'not available', errorCode: 'not_available', errorClass: 'source', retryAfterSeconds: 0, retryAttempt: 0 });
  // Engine and stale view reports cannot turn a refused first start into a recovery.
  playback.recover('');
  playback.recover(box.get().playback.sessionId);
  await wait(1200);
  expect(requests()).toBe(1);
  expect(box.get().playback.phase).toBe('failed');
  await playback.stop();
});

/** Timers run by hand: `run(ms)` fires the pending timer of that delay and settles what follows. */
function manualTimers() {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { ms: number; fire: () => unknown }>();
  let sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  return {
    pending: (ms: number) => [...timers.values()].some(t => t.ms === ms),
    async run(ms: number) {
      const entry = [...timers].find(([, t]) => t.ms === ms);
      expect(entry).toBeDefined();
      timers.delete(entry![0]); await entry![1].fire(); await settle();
    },
    settle,
    restore() { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; },
  };
}

function recoveryHarness(refusal: () => unknown) {
  const requests: unknown[] = [];
  const plan = { sessionId: 's1', state: 'playing', positionSeconds: 0, audioTracks: [], subtitleTracks: [], sourceGeneration: 0, seekGeneration: 0 } as unknown as PlaybackPlan;
  const adapter = {
    startPlayback: async (request: unknown) => { requests.push(request); if (requests.length > 1) throw refusal(); return plan; },
    // The session is followed by snapshot reads that never answer: only recover() starts recovery here.
    sessionSnapshot: () => new Promise<never>(() => {}),
    command: async () => plan,
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
  const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  return { box, playback, requests };
}

test('a terminal refusal while recovering a session ends recovery in the failed state; it is not asked again', async () => {
  const clock = manualTimers();
  try {
    const { box, playback, requests } = recoveryHarness(notAvailable);
    await playback.start({ kind: 'title', id: 'movie' });
    expect(box.get().playback.phase).toBe('playing');
    // The engine lost the source: the session is recovered with a new start after a second.
    playback.recover('s1');
    expect(box.get().playback.phase).toBe('preparing');
    await clock.run(1000);
    expect(requests).toHaveLength(2);
    expect(box.get().playback).toMatchObject({ phase: 'failed', error: 'not available', errorClass: 'source', retryAfterSeconds: 0 });
    // No backoff left behind, and a late engine report for the old session starts nothing.
    expect(clock.pending(2000)).toBe(false);
    playback.recover('s1');
    playback.recover(box.get().playback.sessionId);
    await clock.settle();
    expect(clock.pending(1000)).toBe(false);
    expect(requests).toHaveLength(2);
    await playback.stop();
  } finally { clock.restore(); }
});

test('a server error while recovering keeps recovery\'s backoff: only a 4xx refusal is final', async () => {
  const clock = manualTimers();
  try {
    const { box, playback, requests } = recoveryHarness(() => new VelaError({ class: 'transient', code: 'service_unavailable', message: 'service unavailable', retry: { allowed: false } }, 503));
    await playback.start({ kind: 'title', id: 'movie' });
    playback.recover('s1');
    await clock.run(1000);
    await clock.run(2000);
    await clock.run(4000);
    expect(requests).toHaveLength(4);
    expect(box.get().playback.phase).toBe('preparing');
    await playback.stop();
  } finally { clock.restore(); }
});

test('finalRefusal: a 4xx the server does not allow retrying, never a network failure, 5xx, 408 or 429', () => {
  const error = (status: number, allowed = false) => new VelaError({ class: 'source', code: 'x', message: 'x', retry: { allowed } }, status);
  expect(finalRefusal(notAvailable())).toBe(true);
  expect(finalRefusal(error(404))).toBe(true);
  expect(finalRefusal(error(403))).toBe(true);
  expect(finalRefusal(error(409, true))).toBe(false);
  expect(finalRefusal(error(502))).toBe(false);
  expect(finalRefusal(error(503))).toBe(false);
  expect(finalRefusal(error(408))).toBe(false);
  expect(finalRefusal(error(429))).toBe(false);
  expect(finalRefusal(new Error('connection refused'))).toBe(false);
});

const titlePlan = (sessionId: string, state = 'ready') => ({ sessionId, state, titleId: 'movie', positionSeconds: 0, audioTracks: [], subtitleTracks: [], sourceGeneration: 0, seekGeneration: 0 } as unknown as PlaybackPlan);

test('a film whose first start is refused as still preparing plays the retry\'s plan', async () => {
  const { box, playback, requests } = harness([
    async () => { throw new VelaError({ class: 'transient', code: 'preparation_pending', message: 'Preparing', retry: { allowed: true, afterSeconds: 1 } }, 503, '1'); },
    async () => titlePlan('s2'),
  ]);
  await playback.start({ kind: 'title', id: 'movie' });
  expect(box.get().playback).toMatchObject({ phase: 'failed', retryAfterSeconds: 1, retryAttempt: 1 });
  await wait(1150);
  expect(requests()).toBe(2);
  // The watch route's player reads its plan from this state, so a plan here is what it loads.
  expect(box.get().playback).toMatchObject({ phase: 'playing', sessionId: 's2', error: '' });
  expect(box.get().playback.plan?.sessionId).toBe('s2');
  await playback.stop();
});

test('a start answered with a session that has already ended is asked once more under a new key', async () => {
  const keys: string[] = [];
  const answers = [titlePlan('old', 'ended'), titlePlan('s2')];
  const adapter = {
    startPlayback: async (request: { idempotencyKey: string }) => { keys.push(request.idempotencyKey); return answers[keys.length - 1]!; },
    sessionSnapshot: () => new Promise<never>(() => {}),
    command: async () => ({}) as PlaybackPlan,
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, client: {} };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  await playback.start({ kind: 'title', id: 'movie' });
  await wait(10);
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
  expect(box.get().playback).toMatchObject({ phase: 'playing', sessionId: 's2' });
  await playback.stop();
});

test('a start answered twice with a session that has already ended fails, and is not asked again', async () => {
  const { box, playback, requests } = harness([async () => titlePlan('old', 'ended')]);
  await playback.start({ kind: 'title', id: 'movie' });
  await wait(10);
  expect(requests()).toBe(2);
  expect(box.get().playback).toMatchObject({ phase: 'failed', sessionId: '', plan: null, errorCode: 'session_ended', retryAfterSeconds: 0 });
  playback.recover('old');
  await wait(1200);
  expect(requests()).toBe(2);
  await playback.stop();
});

test('a recovery the server answers with the session it just stopped (still "ready") asks afresh once', async () => {
  const clock = manualTimers();
  try {
    const requests: string[] = [], stops: string[] = [];
    const answers = ['s1', 's1', 's3'];
    const adapter = {
      startPlayback: async (request: { idempotencyKey: string }) => { requests.push(request.idempotencyKey); return titlePlan(answers[requests.length - 1]!); },
      sessionSnapshot: () => new Promise<never>(() => {}),
      command: async (id: string, command: { kind: string }) => { if (command.kind === 'stop') stops.push(id); return titlePlan(id); },
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    await playback.start({ kind: 'title', id: 'movie' });
    playback.recover('s1');
    await clock.run(1000);
    expect(stops).toEqual(['s1']);
    expect(requests).toHaveLength(3);
    expect(requests[1]!.startsWith('recover-')).toBe(true);
    expect(requests[2]).toBe(`${requests[1]}-fresh`);
    expect(box.get().playback).toMatchObject({ phase: 'playing', sessionId: 's3' });
    await playback.stop();
  } finally { clock.restore(); }
});
