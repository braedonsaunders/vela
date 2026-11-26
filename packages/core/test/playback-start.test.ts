import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';
import { VelaError } from '../src/adapter/errors';

test('startup is visible synchronously and repeat starts are ignored, not queued', async () => {
  let resolve!: (plan: PlaybackPlan) => void;
  const pending = new Promise<PlaybackPlan>(r => { resolve = r; });
  let requests = 0;
  const plan = { sessionId: 's', sourceGeneration: 0, seekGeneration: 0, state: 'ended', titleId: 't' } as PlaybackPlan;
  const adapter = { startPlayback: () => { requests++; return pending; }, sessionSnapshot: async () => ({ plan }), command: async () => plan };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, client: {} };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  const first = playback.start({ kind: 'title', id: 't' });
  expect(box.get().playback.phase).toBe('starting');
  await playback.start({ kind: 'title', id: 't' });
  await new Promise(r => setTimeout(r, 0));
  expect(requests).toBe(1);
  resolve(plan); await first;
  await playback.stop();
});

test('stopping never publishes a local resume that the server might reject', async () => {
  const published: number[] = []; let reconciled = 0;
  const plan = { sessionId: 's', sourceGeneration: 0, seekGeneration: 0, state: 'playing', titleId: 't' } as PlaybackPlan;
  const adapter = { command: async () => ({ ...plan, state: 'ended', positionSeconds: 54 }), detail: async () => ({ title: { watch: { positionSeconds: 0 } } }), reportObservation: async () => ({ accepted: true }) };
  const session = { onReset() {}, ready: async () => ({ adapter }) };
  const box = new StateBox({ playback: { ...initialPlayback, phase: 'playing', sessionId: 's', plan } } as VelaState);
  const playback = new Playback(box, session as unknown as Session, watched => { published.push(watched.positionSeconds); }, () => { reconciled++; });
  await playback.observe('s', { positionSeconds: 54, state: 'playing' } as never);
  await playback.stop();
  await Promise.resolve();
  expect(published).toEqual([0]);
  expect(reconciled).toBe(1);
});

test('a stop hands the stopped title\'s media class to the reconcile, and none for an undescribed title', async () => {
  const reconciled: (string | undefined)[] = [];
  const plan = { sessionId: 's', sourceGeneration: 0, seekGeneration: 0, state: 'playing', titleId: 't' } as PlaybackPlan;
  const adapter = { command: async () => ({ ...plan, state: 'ended' }), detail: async () => ({ title: { watch: { positionSeconds: 30 } } }), reportObservation: async () => ({ accepted: true }) };
  const session = { onReset() {}, ready: async () => ({ adapter }) };
  for (const target of [{ kind: 'title', id: 't', media: 'music' }, { kind: 'title', id: 't' }] as const) {
    const box = new StateBox({ playback: { ...initialPlayback, phase: 'playing', sessionId: 's', plan, target } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, (_watched, media) => { reconciled.push(media); });
    await playback.observe('s', { positionSeconds: 30, state: 'playing' } as never);
    await playback.stop();
    await Promise.resolve();
  }
  expect(reconciled).toEqual(['music', undefined]);
});

test('a plan arriving after Back releases its server session instead of leaking a slot', async () => {
  let resolve!: (plan: PlaybackPlan) => void;
  const pending = new Promise<PlaybackPlan>(r => { resolve = r; });
  const stopped: string[] = [];
  const adapter = { startPlayback: () => pending, command: async (id: string) => { stopped.push(id); return {} as PlaybackPlan; } };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter }), negotiate: async () => {}, client: {} };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  const start = playback.start({ kind: 'title', id: 't' });
  await new Promise(r => setTimeout(r, 0));
  await playback.stop();
  resolve({ sessionId: 'late', sourceGeneration: 0, seekGeneration: 0 } as PlaybackPlan);
  await start;
  expect(stopped).toEqual(['late']);
  expect(box.get().playback.phase).toBe('idle');
});

test('explicit zero overrides server resume without publishing watch state before playback', async () => {
  const requests: { positionSeconds?: number }[] = [];
  const plan = { sessionId: 's', sourceGeneration: 0, seekGeneration: 0, state: 'playing', titleId: 't', positionSeconds: 0 } as PlaybackPlan;
  const adapter = { startPlayback: async (request: { positionSeconds?: number }) => { requests.push(request); return plan; }, sessionSnapshot: async () => ({ plan }), command: async () => plan };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, client: {} };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  let watched = 0;
  const playback = new Playback(box, session as unknown as Session, () => { watched++; }, () => {});
  await playback.start({ kind: 'title', id: 't', positionSeconds: 0 });
  expect(requests[0]?.positionSeconds).toBe(0);
  expect(watched).toBe(0);
  await playback.stop();
});

