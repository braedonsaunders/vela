import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { coldVersion, hasColdVersion, withSessionVersions } from '../src/store/session-versions';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan, VersionItem } from '../src/wire';

const cold: VersionItem[] = [
  { id: 'a', label: 'Auto', recommended: true, availability: 'fetch' },
  { id: 'b', label: 'Same-quality version 1', recommended: false, availability: 'fetch', resolution: '4K' },
];
const real: VersionItem[] = [
  { id: 'a', label: '1080p Remux', recommended: true, availability: 'instant', resolution: '1080p', source: 'Remux', sizeBytes: 31_256_249_985 },
  { id: 'b', label: '4K WEB-DL', recommended: false, availability: 'cached', resolution: '4K', source: 'WEB-DL', sizeBytes: 20_000_000_000 },
];
const planOf = (sessionId: string, versions: VersionItem[], extra: Partial<PlaybackPlan> = {}) => ({
  sessionId, revision: 1, state: 'playing', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1,
  audioTracks: [], subtitleTracks: [], selectedVersionId: 'a', versions, ...extra,
} as unknown as PlaybackPlan);

function harness(first: PlaybackPlan) {
  const calls = { start: 0, snapshot: 0, command: 0 };
  let answer: () => Promise<{ plan: PlaybackPlan }> = async () => ({ plan: first });
  let next = first;
  const adapter = {
    startPlayback: async () => { calls.start++; return next; },
    sessionSnapshot: async () => { calls.snapshot++; return answer(); },
    // The event stream stays open (and silent) until playback stops following it.
    streamSession: (_id: string, _cursor: string, _on: unknown, signal?: AbortSignal) =>
      new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })),
    streamViewerEvents: async () => {},
    command: async () => { calls.command++; return next; },
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
  const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  return {
    calls, box, playback,
    answer: (fn: () => Promise<{ plan: PlaybackPlan }>) => { answer = fn; },
    next: (plan: PlaybackPlan) => { next = plan; },
  };
}

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('a placeholder slot is one with no facts about the release', () => {
  expect(cold.every(coldVersion)).toBe(true);
  expect(real.some(coldVersion)).toBe(false);
  expect(hasColdVersion(undefined)).toBe(false);
});

test('opening the menu re-reads only the version list: the plan, its generations and the engine stay put', async () => {
  const h = harness(planOf('s1', cold));
  await h.playback.start({ kind: 'title', id: 'psycho' });
  await settle();
  const plan = h.box.get().playback.plan;
  const before = { ...h.calls };
  h.answer(async () => ({ plan: planOf('s1', real, { revision: 1 }) }));

  // Two opens in quick succession share the read in flight: one request.
  await Promise.all([h.playback.refreshVersions('s1'), h.playback.refreshVersions('s1')]);
  expect(h.calls.snapshot - before.snapshot).toBe(1);
  expect(h.calls.start).toBe(before.start);
  expect(h.calls.command).toBe(before.command);
  const state = h.box.get().playback;
  expect(state.plan).toBe(plan!);
  expect(state.plan?.versions).toEqual(cold);
  expect(state.phase).toBe('playing');
  expect(state.versions?.versions).toEqual(real);

  // The chrome's plan shows the refreshed list with the plan's own generations and sources.
  const shown = withSessionVersions(state.plan!, state.versions);
  expect(shown.versions).toEqual(real);
  expect(shown.selectedVersionId).toBe('a');
  expect(shown.sourceGeneration).toBe(plan!.sourceGeneration);
  expect(shown.sessionId).toBe('s1');

  // A later open asks again (once).
  await h.playback.refreshVersions('s1');
  expect(h.calls.snapshot - before.snapshot).toBe(2);
  await h.playback.stop();
});

test('a failed read keeps the list it had and reports nothing', async () => {
  const h = harness(planOf('s1', cold));
  await h.playback.start({ kind: 'title', id: 'psycho' });
  await settle();
  h.answer(async () => ({ plan: planOf('s1', real) }));
  await h.playback.refreshVersions('s1');
  const kept = h.box.get().playback.versions;
  h.answer(async () => { throw new Error('connection reset'); });
  await h.playback.refreshVersions('s1');
  // A read that describes no versions is ignored too.
  h.answer(async () => ({ plan: planOf('s1', []) }));
  await h.playback.refreshVersions('s1');
  const state = h.box.get().playback;
  expect(state.versions).toBe(kept);
  expect(state.error).toBe('');
  expect(state.phase).toBe('playing');
  await h.playback.stop();
});

test('a read that answers after the session changed is dropped', async () => {
  const h = harness(planOf('s1', cold));
  await h.playback.start({ kind: 'title', id: 'psycho' });
  await settle();
  let release!: () => void;
  h.answer(() => new Promise(resolve => { release = () => resolve({ plan: planOf('s1', real) }); }));
  const reading = h.playback.refreshVersions('s1');
  await settle();
  h.answer(async () => ({ plan: planOf('s2', cold) }));
  h.next(planOf('s2', cold));
  await h.playback.start({ kind: 'title', id: 'psycho', positionSeconds: 10 });
  await settle();
  release();
  await reading;
  expect(h.box.get().playback.sessionId).toBe('s2');
  expect(h.box.get().playback.versions).toBeNull();
  // A read for a session that is no longer playing asks nothing.
  const asked = h.calls.snapshot;
  await h.playback.refreshVersions('s1');
  expect(h.calls.snapshot).toBe(asked);
  await h.playback.stop();
  expect(h.box.get().playback.versions).toBeNull();
});

