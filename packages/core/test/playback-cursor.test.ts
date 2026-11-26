import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';
import { VelaError } from '../src/adapter/errors';

// Where a restart asks the server to resume: the last position the viewer saw, not the zero a
// freshly reset engine reports while it loads the replacement.
async function watch(run: (h: { playback: Playback; sessionId: () => string; restart: (during?: () => Promise<void>) => Promise<number>; publish: (seekGeneration: number, position: number, rest?: Partial<PlaybackPlan>) => Promise<void>; plan: () => PlaybackPlan | null; adapter: { command: (id: string, c: any) => Promise<PlaybackPlan> }; requests: any[]; fire: (ms: number) => Promise<void> }) => Promise<void>, start?: number) {
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
    // `during`: what happens while recovery waits to ask for the replacement.
    const restart = async (during?: () => Promise<void>) => {
      const before = requests.length;
      playback.recover(box.get().playback.sessionId);
      await during?.();
      const entry = [...timers].find(([, t]) => t.ms === 1000);
      expect(entry).toBeDefined();
      timers.delete(entry![0]); await entry![1].fire();
      await flush();
      expect(requests.length).toBe(before + 1);
      return requests.at(-1).positionSeconds;
    };
    // The server publishes the session's plan (here through the snapshot poll) at the given seek generation.
    const publish = async (seekGeneration: number, position: number, rest: Partial<PlaybackPlan> = {}) => {
      const id = box.get().playback.sessionId;
      adapter.sessionSnapshot = async () => ({ plan: { ...plan(id, position), seekGeneration, ...rest } });
      const entry = [...timers].find(([, t]) => t.ms === 5000);
      expect(entry).toBeDefined();
      timers.delete(entry![0]); await entry![1].fire();
      await flush();
      expect(box.get().playback.plan?.seekGeneration).toBe(seekGeneration);
    };
    await playback.start({ kind: 'title', id: 'movie', ...(start !== undefined ? { positionSeconds: start } : {}) });
    await flush();
    // Fires the pending timer of the given delay.
    const fire = async (ms: number) => {
      const entry = [...timers].find(([, t]) => t.ms === ms);
      expect(entry).toBeDefined();
      timers.delete(entry![0]); await entry![1].fire();
      await flush();
    };
    await run({ playback, sessionId: () => box.get().playback.sessionId, restart, publish, plan: () => box.get().playback.plan, adapter, requests, fire });
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

// Each seek's reply is held until released, so replies can arrive in any order.
function holdReplies(adapter: { command: (id: string, c: any) => Promise<PlaybackPlan> }) {
  const send = adapter.command, held: (() => void)[] = [];
  adapter.command = async (id, c) => {
    const reply = await send(id, c);
    if (c.kind === 'seek') await new Promise<void>(release => held.push(release));
    return reply;
  };
  return { held, restore: () => { adapter.command = send; } };
}

test('an earlier seek\'s reply arriving last does not move the restart position back', async () => {
  await watch(async ({ playback, sessionId, restart, adapter }) => {
    const { held, restore } = holdReplies(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    await flush();
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 900, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-900' });
    await flush();
    // The 900 s reply arrives first, the 0 s reply last; the player fails before it reports again.
    held[1]!(); await second;
    held[0]!(); await first;
    restore();
    expect(await restart()).toBe(900);
  }, 1800);
});

test('Start Over: an accepted seek to zero published before its reply moves the restart position to the start', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { held, restore } = holdReplies(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    await flush();
    // The server publishes the accepted 0 s plan while the command's reply is still held.
    await publish(2, 0);
    playback.snapshot({ ...at(sessionId(), 'loading', 0), seekGeneration: 2 });
    expect(await restart()).toBe(0);
    held[0]!(); await seek;
    restore();
  }, 1800);
});

