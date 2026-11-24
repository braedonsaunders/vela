import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';

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
