import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';

// Where a restart asks the server to resume: the last position the viewer saw, not the zero a
// freshly reset engine reports while it loads the replacement.
async function watch(run: (h: { playback: Playback; sessionId: () => string; restart: () => Promise<number> }) => Promise<void>, start?: number) {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { ms: number; fire: () => unknown }>();
  let sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  try {
    const requests: any[] = [];
    const paths = [{ id: 'file', kind: 'direct', transport: 'file', original: true }];
    let generation = 1;
    const plan = (id: string, position: number) => ({ sessionId: id, state: 'playing', positionSeconds: position, paths, selectedPathId: 'file', audioTracks: [], subtitleTracks: [], sourceGeneration: generation, seekGeneration: generation } as unknown as PlaybackPlan);
    const adapter = {
      startPlayback: async (r: any) => { requests.push(r); return plan(`s${requests.length}`, r.positionSeconds ?? 0); },
      sessionSnapshot: async (id: string) => ({ plan: plan(id, 0) }),
      command: async (id: string, c: any) => { if (c.kind === 'seek') generation++; return plan(id, c.kind === 'seek' ? c.positionSeconds : 0); },
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const restart = async () => {
      const before = requests.length;
      playback.recover(box.get().playback.sessionId);
      const entry = [...timers].find(([, t]) => t.ms === 1000);
      expect(entry).toBeDefined();
      timers.delete(entry![0]); await entry![1].fire();
      await flush();
      expect(requests.length).toBe(before + 1);
      return requests.at(-1).positionSeconds;
    };
    await playback.start({ kind: 'title', id: 'movie', ...(start !== undefined ? { positionSeconds: start } : {}) });
    await flush();
    await run({ playback, sessionId: () => box.get().playback.sessionId, restart });
    await playback.stop();
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
}

const at = (sessionId: string, state: string, position: number) => ({ sessionId, live: null, state, position, sourceGeneration: 1, seekGeneration: 1 });

test('a second restart resumes where the first one left off, not at the loading zero', async () => {
  await watch(async ({ playback, sessionId, restart }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    expect(await restart()).toBe(1815);
    // The replacement engine reports a reset clock while it loads, then fails before it presents.
    playback.snapshot(at(sessionId(), 'loading', 0));
    playback.snapshot(at(sessionId(), 'buffering', 0));
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('Start Over: a seek to zero the server accepts moves the restart position to the start', async () => {
  await watch(async ({ playback, sessionId, restart }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // A multi-part title's stream restarts at the new part: both generations move on.
    await playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek' });
    // The replacement reports loading at zero, then fails before it presents.
    playback.snapshot({ ...at(sessionId(), 'loading', 0), sourceGeneration: 2, seekGeneration: 2 });
    expect(await restart()).toBe(0);
  }, 1800);
});

test('Start Over: a rewind to zero the player shows moves the restart position to the start', async () => {
  for (const state of ['paused', 'playing']) await watch(async ({ playback, sessionId, restart }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    playback.snapshot(at(sessionId(), state, 0));
    expect(await restart()).toBe(0);
  }, 1800);
});

test('a buffering sample at a positive position still moves the restart position', async () => {
  await watch(async ({ playback, sessionId, restart }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    playback.snapshot(at(sessionId(), 'buffering', 1830));
    expect(await restart()).toBe(1830);
  }, 1800);
});

test('a title that starts at zero and fails while still loading restarts at zero', async () => {
  await watch(async ({ playback, sessionId, restart }) => {
    playback.snapshot(at(sessionId(), 'loading', 0));
    expect(await restart()).toBe(0);
  });
});