test('a plan published at a newer seek generation that no seek asked for does not move the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, publish }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // A track change raises both generations at the server's last observed position.
    await publish(2, 90, { sourceGeneration: 2 });
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a report from before the seek the restart position follows stays stale after the older plan comes back', async () => {
  await watch(async ({ playback, sessionId, restart, adapter }) => {
    const { held, restore } = holdReplies(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    await flush();
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 900, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-900' });
    await flush();
    held[1]!(); await second;
    held[0]!(); await first;
    restore();
    // A queued report from the first seek, at its generations.
    playback.snapshot({ ...at(sessionId(), 'playing', 0), sourceGeneration: 2, seekGeneration: 2 });
    expect(await restart()).toBe(900);
  }, 1800);
});

test('Start Over: an accepted seek to zero read again through a refresh moves the restart position to the start', async () => {
  await watch(async ({ playback, sessionId, restart, adapter }) => {
    const { held, restore } = holdReplies(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    await flush();
    // The player asks for the session's plan again while the command's reply is still held.
    const id = sessionId();
    (adapter as any).sessionSnapshot = async () => ({ plan: { sessionId: id, state: 'playing', positionSeconds: 0, paths: [{ id: 'file', kind: 'direct', transport: 'file', original: true }],
      selectedPathId: 'file', audioTracks: [], subtitleTracks: [], sourceGeneration: 2, seekGeneration: 2 } });
    expect(await playback.refresh(id)).toBe(true);
    expect(await restart()).toBe(0);
    held[0]!(); await seek;
    restore();
  }, 1800);
});

test('a plan the session already had does not count for a seek issued against it', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // A track change raised both generations at 90 s; the viewer then seeks to 90 s against it.
    await publish(2, 90, { sourceGeneration: 2 });
    const send = adapter.command;
    let refuse = () => {};
    adapter.command = (id, c) => c.kind === 'seek' ? new Promise((_, reject) => { refuse = () => reject(new Error('refused')); }) : send(id, c);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'seek-90' });
    await flush();
    // The same plan is read again, then the server refuses the seek.
    expect(await playback.refresh(sessionId())).toBe(true);
    refuse(); await seek;
    adapter.command = send;
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a published plan counts once for the seek it answers', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const send = adapter.command;
    let refuse = () => {};
    adapter.command = (id, c) => c.kind === 'seek' ? new Promise((_, reject) => { refuse = () => reject(new Error('refused')); }) : send(id, c);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // The accepted plan is published before the reply, and the player plays on from it.
    await publish(2, 90);
    playback.snapshot({ ...at(sessionId(), 'playing', 95), seekGeneration: 2 });
    // A later plan that no seek asked for (a track change at the server's last observed 90 s), read again.
    const id = sessionId();
    (adapter as any).sessionSnapshot = async () => ({ plan: { sessionId: id, state: 'playing', positionSeconds: 90, paths: [{ id: 'file', kind: 'direct', transport: 'file', original: true }],
      selectedPathId: 'file', audioTracks: [], subtitleTracks: [], sourceGeneration: 2, seekGeneration: 3 } });
    expect(await playback.refresh(id)).toBe(true);
    expect(await restart()).toBe(95);
    refuse(); await seek;
    adapter.command = send;
  }, 1800);
});

// Each seek's reply is held until the server refuses it, or until the reply is lost (`lose`); the latest seek by default.
function refuseSeeks(adapter: { command: (id: string, c: any) => Promise<PlaybackPlan> }) {
  const send = adapter.command;
  const fails: ((error: unknown) => void)[] = [];
  adapter.command = (id, c) => c.kind === 'seek' ? new Promise((_, reject) => { fails.push(reject); }) : send(id, c);
  const refusal = new VelaError({ class: 'conflict', code: 'seek_refused', message: 'refused', retry: { allowed: false } }, 409);
  return {
    refuse: (seek = fails.length - 1) => fails[seek]!(refusal),
    lose: (seek = fails.length - 1) => fails[seek]!(new TypeError('Failed to fetch')),
    restore: () => { adapter.command = send; },
  };
}