test('a plan offered with placeholders is read once more after the start, never polled', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { ms: number; fire: () => unknown }>();
  let sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  try {
    const h = harness(planOf('s1', cold));
    await h.playback.start({ kind: 'title', id: 'psycho' });
    await settle();
    const scheduled = [...timers].filter(([, t]) => t.ms === 4000);
    expect(scheduled).toHaveLength(1);
    const before = h.calls.snapshot;
    h.answer(async () => ({ plan: planOf('s1', real) }));
    timers.delete(scheduled[0]![0]);
    await scheduled[0]![1].fire();
    await settle();
    expect(h.calls.snapshot - before).toBe(1);
    expect(h.box.get().playback.versions?.versions).toEqual(real);
    expect([...timers.values()].some(t => t.ms === 4000)).toBe(false);
    await h.playback.stop();

    // A plan that already names its releases schedules nothing; stopping clears a pending read.
    const warm = harness(planOf('s3', real));
    await warm.playback.start({ kind: 'title', id: 'psycho' });
    await settle();
    expect([...timers.values()].some(t => t.ms === 4000)).toBe(false);
    const coldStart = harness(planOf('s4', cold));
    await coldStart.playback.start({ kind: 'title', id: 'psycho' });
    await settle();
    expect([...timers.values()].some(t => t.ms === 4000)).toBe(true);
    await coldStart.playback.stop();
    expect([...timers.values()].some(t => t.ms === 4000)).toBe(false);
    await warm.playback.stop();
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

test('the chrome shows the newer of the refreshed list and the plan', () => {
  const refreshed = { sessionId: 's1', sourceGeneration: 1, versions: real, selectedVersionId: 'a' };
  // Another session's list never applies.
  const other = planOf('s2', cold);
  expect(withSessionVersions(other, refreshed)).toBe(other);
  expect(withSessionVersions(other, null)).toBe(other);
  // A version switch answered since (newer generation) with placeholders still: the real list,
  // the switch's choice.
  const switched = withSessionVersions(planOf('s1', cold, { sourceGeneration: 2, selectedVersionId: 'b' }), refreshed);
  expect(switched.versions).toEqual(real);
  expect(switched.selectedVersionId).toBe('b');
  expect(switched.sourceGeneration).toBe(2);
  // A newer plan that already names real releases is shown as it is.
  const named = planOf('s1', [real[1]!, real[0]!], { sourceGeneration: 2, selectedVersionId: 'b' });
  expect(withSessionVersions(named, refreshed)).toBe(named);
  // The read's remembered choice comes with its list.
  const remembered = withSessionVersions(planOf('s1', cold), { ...refreshed, rememberedChoice: { scope: 'title', active: true, label: '4K WEB-DL' } });
  expect(remembered.rememberedChoice?.label).toBe('4K WEB-DL');
});

test('a version switched to in the player is the one a restart asks for', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { ms: number; fire: () => unknown }>();
  let sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  try {
    const requests: Record<string, unknown>[] = [];
    const adapter = {
      startPlayback: async (r: Record<string, unknown>) => { requests.push(r); return planOf(`s${requests.length}`, real, { sourceGeneration: 0, seekGeneration: 0 }); },
      sessionSnapshot: async (id: string) => ({ plan: planOf(id, real) }),
      streamSession: (_id: string, _cursor: string, _on: unknown, signal?: AbortSignal) =>
        new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })),
      streamViewerEvents: async () => {},
      command: async (id: string) => planOf(id, real),
      titleVersions: async () => ({ titleId: 'psycho', selectedVersionId: null, versions: real }),
      clearVersionChoice: async () => ({ titleId: 'psycho', selectedVersionId: null, versions: real, cleared: false }),
      switchVersion: async (id: string, c: { versionId: string }) => planOf(id, real, { sourceGeneration: 1, seekGeneration: 0, selectedVersionId: c.versionId }),
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    await playback.start({ kind: 'title', id: 'psycho', versionId: 'a' });
    await settle();
    playback.snapshot({ sessionId: 's1', live: null, position: 30, state: 'playing' });
    await playback.switchVersion('s1', 'b', 30);
    expect(box.get().playback.target).toEqual({ kind: 'title', id: 'psycho', versionId: 'b' });
    playback.snapshot({ sessionId: 's1', live: null, position: 31, state: 'loading' });
    playback.recover('s1');
    const restart = [...timers].find(([, t]) => t.ms === 1000)!;
    timers.delete(restart[0]);
    await restart[1].fire();
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ titleId: 'psycho', versionId: 'b' });
    await playback.stop();
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
