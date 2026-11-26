import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';

// Where a restart asks the server to resume: the last position the viewer saw, not the zero a
// freshly reset engine reports while it loads the replacement.
async function watch(run: (h: { playback: Playback; sessionId: () => string; restart: () => Promise<number>; adapter: { command: (id: string, c: any) => Promise<PlaybackPlan> } }) => Promise<void>, start?: number) {
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
    const adapter: { command: (id: string, c: any) => Promise<PlaybackPlan>; [name: string]: unknown } = {
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
    await run({ playback, sessionId: () => box.get().playback.sessionId, restart, adapter });
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

test('a late snapshot from before an accepted seek does not move the restart position back', async () => {
  await watch(async ({ playback, sessionId, restart }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    await playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek' });
    // The old generation's last report arrives after the server accepted the seek.
    playback.snapshot(at(sessionId(), 'playing', 1815));
    expect(await restart()).toBe(90);
  }, 1800);
});

for (const [behind, sourceGeneration, seekGeneration] of [['source', 1, 2], ['seek', 2, 1]] as const) {
  test(`a snapshot behind the plan's ${behind} generation does not move the restart position`, async () => {
    await watch(async ({ playback, sessionId, restart }) => {
      await playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek' });
      playback.snapshot({ ...at(sessionId(), 'playing', 1815), sourceGeneration, seekGeneration });
      expect(await restart()).toBe(90);
    }, 1800);
  });
}

test('a snapshot at the accepted seek\'s generations moves the restart position', async () => {
  await watch(async ({ playback, sessionId, restart }) => {
    await playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek' });
    // The new generation's own report still moves it.
    playback.snapshot({ ...at(sessionId(), 'playing', 95), sourceGeneration: 2, seekGeneration: 2 });
    expect(await restart()).toBe(95);
  }, 1800);
});

test('a snapshot ahead of the stored plan, after an earlier seek\'s reply arrives last, moves the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, adapter }) => {
    // Each reply is held until released, so the first seek's reply can arrive after the second's.
    const send = adapter.command, held: (() => void)[] = [];
    adapter.command = async (id, c) => { const reply = await send(id, c); await new Promise<void>(release => held.push(release)); return reply; };
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    await flush();
    // The first seek's plan reached the player through the event stream; the viewer seeks again.
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 900, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'seek-900' });
    await flush();
    held[1]!(); await second;
    held[0]!(); await first;
    adapter.command = send;
    // The player plays the second seek at its newer generations.
    playback.snapshot({ ...at(sessionId(), 'playing', 901), sourceGeneration: 3, seekGeneration: 3 });
    expect(await restart()).toBe(901);
  }, 1800);
});