test('a track change published at a waiting seek\'s target does not keep the restart position once the seek is refused', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { refuse, restore } = refuseSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // An unrelated track change is published at 90 s; the server advances both generations for it. The seek is then refused.
    await publish(2, 90, { sourceGeneration: 2 });
    refuse(); await seek;
    restore();
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a published plan matching a waiting seek keeps a later playing report once the seek is refused', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { refuse, restore } = refuseSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // An unrelated track change at the seek's target, at both generations advanced, then a playing report on it.
    await publish(2, 90, { sourceGeneration: 2 });
    playback.snapshot({ ...at(sessionId(), 'playing', 92), sourceGeneration: 2, seekGeneration: 2 });
    refuse(); await seek;
    restore();
    expect(await restart()).toBe(92);
  }, 1800);
});

test('an earlier seek\'s reply arriving last does not replace the newer plan', async () => {
  await watch(async ({ playback, sessionId, plan, adapter }) => {
    const { held, restore } = holdReplies(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    await flush();
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 900, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-900' });
    await flush();
    held[1]!(); await second;
    expect(plan()?.positionSeconds).toBe(900);
    held[0]!(); await first;
    restore();
    expect(plan()?.positionSeconds).toBe(900);
  }, 1800);
});

test('a seek\'s reply arriving after an accepted version switch does not replace its plan or move the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, plan, adapter }) => {
    const { held, restore } = holdReplies(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // Version B is accepted at 1815 s with newer generations while the seek's reply is held.
    const versions = adapter as unknown as Record<string, unknown>;
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = async (id: string) => ({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 5, seekGeneration: 5 });
    await playback.switchVersion(sessionId(), 'b', 1815);
    expect(plan()?.selectedVersionId).toBe('b');
    held[0]!(); await seek;
    restore();
    expect(plan()?.selectedVersionId).toBe('b');
    expect(plan()?.positionSeconds).toBe(1815);
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('Start Over: buffering at the old position after the accepted plan is published does not move the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { held, restore } = holdReplies(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    await flush();
    await publish(2, 0);
    // The player reports buffering at its old clock under the new generations, then fails.
    const shown = plan()!;
    playback.snapshot({ ...at(sessionId(), 'buffering', 1815), sourceGeneration: shown.sourceGeneration, seekGeneration: shown.seekGeneration });
    expect(await restart()).toBe(0);
    held[0]!(); await seek;
    restore();
  }, 1800);
});

test('after an accepted seek, the first playing report at its generation moves the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, plan }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    await playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    const shown = plan()!;
    const generations = { sourceGeneration: shown.sourceGeneration, seekGeneration: shown.seekGeneration };
    playback.snapshot({ ...at(sessionId(), 'buffering', 1815), ...generations });
    playback.snapshot({ ...at(sessionId(), 'playing', 3), ...generations });
    playback.snapshot({ ...at(sessionId(), 'buffering', 4), ...generations });
    expect(await restart()).toBe(4);
  }, 1800);
});

test('Start Over: a published plan is kept when the seek\'s reply is lost rather than refused', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { lose, restore } = refuseSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    await flush();
    await publish(2, 0);
    playback.snapshot({ ...at(sessionId(), 'loading', 0), seekGeneration: 2 });
    // The reply never arrives (a network failure): the server may well have applied the seek.
    lose(); await seek;
    restore();
    expect(await restart()).toBe(0);
  }, 1800);
});

test('a track reply behind the shown plan only on revision still records the selection it confirms', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    // The server takes track changes; the first one's reply is held.
    const server = adapter as unknown as { changeTracks: (id: string, c: any) => Promise<PlaybackPlan>; startPlayback: (r: any) => Promise<PlaybackPlan> };
    const sent: any[] = [];
    let release = () => {};
    server.changeTracks = (id, c) => {
      sent.push(c);
      const reply = { ...plan()!, sessionId: id, selectedAudioTrackId: c.audioTrackId };
      return sent.length > 1 ? Promise.resolve(reply) : new Promise(resolve => { release = () => resolve({ ...reply, revision: 1 }); });
    };
    // Every session offers both tracks and opens on English.
    const start = server.startPlayback;
    server.startPlayback = async r => ({ ...(await start(r)), audioTracks: [{ id: 'en' }, { id: 'fr' }], selectedAudioTrackId: 'en' } as unknown as PlaybackPlan);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot({ ...at(sessionId(), 'playing', 1815), audioTrackId: 'en' });
    const tracks = playback.command(sessionId(), { kind: 'tracks', audioTrackId: 'fr', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'tracks-fr' });
    await flush();
    // A newer revision confirming French is shown before the reply; the player fails before it reports again.
    await publish(1, 1815, { revision: 2, audioTracks: [{ id: 'en' }, { id: 'fr' }], selectedAudioTrackId: 'fr' } as Partial<PlaybackPlan>);
    release(); await tracks;
    expect(plan()?.revision).toBe(2);
    await restart();
    // Recovery asks the replacement for French.
    expect(sent.map(c => c.audioTrackId)).toEqual(['fr', 'fr']);
  }, 1800);
});