test.each([false, true])('stop respects the originating viewer after switching (viewer changed: %s)', async changed => {
  const calls: string[] = [];
  const progress = Promise.withResolvers<{ accepted: boolean }>();
  const plan = {
    sessionId: 'shared-id', sourceGeneration: 0, seekGeneration: 0, state: 'playing', titleId: 't',
    paths: [], audioTracks: [], subtitleTracks: [],
  } as unknown as PlaybackPlan;
  const adapter = (name: string) => ({
    startPlayback: async () => plan,
    sessionSnapshot: async () => ({ plan }),
    reportObservation: () => { calls.push(`${name}:progress`); return progress.promise; },
    command: async () => { calls.push(`${name}:stop`); return { ...plan, state: 'ended' }; },
    detail: async () => { calls.push(`${name}:detail`); return { title: { watch: { positionSeconds: 30 } } }; },
  });
  const origin = adapter('origin');
  let active = origin;
  let viewer = 'original';
  const session = {
    epoch: 0, onReset() {},
    ready: async () => ({ adapter: active, plan: (value: PlaybackPlan) => value }),
    negotiate: async () => {}, client: {},
    tokens: async ({ adapter }: { adapter: typeof origin }) => ({ viewer: { id: adapter === origin ? viewer : 'other-server' } }),
  };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session,
    () => calls.push('publish'), () => calls.push('reconcile'));
  await playback.start({ kind: 'title', id: 't' });
  const reporting = playback.observe(plan.sessionId, { positionSeconds: 30, state: 'playing' } as never);
  await Promise.resolve();
  const stopping = playback.stop();
  active = adapter('new');
  session.epoch++;
  if (changed) viewer = 'different-profile';
  progress.resolve({ accepted: true });
  await Promise.all([reporting, stopping]);
  expect(calls).toEqual(changed ? ['origin:progress'] : ['origin:progress', 'origin:stop']);
});

test.each([false, true])('stale stop retries on the opening server only while its viewer matches (viewer changed: %s)', async changed => {
  const plan = {
    sessionId: 's', sourceGeneration: 0, seekGeneration: 0, state: 'playing', titleId: 't',
    paths: [], audioTracks: [], subtitleTracks: [],
  } as unknown as PlaybackPlan;
  const generations = { sourceGeneration: 1, seekGeneration: 2 };
  const started = Promise.withResolvers<void>();
  const stopReply = Promise.withResolvers<PlaybackPlan>();
  const calls: unknown[] = [];
  const origin = {
    startPlayback: async () => plan,
    sessionSnapshot: async () => ({ plan }),
    command: async (_id: string, command: unknown) => {
      calls.push(command);
      if (calls.length !== 1) return { ...plan, state: 'ended' };
      started.resolve();
      return stopReply.promise;
    },
    unloadStop: () => [{ url: 'https://original.example/stop', method: 'POST' }],
  };
  const connection = { adapter: origin, plan: (value: PlaybackPlan) => value };
  let active = connection;
  let viewer = 'original';
  const session = {
    epoch: 0, onReset() {}, ready: async () => active, negotiate: async () => {},
    client: {}, key: () => 'retry',
    tokens: async () => ({ viewer: { id: viewer } }),
  };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  await playback.start({ kind: 'title', id: 't' });
  const stopping = playback.stop();
  await started.promise;
  active = { ...connection, adapter: { ...origin, command: async () => {
    calls.push('Stop reached the selected server');
    return plan;
  } } };
  session.epoch++;
  if (changed) viewer = 'different-profile';
  stopReply.reject(new VelaError({
    class: 'request', code: 'stale_generation', message: 'Generation changed',
    currentGenerations: generations, retry: { allowed: false },
  }, 409));
  await stopping;
  expect(calls).toEqual([
    { kind: 'stop', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'stop-s-0-0' },
    ...(changed ? [] : [{ kind: 'stop', ...generations, idempotencyKey: 'retry' }]),
  ]);
  expect(playback.stopOnUnload(() => {})).toBe(0);
});
