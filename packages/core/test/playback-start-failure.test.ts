import { expect, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { Playback, initialPlayback } from '../src/store/playback';
import { startRefusal, startRetry } from '../src/store/start-retry';
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

test('startRefusal carries the server\'s message and class, or a fallback', () => {
  expect(startRefusal(refused({ allowed: false }))).toEqual({ message: 'The connection to the Live TV provider failed.', code: 'network', errorClass: 'source' });
  expect(startRefusal(new Error('boom'), 'x')).toEqual({ message: 'boom', code: '', errorClass: '' });
  expect(startRefusal('weird', 'Playback failed').message).toBe('Playback failed');
});