test('a seek reply behind the shown plan only on revision still moves the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const send = adapter.command;
    let release = () => {};
    // The server moves the target to 91 s; its plan is published at a newer revision before the reply.
    adapter.command = (id, c) => c.kind === 'seek'
      ? send(id, c).then(reply => new Promise<PlaybackPlan>(resolve => { release = () => resolve({ ...reply, positionSeconds: 91, revision: 1 }); }))
      : send(id, c);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 91, { revision: 2 });
    release(); await seek;
    adapter.command = send;
    expect(plan()?.revision).toBe(2);
    expect(await restart()).toBe(91);
  }, 1800);
});

test('a version switch ends the old source\'s published seek: its late reply leaves the restart at the new version', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { held, restore } = holdReplies(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // The waiting seek's plan is published at 90 s, then version B is accepted at 1815 s.
    await publish(2, 90);
    const versions = adapter as unknown as Record<string, unknown>;
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = async (id: string) => ({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 5, seekGeneration: 5 });
    await playback.switchVersion(sessionId(), 'b', 1815);
    held[0]!(); await seek;
    restore();
    expect(plan()?.selectedVersionId).toBe('b');
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('after a followed seek, a buffering report on a plan whose source generation alone advanced moves the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    await playback.command(sessionId(), { kind: 'seek', positionSeconds: 0, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-0' });
    const followed = plan()!;
    // The server moves to a new source at the same seek generation; the player buffers at 1815 s on it.
    await publish(followed.seekGeneration, 0, { sourceGeneration: followed.sourceGeneration + 1 });
    playback.snapshot({ ...at(sessionId(), 'buffering', 1815), sourceGeneration: followed.sourceGeneration + 1, seekGeneration: followed.seekGeneration });
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a version switch keeps the restart position the player reached while the new version opened', async () => {
  await watch(async ({ playback, sessionId, restart, plan, adapter }) => {
    playback.snapshot(at(sessionId(), 'playing', 1810));
    // Version B is asked for at 1810 s; version A plays on to 1815 s while B opens.
    const versions = adapter as unknown as Record<string, unknown>;
    let accept = () => {};
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = (id: string) => new Promise(resolve => {
      accept = () => resolve({ ...plan()!, sessionId: id, positionSeconds: 1810, selectedVersionId: 'b', sourceGeneration: 2, seekGeneration: 2 });
    });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const switched = playback.switchVersion(sessionId(), 'b', 1810);
    await flush();
    playback.snapshot(at(sessionId(), 'playing', 1815));
    accept(); await switched;
    expect(plan()?.selectedVersionId).toBe('b');
    // The session fails before version B reports.
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a track reply behind the shown plan only on seek generation still records the selection it confirms', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    // The server takes track changes; the first one's reply is held.
    const server = adapter as unknown as { changeTracks: (id: string, c: any) => Promise<PlaybackPlan>; startPlayback: (r: any) => Promise<PlaybackPlan> };
    const sent: any[] = [];
    let release = () => {};
    server.changeTracks = (id, c) => {
      sent.push(c);
      const reply = { ...plan()!, sessionId: id, selectedAudioTrackId: c.audioTrackId };
      return sent.length > 1 ? Promise.resolve(reply) : new Promise(resolve => { release = () => resolve(reply); });
    };
    // Every session offers both tracks and opens on English.
    const start = server.startPlayback;
    server.startPlayback = async r => ({ ...(await start(r)), audioTracks: [{ id: 'en' }, { id: 'fr' }], selectedAudioTrackId: 'en' } as unknown as PlaybackPlan);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot({ ...at(sessionId(), 'playing', 1815), audioTrackId: 'en' });
    const tracks = playback.command(sessionId(), { kind: 'tracks', audioTrackId: 'fr', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'tracks-fr' });
    await flush();
    // A plan at a newer seek generation, still on French, is shown before the reply; the player fails before it reports again.
    await publish(2, 1815, { audioTracks: [{ id: 'en' }, { id: 'fr' }], selectedAudioTrackId: 'fr' } as Partial<PlaybackPlan>);
    release(); await tracks;
    expect(plan()?.seekGeneration).toBe(2);
    await restart();
    // Recovery asks the replacement for French.
    expect(sent.map(c => c.audioTrackId)).toEqual(['fr', 'fr']);
  }, 1800);
});

test('a track plan on a newer source away from a waiting seek\'s target does not move the restart position when the seek is refused', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { refuse, restore } = refuseSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // A track change is published at 120 s with both generations advanced; the seek is then refused.
    await publish(2, 120, { sourceGeneration: 2 });
    refuse(); await seek;
    restore();
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a track plan on a newer source does not undo an accepted seek before the player presents it', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    await playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    const accepted = plan()!;
    // A track change is published on a newer source, still at the old position, before the player reports.
    await publish(accepted.seekGeneration + 1, 1815, { sourceGeneration: accepted.sourceGeneration + 1 });
    expect(await restart()).toBe(90);
  }, 1800);
});

test('a seek refused while recovery waits takes the restart position back before the replacement is asked for', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { refuse, restore } = refuseSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // A track change is published at the seek's target; the player fails, and the refusal arrives during recovery's wait.
    await publish(2, 90, { sourceGeneration: 2 });
    expect(await restart(async () => { refuse(); await seek; })).toBe(1815);
    restore();
  }, 1800);
});

for (const order of [[0, 1], [1, 0]]) {
  test(`two waiting seeks each matched by a track change and both refused (${order.join(' then ')}) take the restart position back to before them`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
      const { refuse, restore } = refuseSeeks(adapter);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const seeks = [playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' })];
      await flush();
      // Each track change advances both generations, as Ether does.
      await publish(2, 90, { sourceGeneration: 2 });
      seeks.push(playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'seek-120' }));
      await flush();
      await publish(3, 120, { sourceGeneration: 3 });
      for (const index of order) { refuse(index); await seeks[index]; }
      restore();
      expect(await restart()).toBe(1815);
    }, 1800);
  });
}

test('a newer-source plan away from a matched seek\'s target does not keep the restart position once the seek is refused', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { refuse, restore } = refuseSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // A track change matches the seek's target; an unrelated plan on a newer source follows at 120 s; the seek is then refused.
    await publish(2, 90, { sourceGeneration: 2 });
    await publish(3, 120, { sourceGeneration: 3 });
    refuse(); await seek;
    restore();
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a restart retried under the same key after its reply is lost sends the same request again', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter, requests, fire }) => {
    const { refuse, restore } = refuseSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 90, { sourceGeneration: 2 });
    // The replacement's start reaches the server, but its reply is lost.
    const server = adapter as unknown as { startPlayback: (r: any) => Promise<PlaybackPlan> };
    const start = server.startPlayback;
    server.startPlayback = async r => { await start(r); server.startPlayback = start; throw new TypeError('Failed to fetch'); };
    expect(await restart()).toBe(90);
    // The seek is refused before the start is asked for again under the same key.
    refuse(); await seek;
    restore();
    await fire(2000);
    expect(requests.length).toBe(3);
    expect(requests[2]).toEqual(requests[1]);
  }, 1800);
});

// Each seek is held until its reply is released with the plan the server answers with, or until the server refuses it.
function answerSeeks(adapter: { command: (id: string, c: any) => Promise<PlaybackPlan> }) {
  const send = adapter.command;
  const waiting: { accept: (plan: PlaybackPlan) => void; refuse: () => void }[] = [];
  const refusal = new VelaError({ class: 'conflict', code: 'seek_refused', message: 'refused', retry: { allowed: false } }, 409);
  adapter.command = (id, c) => c.kind === 'seek'
    ? new Promise((accept, reject) => { waiting.push({ accept, refuse: () => reject(refusal) }); }) : send(id, c);
  return { waiting, restore: () => { adapter.command = send; } };
}

test('an accepted seek leaves a later matched seek provisional: refused, it goes back to the accepted seek', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 90);
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-120' });
    await flush();
    // A track change at the second seek's target advances both generations, as Ether does.
    await publish(3, 120, { sourceGeneration: 2 });
    // The server accepts the seek to 90 (its reply carries the plan it published for it) and refuses the seek to 120.
    waiting[0]!.accept({ ...plan()!, positionSeconds: 90, sourceGeneration: 1, seekGeneration: 2 }); await first;
    waiting[1]!.refuse(); await second;
    restore();
    expect(await restart()).toBe(90);
  }, 1800);
});

test('a version published before its switch reply ends the old source\'s published seek', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // The held seek's plan is published at 90 s; version B is asked for at 1815 s and published before its reply.
    await publish(2, 90);
    const versions = adapter as unknown as Record<string, unknown>;
    let accept = () => {};
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = (id: string) => new Promise(resolve => {
      accept = () => resolve({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 3, seekGeneration: 3 });
    });
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    await publish(3, 1815, { sourceGeneration: 3, selectedVersionId: 'b' });
    // The switch reply, then the old seek's reply arrive; the session fails before version B reports.
    accept(); await switched;
    waiting[0]!.accept({ ...plan()!, positionSeconds: 90, selectedVersionId: undefined, sourceGeneration: 1, seekGeneration: 2 }); await seek;
    restore();
    expect(plan()?.selectedVersionId).toBe('b');
    expect(await restart()).toBe(1815);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

test('a refused seek does not undo an original-lost reopen', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // A track change is published at the seek's target; the original is then reopened at 1810 s on a newer source.
    await publish(2, 90, { sourceGeneration: 2 });
    const server = adapter as unknown as { sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
    server.sessionSnapshot = async () => ({ plan: { ...plan()!, positionSeconds: 1810, sourceGeneration: 3, seekGeneration: 3 } });
    expect(await playback.originalLost(sessionId(), 1810)).toBe('reopened');
    waiting[0]!.refuse(); await seek;
    restore();
    expect(await restart()).toBe(1810);
  }, 1800);
});

test('a version switch still waiting when its session is replaced does not take a later plan on the new session as its version', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const versions = adapter as unknown as Record<string, unknown>;
    let accept = () => {};
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = (id: string) => new Promise(resolve => {
      accept = () => resolve({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 2, seekGeneration: 2 });
    });
    // The switch to version B on the first session is held; that session recovers into a second one.
    const old = sessionId();
    const switched = playback.switchVersion(old, 'b', 1815);
    await flush();
    expect(await restart()).toBe(1815);
    expect(sessionId()).not.toBe(old);
    // The second session accepts a seek to 90, then publishes an unrelated track change at 1815 that names version B.
    await playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await publish(3, 1815, { sourceGeneration: 3, selectedVersionId: 'b' });
    accept(); await switched;
    expect(await restart()).toBe(90);
  }, 1800);
});

test('a version published while a track change still holds a matched seek moves the restart position to it', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // Two track changes at the seek's target, each advancing both generations.
    await publish(2, 90, { sourceGeneration: 2 });
    await publish(3, 90, { sourceGeneration: 3 });
    const versions = adapter as unknown as Record<string, unknown>;
    let accept = () => {};
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = (id: string) => new Promise(resolve => {
      accept = () => resolve({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 4, seekGeneration: 4 });
    });
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    // Version B is published at 1815 s before its switch reply; the seek is then refused.
    await publish(4, 1815, { sourceGeneration: 4, selectedVersionId: 'b' });
    accept(); await switched;
    waiting[0]!.refuse(); await seek;
    restore();
    expect(await restart()).toBe(1815);
  }, 1800);
});
