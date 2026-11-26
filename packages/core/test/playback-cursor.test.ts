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

test('a pause reply arriving after a resume and a newer plan that only moved the clock does not pause the session again', async () => {
  await watch(async ({ playback, sessionId, publish, plan, adapter }) => {
    const send = adapter.command;
    const release: Record<string, () => void> = {};
    // The server accepts the pause at revision 3 and the resume at 4; both replies are held.
    adapter.command = (id, c) => c.kind === 'pause' || c.kind === 'resume'
      ? new Promise<PlaybackPlan>(resolve => { release[c.kind] = () => resolve({ ...plan()!, sessionId: id, state: c.kind === 'pause' ? 'paused' : 'playing', revision: c.kind === 'pause' ? 3 : 4 } as PlaybackPlan); })
      : send(id, c);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    // Playing is shown at revision 2 (a subtitle added, so not a clock-only plan).
    const shownAt2 = { revision: 2, subtitleTracks: [{ id: 'found' }] } as Partial<PlaybackPlan>;
    await publish(1, 1800, shownAt2);
    expect(plan()?.revision).toBe(2);
    const paused = playback.command(sessionId(), { kind: 'pause', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'pause' });
    const resumed = playback.command(sessionId(), { kind: 'resume', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'resume' });
    await flush();
    // The poll hears the session playing at revision 5, its clock alone moved: the plan on screen stays at 2.
    await publish(1, 1805, { ...shownAt2, revision: 5 });
    expect(plan()?.revision).toBe(2);
    release.pause!(); await paused;
    expect(plan()?.state).toBe('playing');
    release.resume!(); await resumed;
    adapter.command = send;
    expect(plan()?.state).toBe('playing');
  }, 1800);
});

test('a pause reply with no newer plan heard pauses the session', async () => {
  await watch(async ({ playback, sessionId, publish, plan, adapter }) => {
    const send = adapter.command;
    let release = () => {};
    adapter.command = (id, c) => c.kind === 'pause'
      ? new Promise<PlaybackPlan>(resolve => { release = () => resolve({ ...plan()!, sessionId: id, state: 'paused', revision: 3 } as PlaybackPlan); })
      : send(id, c);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    await publish(1, 1800, { revision: 2, subtitleTracks: [{ id: 'found' }] } as Partial<PlaybackPlan>);
    expect(plan()?.revision).toBe(2);
    const paused = playback.command(sessionId(), { kind: 'pause', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'pause' });
    await flush();
    release(); await paused;
    adapter.command = send;
    expect(plan()?.state).toBe('paused');
    expect(plan()?.revision).toBe(3);
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

for (const published of [false, true]) {
  test(`a version switch restarts where the server opened the new version, also when the old one played on meanwhile${published ? ' (B published before its reply)' : ''}`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
      playback.snapshot(at(sessionId(), 'playing', 1810));
      // Version B is asked for at 1810 s; version A plays on to 1815 s while B opens.
      const { accept } = holdSwitch(adapter, plan);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      const switched = playback.switchVersion(sessionId(), 'b', 1810);
      await flush();
      playback.snapshot(at(sessionId(), 'playing', 1815));
      if (published) await publish(2, 1810, { sourceGeneration: 2, selectedVersionId: 'b' });
      // B is taken once: when published first, its later acknowledgment (here at 1815 s) does not move it.
      accept({ positionSeconds: published ? 1815 : 1810, sourceGeneration: 2, seekGeneration: 2 }); await switched;
      expect(plan()?.selectedVersionId).toBe('b');
      // The session fails before version B reports: B was opened at 1810 s.
      expect(await restart()).toBe(1810);
      expect(requests.at(-1).versionId).toBe('b');
    }, 1800);
  });
}

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
  const waiting: { accept: (plan: PlaybackPlan) => void; refuse: () => void; lose: () => void }[] = [];
  const refusal = new VelaError({ class: 'conflict', code: 'seek_refused', message: 'refused', retry: { allowed: false } }, 409);
  adapter.command = (id, c) => c.kind === 'seek'
    ? new Promise((accept, reject) => { waiting.push({ accept, refuse: () => reject(refusal), lose: () => reject(new TypeError('Failed to fetch')) }); }) : send(id, c);
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

// Version B's switch is held: `accept` releases its reply with the given plan fields, `lose` loses it.
function holdSwitch(adapter: object, plan: () => PlaybackPlan | null) {
  const versions = adapter as Record<string, unknown>;
  let reply: (fields: Partial<PlaybackPlan>) => void = () => {};
  let lost = () => {};
  versions.titleVersions = async () => ({ versions: [] });
  versions.clearVersionChoice = async () => {};
  versions.switchVersion = (id: string) => new Promise((resolve, reject) => {
    reply = fields => resolve({ ...plan()!, sessionId: id, selectedVersionId: 'b', ...fields });
    lost = () => reject(new TypeError('Network request failed'));
  });
  return { accept: (fields: Partial<PlaybackPlan>) => reply(fields), lose: () => lost() };
}

test('a version published before its switch reply is the version recovery asks for while the reply is still held', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // On version A, the held seek's plan is published at 90 s; version B is asked for and published at 1815 s.
    await publish(2, 90);
    const { accept } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    await publish(3, 1815, { sourceGeneration: 3, selectedVersionId: 'b' });
    // The session fails while the switch reply is still held.
    expect(await restart()).toBe(1815);
    expect(requests.at(-1).versionId).toBe('b');
    accept({ positionSeconds: 1815, sourceGeneration: 3, seekGeneration: 3 }); await switched;
    waiting[0]!.refuse(); await seek;
    restore();
  }, 1800);
});

for (const published of [false, true]) {
  for (const [late, reply] of [['at its own generations', { sourceGeneration: 3, seekGeneration: 3 }], ['behind them', { sourceGeneration: 2, seekGeneration: 2 }]] as const) {
    test(`a version published at a held seek's target keeps it once the seek is refused and the switch reply ${late} arrives${published ? ' (the seek\'s plan published first)' : ''}`, async () => {
      await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
        const { waiting, restore } = answerSeeks(adapter);
        const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
        playback.snapshot(at(sessionId(), 'playing', 1815));
        const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
        await flush();
        if (published) await publish(2, 90);
        // Version B is asked for at 1815 s and published at the held seek's target before its reply.
        const { accept } = holdSwitch(adapter, plan);
        const switched = playback.switchVersion(sessionId(), 'b', 1815);
        await flush();
        await publish(3, 90, { sourceGeneration: 3, selectedVersionId: 'b' });
        // The seek is refused, then B's switch reply arrives at 1815 s; the session fails before B reports.
        waiting[0]!.refuse(); await seek;
        accept({ positionSeconds: 1815, ...reply }); await switched;
        restore();
        expect(await restart()).toBe(90);
        expect(requests.at(-1).versionId).toBe('b');
      }, 1800);
    });
  }
}

test('an accepted seek moved by the server is where a later matched seek, refused, goes back to', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    // Each held seek is matched by a track change at its target that advances both generations, as Ether does.
    await publish(2, 90, { sourceGeneration: 2 });
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'seek-120' });
    await flush();
    await publish(3, 120, { sourceGeneration: 3 });
    // The server accepts the seek to 90 at 91 s and refuses the seek to 120.
    waiting[0]!.accept({ ...plan()!, positionSeconds: 91, sourceGeneration: 2, seekGeneration: 2 }); await first;
    waiting[1]!.refuse(); await second;
    restore();
    expect(await restart()).toBe(91);
  }, 1800);
});

// The server answers the seek to 90 at 91 s, so no published plan is matched to it; a track change at 120 s
// then matches the second seek, which the server refuses.
for (const [order, expected] of [['released after the track change', 91], ['released before the second seek', 91], ['released after the second seek is refused', 91], ['lost', 1815]] as const) {
  test(`an accepted seek the server moved, its plan unmatched and its reply ${order}, is where a later matched seek, refused, goes back to`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
      const { waiting, restore } = answerSeeks(adapter);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
      await flush();
      // The seek's plan advances the seek generation only, as Ether does.
      await publish(2, 91);
      const reply = { ...plan()! };
      const answer = () => order === 'lost' ? waiting[0]!.lose() : waiting[0]!.accept(reply);
      if (order === 'released before the second seek') { answer(); await first; }
      const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-120' });
      await flush();
      // A track change advances both generations.
      await publish(3, 120, { sourceGeneration: 2 });
      if (order === 'released after the track change' || order === 'lost') { answer(); await first; }
      waiting[1]!.refuse(); await second;
      if (order === 'released after the second seek is refused') { answer(); await first; }
      restore();
      expect(await restart()).toBe(expected);
    }, 1800);
  });
}

for (const state of ['playing', 'paused'] as const) for (const tagged of [true, false]) {
  test(`a ${state} report${tagged ? '' : ' without a seek generation'} after the plan of a seek the server moved is newer than that seek's late reply when a later matched seek is refused`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
      const { waiting, restore } = answerSeeks(adapter);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
      await flush();
      await publish(2, 91);
      const reply = { ...plan()! };
      // The player presents 95 s at the seek's generations (or without a seek generation) before the reply arrives.
      playback.snapshot(tagged ? { ...at(sessionId(), state, 95), seekGeneration: 2 } : { sessionId: sessionId(), live: null, state, position: 95, sourceGeneration: 1 });
      const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-120' });
      await flush();
      await publish(3, 120, { sourceGeneration: 2 });
      waiting[0]!.accept(reply); await first;
      waiting[1]!.refuse(); await second;
      restore();
      expect(await restart()).toBe(95);
    }, 1800);
  });
}

// Seeks to 60, 90 and 120: the first answered at 60 (its plan matched) or at 61, the second at 91, the third matched
// by a track change and refused.
for (const first of [60, 61]) {
  for (const order of [[0, 1], [1, 0]]) {
    test(`of two accepted seeks, the newer is where a later matched seek, refused, goes back to (first at ${first}, replies ${order.join(' then ')})`, async () => {
      await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
        const { waiting, restore } = answerSeeks(adapter);
        const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
        playback.snapshot(at(sessionId(), 'playing', 1815));
        const seeks = [], replies: PlaybackPlan[] = [];
        for (const [i, [target, published]] of ([[60, first], [90, 91]] as const).entries()) {
          seeks.push(playback.command(sessionId(), { kind: 'seek', positionSeconds: target, sourceGeneration: 1, seekGeneration: i + 1, idempotencyKey: `seek-${target}` }));
          await flush();
          await publish(i + 2, published);
          replies.push({ ...plan()! });
        }
        const last = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 3, idempotencyKey: 'seek-120' });
        await flush();
        await publish(4, 120, { sourceGeneration: 2 });
        for (const i of order) { waiting[i]!.accept(replies[i]!); await seeks[i]; }
        waiting[2]!.refuse(); await last;
        restore();
        expect(await restart()).toBe(91);
      }, 1800);
    });
  }
}

for (const between of ['another title is opened', 'the session is replaced by recovery']) {
  test(`a late reply of a seek the server moved does not move the restart position once ${between}`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
      const { waiting, restore } = answerSeeks(adapter);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
      await flush();
      await publish(2, 91);
      const reply = { ...plan()! };
      const old = sessionId();
      let expected = 1815;
      // The next session's first snapshot is its own start plan.
      const snapshots = adapter as unknown as { sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
      snapshots.sessionSnapshot = async id => ({ plan: { ...reply, sessionId: id, positionSeconds: between === 'another title is opened' ? 1800 : 1815, sourceGeneration: 1, seekGeneration: 1 } });
      if (between === 'another title is opened') {
        await playback.start({ kind: 'title', id: 'other', positionSeconds: 1800 });
        await flush();
        playback.snapshot(at(sessionId(), 'playing', 1802));
        expected = 1802;
      } else expect(await restart()).toBe(1815);
      expect(sessionId()).not.toBe(old);
      const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-120' });
      await flush();
      await publish(2, 120, { sourceGeneration: 2 });
      waiting[0]!.accept(reply); await first;
      waiting[1]!.refuse(); await second;
      restore();
      expect(await restart()).toBe(expected);
    }, 1800);
  });
}

test('a late reply of a seek the server moved does not move the restart position once the viewer took another version', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 91);
    const reply = { ...plan()! };
    await publish(3, 1815, { sourceGeneration: 2 });
    const versions = adapter as unknown as Record<string, unknown>;
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = async (id: string) => ({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 3, seekGeneration: 4 });
    await playback.switchVersion(sessionId(), 'b', 1815);
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 3, seekGeneration: 4, idempotencyKey: 'seek-120' });
    await flush();
    await publish(5, 120, { sourceGeneration: 4, selectedVersionId: 'b' });
    waiting[0]!.accept(reply); await first;
    waiting[1]!.refuse(); await second;
    restore();
    expect(await restart()).toBe(1815);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

for (const [late, reply] of [['', undefined], [' and its switch reply arrives', { sourceGeneration: 3, seekGeneration: 3 }]] as const) {
  test(`a version published at a held seek's target stays the restart position through a report at the old place${late}`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
      const { waiting, restore } = answerSeeks(adapter);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
      await flush();
      const { accept } = holdSwitch(adapter, plan);
      const switched = playback.switchVersion(sessionId(), 'b', 1815);
      await flush();
      // Version B is published at the held seek's target; the player, opening B, still reports its old clock.
      await publish(3, 90, { sourceGeneration: 3, selectedVersionId: 'b' });
      playback.snapshot({ ...at(sessionId(), 'buffering', 1815), sourceGeneration: 3, seekGeneration: 3 });
      if (reply) { accept({ positionSeconds: 1815, ...reply }); await switched; }
      expect(await restart()).toBe(90);
      expect(requests.at(-1).versionId).toBe('b');
      if (!reply) { accept({ positionSeconds: 1815, sourceGeneration: 3, seekGeneration: 3 }); await switched; }
      waiting[0]!.refuse(); await seek;
      restore();
    }, 1800);
  });
}

test('a version published at a held seek\'s target stays the restart position through an older switch reply and an old report', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    const { accept } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    await publish(3, 90, { sourceGeneration: 3, selectedVersionId: 'b' });
    // B's switch reply comes behind the plan shown, then a late report from version A at 1815 s.
    accept({ positionSeconds: 1815, sourceGeneration: 2, seekGeneration: 2 }); await switched;
    playback.snapshot({ ...at(sessionId(), 'playing', 1815), sourceGeneration: 2, seekGeneration: 2 });
    expect(await restart()).toBe(90);
    expect(requests.at(-1).versionId).toBe('b');
    waiting[0]!.refuse(); await seek;
    restore();
  }, 1800);
});

test('a reopened original stays the restart position through a report at the old place', async () => {
  await watch(async ({ playback, sessionId, restart, plan, adapter }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const server = adapter as unknown as { sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
    server.sessionSnapshot = async () => ({ plan: { ...plan()!, positionSeconds: 1810, sourceGeneration: 2, seekGeneration: 3 } });
    expect(await playback.originalLost(sessionId(), 1810)).toBe('reopened');
    // The player, reopening the original, still reports its old clock under the new generations.
    playback.snapshot({ ...at(sessionId(), 'buffering', 1815), sourceGeneration: 2, seekGeneration: 3 });
    expect(await restart()).toBe(1810);
  }, 1800);
});

test('a version published after its switch reply was lost is the version recovery asks for', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const { lose } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815).catch(() => undefined);
    await flush();
    // The reply is lost on the way back; the server did switch and publishes version B.
    lose(); await switched;
    await publish(2, 1815, { sourceGeneration: 2, selectedVersionId: 'b' });
    expect(await restart()).toBe(1815);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

test('a switch reply behind the version shown does not take it back', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const versions = adapter as unknown as Record<string, unknown>;
    const replies: Record<string, (fields: Partial<PlaybackPlan>) => void> = {};
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = (id: string, c: { versionId: string }) => new Promise(resolve => {
      replies[c.versionId] = fields => resolve({ ...plan()!, sessionId: id, selectedVersionId: c.versionId, ...fields });
    });
    const toB = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    await publish(2, 1815, { sourceGeneration: 2, selectedVersionId: 'b' });
    playback.snapshot({ ...at(sessionId(), 'playing', 1820), sourceGeneration: 2, seekGeneration: 2 });
    const toC = playback.switchVersion(sessionId(), 'c', 1820);
    await flush();
    await publish(3, 1820, { sourceGeneration: 3, selectedVersionId: 'c' });
    // B's reply arrives after version C is shown.
    replies.b!({ positionSeconds: 1815, sourceGeneration: 2, seekGeneration: 2 }); await toB;
    expect(plan()?.selectedVersionId).toBe('c');
    expect(await restart()).toBe(1820);
    expect(requests.at(-1).versionId).toBe('c');
    replies.c!({ positionSeconds: 1820, sourceGeneration: 3, seekGeneration: 3 }); await toC;
  }, 1800);
});

test('a switch reply arriving after a seek on its version does not put the older plan back', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const { accept } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    await publish(2, 1815, { sourceGeneration: 2, selectedVersionId: 'b' });
    // A seek on version B is accepted; then B's switch reply arrives.
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'seek-90' });
    await flush();
    waiting[0]!.accept({ ...plan()!, positionSeconds: 90, sourceGeneration: 2, seekGeneration: 3 }); await seek;
    restore();
    accept({ positionSeconds: 1815, sourceGeneration: 2, seekGeneration: 2 }); await switched;
    expect(plan()?.seekGeneration).toBe(3);
    expect(plan()?.positionSeconds).toBe(90);
    expect(await restart()).toBe(90);
  }, 1800);
});

test('a version published before its switch reply brings its own tracks when that reply then comes behind the plan shown', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    // The server takes track changes; every replacement offers both audio tracks and opens on track 1.
    const server = adapter as unknown as { changeTracks: (id: string, c: any) => Promise<PlaybackPlan>; startPlayback: (r: any) => Promise<PlaybackPlan> };
    const sent: any[] = [];
    server.changeTracks = async (id, c) => { sent.push(c); return { ...plan()!, sessionId: id, selectedAudioTrackId: c.audioTrackId }; };
    const start = server.startPlayback;
    server.startPlayback = async r => ({ ...(await start(r)), audioTracks: [{ id: '1' }, { id: '2' }], selectedAudioTrackId: '1' } as unknown as PlaybackPlan);
    // Audio track 1 is the one remembered on version A.
    playback.snapshot({ ...at(sessionId(), 'playing', 1815), audioTrackId: '1' });
    const { accept } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    // Version B is published selecting audio track 2, before its switch reply.
    const audioTracks = [{ id: '1' }, { id: '2' }] as unknown as PlaybackPlan['audioTracks'];
    await publish(2, 1815, { sourceGeneration: 2, selectedVersionId: 'b', audioTracks, selectedAudioTrackId: '2' });
    // A seek on B is accepted; B's switch reply then comes behind the plan shown.
    const { waiting, restore } = answerSeeks(adapter);
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'seek-90' });
    await flush();
    waiting[0]!.accept({ ...plan()!, positionSeconds: 90, sourceGeneration: 2, seekGeneration: 3 }); await seek;
    restore();
    accept({ positionSeconds: 1815, sourceGeneration: 2, seekGeneration: 2, audioTracks, selectedAudioTrackId: '2' }); await switched;
    expect(await restart()).toBe(90);
    expect(requests.at(-1).versionId).toBe('b');
    // Recovery asks the replacement for B's track 2.
    expect(sent.map(c => c.audioTrackId)).toEqual(['2']);
  }, 1800);
});

test('a switch to the version already shown, its reply lost, does not take an unrelated plan as that version', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    await publish(1, 1815, { selectedVersionId: 'a' });
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const { lose } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'a', 1815).catch(() => undefined);
    await flush();
    lose(); await switched;
    // A held seek to 90 s is matched by an unrelated track change there, then refused.
    const { waiting, restore } = answerSeeks(adapter);
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 90, { sourceGeneration: 2, selectedVersionId: 'a' });
    waiting[0]!.refuse(); await seek;
    restore();
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a refused matched seek does not hide a newer accepted seek the server moved', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // Seeks to 90 and 100 are held; the server publishes each one second on (the seek generation alone advances).
    const seeks: Promise<boolean>[] = [], replies: PlaybackPlan[] = [];
    for (const [i, target] of [90, 100].entries()) {
      seeks.push(playback.command(sessionId(), { kind: 'seek', positionSeconds: target, sourceGeneration: 1, seekGeneration: i + 1, idempotencyKey: `seek-${target}` }));
      await flush();
      await publish(i + 2, target + 1);
      replies.push({ ...plan()! });
    }
    // A seek to 120 is matched by a track change there (both generations advance), the 91 reply is released and
    // the 120 seek refused; then the same with 150 and the 101 reply.
    for (const [i, [target, source, seek]] of ([[120, 2, 4], [150, 3, 5]] as const).entries()) {
      const matched = playback.command(sessionId(), { kind: 'seek', positionSeconds: target, sourceGeneration: source - 1, seekGeneration: seek - 1, idempotencyKey: `seek-${target}` });
      await flush();
      await publish(seek, target, { sourceGeneration: source });
      waiting[i]!.accept(replies[i]!); await seeks[i];
      waiting[i + 2]!.refuse(); await matched;
    }
    restore();
    expect(await restart()).toBe(101);
  }, 1800);
});

test('a seek with neither its reply nor its plan in when the session fails restarts at the earlier position', async () => {
  await watch(async ({ playback, sessionId, restart, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    expect(await restart()).toBe(1815);
    waiting[0]!.refuse(); await seek;
    restore();
  }, 1800);
});

test('a scrub while an accepted seek is still buffering is not taken until it plays', async () => {
  await watch(async ({ playback, sessionId, restart, plan }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    await playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    const shown = plan()!;
    playback.snapshot({ ...at(sessionId(), 'buffering', 300), sourceGeneration: shown.sourceGeneration, seekGeneration: shown.seekGeneration });
    expect(await restart()).toBe(90);
  }, 1800);
});

for (const [state, expected] of [['buffering', 1815], ['paused', 0]] as const) {
  test(`a seek to zero the player makes on its own, reported ${state}, restarts at ${expected}`, async () => {
    await watch(async ({ playback, sessionId, restart }) => {
      playback.snapshot(at(sessionId(), 'playing', 1815));
      playback.snapshot(at(sessionId(), state, 0));
      expect(await restart()).toBe(expected);
    }, 1800);
  });
}

test('a seek the server answers away from its target restarts at the earlier position while its reply is held', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 91);
    const reply = { ...plan()! };
    expect(await restart()).toBe(1815);
    waiting[0]!.accept(reply); await seek;
    restore();
  }, 1800);
});

// The server accepts the seek to 120 first (seek generation 2) and the seek to 90 last (3); the plan for 90 is published first.
for (const replied of [false, true]) {
  test(`two seeks the server accepted in the other order, their plans published in reverse, restart at the one it accepted last${replied ? ' once both replies are in' : ''}`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
      const { waiting, restore } = answerSeeks(adapter);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const seeks = [90, 120].map(target => playback.command(sessionId(), { kind: 'seek', positionSeconds: target, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: `seek-${target}` }));
      await flush();
      await publish(3, 90);
      const last = { ...plan()! };
      await publish(2, 120);
      const first = { ...plan()! };
      if (replied) {
        waiting[1]!.accept(first); await seeks[1];
        waiting[0]!.accept(last); await seeks[0];
      }
      expect(await restart()).toBe(90);
      if (!replied) { waiting[1]!.accept(first); waiting[0]!.accept(last); await Promise.all(seeks); }
      restore();
    }, 1800);
  });
}

test('a version published at the target of a seek the server refused restarts there on that version', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    const { accept } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    // The seek is refused; version B is then published at its target.
    waiting[0]!.refuse(); await seek;
    await publish(3, 90, { sourceGeneration: 3, selectedVersionId: 'b' });
    expect(await restart()).toBe(90);
    expect(requests.at(-1).versionId).toBe('b');
    accept({ positionSeconds: 90, sourceGeneration: 3, seekGeneration: 3 }); await switched;
    restore();
  }, 1800);
});

test('a seek whose reply is lost and whose plan is published only afterwards is not followed', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    waiting[0]!.lose(); await seek;
    await publish(2, 90);
    restore();
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('an accepted seek with no plan of its own is where recovery goes after a later matched seek was refused', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seeks = [90, 120].map(target => playback.command(sessionId(), { kind: 'seek', positionSeconds: target, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: `seek-${target}` }));
    await flush();
    // Only a track change at 120 s is published (both generations advance); the 120 seek is refused, then the 90 reply arrives.
    await publish(3, 120, { sourceGeneration: 2 });
    waiting[1]!.refuse(); await seeks[1];
    waiting[0]!.accept({ ...plan()!, positionSeconds: 90, sourceGeneration: 1, seekGeneration: 2 }); await seeks[0];
    restore();
    expect(await restart()).toBe(90);
  }, 1800);
});

test('a reopen published while the original-lost read is in flight is not taken as the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const server = adapter as unknown as { sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
    let release = () => {};
    server.sessionSnapshot = () => new Promise(resolve => { release = () => resolve({ plan: { ...plan()!, positionSeconds: 1810, sourceGeneration: 2, seekGeneration: 2 } }); });
    const lost = playback.originalLost(sessionId(), 1810);
    await flush();
    await publish(2, 1810, { sourceGeneration: 2 });
    release();
    expect(await lost).toBe('superseded');
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a version taken after an accepted seek, a lost seek reply and a track change restarts where the version opened', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    waiting[0]!.accept({ ...plan()!, positionSeconds: 90, sourceGeneration: 1, seekGeneration: 2 }); await first;
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-120' });
    await flush();
    waiting[1]!.lose(); await second;
    restore();
    await publish(3, 95, { sourceGeneration: 2 });
    const versions = adapter as unknown as Record<string, unknown>;
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = async (id: string) => ({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 3, seekGeneration: 4 });
    await playback.switchVersion(sessionId(), 'b', 1815);
    expect(await restart()).toBe(1815);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

test('an accepted seek the server moved stays the restart position through buffering elsewhere after a later matched seek was refused', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 91);
    const reply = { ...plan()! };
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-120' });
    await flush();
    await publish(3, 120, { sourceGeneration: 2 });
    waiting[0]!.accept(reply); await first;
    waiting[1]!.refuse(); await second;
    restore();
    playback.snapshot({ ...at(sessionId(), 'buffering', 94), sourceGeneration: 2, seekGeneration: 3 });
    expect(await restart()).toBe(91);
  }, 1800);
});

test('a seek accepted while recovery waits is where the replacement opens; a version confirmed then is not asked for', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 91);
    const reply = { ...plan()! };
    const { accept } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    // The session fails; the seek's reply (at 91 s) and B's switch reply arrive while recovery waits.
    expect(await restart(async () => {
      waiting[0]!.accept(reply); await seek;
      accept({ positionSeconds: 1815, sourceGeneration: 3, seekGeneration: 3 }); await switched;
    })).toBe(91);
    expect(requests.at(-1).versionId).toBeUndefined();
    restore();
  }, 1800);
});

test('a track reply arriving after a plan on a newer source is shown does not record its selection', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const server = adapter as unknown as { changeTracks: (id: string, c: any) => Promise<PlaybackPlan>; startPlayback: (r: any) => Promise<PlaybackPlan> };
    const sent: any[] = [];
    let release = () => {};
    server.changeTracks = (id, c) => {
      sent.push(c);
      const reply = { ...plan()!, sessionId: id, selectedAudioTrackId: c.audioTrackId };
      return sent.length > 1 ? Promise.resolve(reply) : new Promise(resolve => { release = () => resolve(reply); });
    };
    const start = server.startPlayback;
    server.startPlayback = async r => ({ ...(await start(r)), audioTracks: [{ id: 'en' }, { id: 'fr' }], selectedAudioTrackId: 'en' } as unknown as PlaybackPlan);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot({ ...at(sessionId(), 'playing', 1815), audioTrackId: 'en' });
    const tracks = playback.command(sessionId(), { kind: 'tracks', audioTrackId: 'fr', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'tracks-fr' });
    await flush();
    await publish(2, 1815, { sourceGeneration: 2, audioTracks: [{ id: 'en' }, { id: 'fr' }], selectedAudioTrackId: 'en' } as Partial<PlaybackPlan>);
    release(); await tracks;
    await restart();
    expect(sent.map(c => c.audioTrackId)).toEqual(['fr']);
  }, 1800);
});

test('a switch whose request was lost, followed by a reopen that names its version, restarts on that version where it opened', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const { lose } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815).catch(() => undefined);
    await flush();
    lose(); await switched;
    // Under automatic selection the original reopens on other files, and the server names version B.
    await publish(2, 1810, { sourceGeneration: 2, selectedVersionId: 'b' });
    expect(await restart()).toBe(1810);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

test('once a matched seek is refused, a buffering report at the track change\'s generations moves the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, publish, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 90, { sourceGeneration: 2 });
    waiting[0]!.refuse(); await seek;
    restore();
    // The player buffers on the track change's source at its own clock.
    playback.snapshot({ ...at(sessionId(), 'buffering', 1830), sourceGeneration: 2, seekGeneration: 2 });
    expect(await restart()).toBe(1830);
  }, 1800);
});

test('a seek the previous title\'s session answers after another title is opened does not move the new title\'s restart position', async () => {
  await watch(async ({ playback, sessionId, restart, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const old = sessionId();
    const reply = { ...plan()!, positionSeconds: 90, seekGeneration: 12 };
    await playback.start({ kind: 'title', id: 'other', positionSeconds: 1800 });
    await flush();
    expect(sessionId()).not.toBe(old);
    // A seek queued on the previous title is sent only now; that session still answers it.
    const seek = playback.command(old, { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 11, idempotencyKey: 'seek-90' });
    await flush();
    waiting[0]!.accept(reply); await seek;
    restore();
    playback.snapshot(at(sessionId(), 'playing', 1803));
    expect(await restart()).toBe(1803);
  }, 1800);
});

test('a version still waiting for its lost switch reply is taken from a track reply that shows it', async () => {
  await watch(async ({ playback, sessionId, restart, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a', positionSeconds: 1800 });
    await flush();
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const { lose } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815).catch(() => undefined);
    await flush();
    lose(); await switched;
    // The server did switch: a track change's reply shows version B; the session fails before the next poll.
    const server = adapter as unknown as { changeTracks: (id: string, c: any) => Promise<PlaybackPlan> };
    server.changeTracks = async id => ({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 2, seekGeneration: 2 });
    await playback.command(sessionId(), { kind: 'tracks', audioTrackId: 'fr', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'tracks-fr' });
    expect(await restart()).toBe(1815);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

test('a delayed plan from before the version shown does not count as the version a later switch asks for', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const versions = adapter as unknown as Record<string, unknown>;
    const refusal = new VelaError({ class: 'conflict', code: 'version_refused', message: 'refused', retry: { allowed: false } }, 409);
    let refuse = () => {};
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    versions.switchVersion = (id: string, c: { versionId: string }) => c.versionId === 'b'
      ? Promise.resolve({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 2, seekGeneration: 2 })
      : new Promise((_, reject) => { refuse = () => reject(refusal); });
    await playback.switchVersion(sessionId(), 'b', 1815);
    playback.snapshot({ ...at(sessionId(), 'playing', 1820), sourceGeneration: 2, seekGeneration: 2 });
    // Version A is asked for again; a delayed plan of A from before B arrives, then the switch is refused.
    const toA = playback.switchVersion(sessionId(), 'a', 1820).catch(() => undefined);
    await flush();
    await publish(1, 1815, { sourceGeneration: 1, selectedVersionId: 'a' });
    refuse(); await toA;
    await publish(2, 1820, { sourceGeneration: 2, selectedVersionId: 'b' });
    expect(await restart()).toBe(1820);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

test('a version_unavailable answer to the original-lost read is newer than a seek reply from before it', async () => {
  await watch(async ({ playback, sessionId, restart, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    const reply = { ...plan()!, positionSeconds: 90, sourceGeneration: 1, seekGeneration: 2 };
    const server = adapter as unknown as { sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
    server.sessionSnapshot = async () => ({ plan: { ...plan()!, positionSeconds: 1815, sourceFailure: 'version_unavailable', sourceGeneration: 2, seekGeneration: 3 } as PlaybackPlan });
    expect(await playback.originalLost(sessionId(), 1815)).toBe('version_unavailable');
    // The seek's accepted reply, from before that answer, arrives only now.
    waiting[0]!.accept(reply); await seek;
    restore();
    expect(await restart()).toBe(1815);
  }, 1800);
});

for (const answer of ['accepted', 'lost'] as const) {
  test(`after a matched track change is refused, buffering at its generations stays out once the earlier matched seek is ${answer}`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
      const { waiting, restore } = answerSeeks(adapter);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
      await flush();
      await publish(2, 90);
      const reply = { ...plan()! };
      const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-120' });
      await flush();
      await publish(3, 120, { sourceGeneration: 2 });
      waiting[1]!.refuse(); await second;
      if (answer === 'accepted') waiting[0]!.accept(reply); else waiting[0]!.lose();
      await first;
      restore();
      // The player buffers at its old clock under the track change's generations.
      playback.snapshot({ ...at(sessionId(), 'buffering', 1815), sourceGeneration: 2, seekGeneration: 3 });
      expect(await restart()).toBe(90);
    }, 1800);
  });
}

for (const position of [94, 300]) {
  test(`after an accepted seek, a buffering report at ${position} without generations is not taken`, async () => {
    await watch(async ({ playback, sessionId, restart }) => {
      playback.snapshot(at(sessionId(), 'playing', 1815));
      await playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
      playback.snapshot({ sessionId: sessionId(), live: null, state: 'buffering', position });
      expect(await restart()).toBe(90);
    }, 1800);
  });
}

// A refresh whose snapshot read is held until `release` hands it the plan the server had when it was read.
async function holdRefresh(playback: Playback, adapter: object, sessionId: string) {
  const server = adapter as { sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
  const read = server.sessionSnapshot;
  let release: (plan: PlaybackPlan) => void = () => {};
  server.sessionSnapshot = () => new Promise(resolve => { release = plan => resolve({ plan }); });
  const refreshed = playback.refresh(sessionId);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  server.sessionSnapshot = read;
  return { release: async (plan: PlaybackPlan) => { release(plan); await refreshed; } };
}

test('a delayed refresh of an older version does not let an old command reply take a version back', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const onA = { ...plan()!, positionSeconds: 1815, selectedVersionId: 'a' };
    const refresh = await holdRefresh(playback, adapter, sessionId());
    const versions = adapter as unknown as Record<string, unknown>;
    versions.titleVersions = async () => ({ versions: [] });
    versions.clearVersionChoice = async () => {};
    // B is taken at (2,2) and C at (3,3); the second request for B is lost.
    let lose = () => {}, toBCalls = 0;
    versions.switchVersion = (id: string, c: { versionId: string }) => c.versionId === 'c'
      ? Promise.resolve({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'c', sourceGeneration: 3, seekGeneration: 3 })
      : ++toBCalls === 1 ? Promise.resolve({ ...plan()!, sessionId: id, positionSeconds: 1815, selectedVersionId: 'b', sourceGeneration: 2, seekGeneration: 2 })
        : new Promise((_, reject) => { lose = () => reject(new TypeError('Network request failed')); });
    await playback.switchVersion(sessionId(), 'b', 1815);
    // A pause on B, its reply held.
    const send = adapter.command;
    let releasePause = () => {};
    const onB = { ...plan()! };
    adapter.command = (id, c) => c.kind === 'pause' ? new Promise(resolve => { releasePause = () => resolve({ ...onB, sessionId: id, state: 'paused' } as PlaybackPlan); }) : send(id, c);
    const paused = playback.command(sessionId(), { kind: 'pause', sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'pause' });
    await flush();
    await playback.switchVersion(sessionId(), 'c', 1815);
    playback.snapshot({ ...at(sessionId(), 'playing', 1820), sourceGeneration: 3, seekGeneration: 3 });
    // The refresh read on A arrives; B is asked for again and that request is lost before the server takes it.
    await refresh.release(onA);
    const toB = playback.switchVersion(sessionId(), 'b', 1820).catch(() => undefined);
    await flush();
    lose(); await toB;
    // B's old pause reply arrives, the server publishes C as it is, and the session fails.
    releasePause(); await paused;
    adapter.command = send;
    await publish(3, 1820, { sourceGeneration: 3, selectedVersionId: 'c' });
    expect(await restart()).toBe(1820);
    expect(requests.at(-1).versionId).toBe('c');
  }, 1800);
});

test('a delayed refresh from before a refused track change does not let an old report replace an accepted seek', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 90);
    const reply = { ...plan()! };
    const refresh = await holdRefresh(playback, adapter, sessionId());
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'seek-120' });
    await flush();
    await publish(3, 120, { sourceGeneration: 2 });
    waiting[1]!.refuse(); await second;
    waiting[0]!.accept(reply); await first;
    restore();
    // The refresh read at (1,2) arrives, then buffering at the old clock under those generations.
    await refresh.release(reply);
    playback.snapshot({ ...at(sessionId(), 'buffering', 1815), seekGeneration: 2 });
    expect(await restart()).toBe(90);
  }, 1800);
});

test('a delayed refresh does not let a republished track change match a repeated seek a second time', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const before = { ...plan()!, positionSeconds: 1815 };
    const refresh = await holdRefresh(playback, adapter, sessionId());
    const first = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 90, { sourceGeneration: 2 });
    // The refresh read at (1,1) arrives; the seek to 90 is sent again against the plan shown, and the same track plan is published again.
    await refresh.release(before);
    const second = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: plan()!.sourceGeneration, seekGeneration: plan()!.seekGeneration, idempotencyKey: 'seek-90-again' });
    await flush();
    await publish(2, 90, { sourceGeneration: 2 });
    // The first seek is refused; the session fails before the second one's reply.
    waiting[0]!.refuse(); await first;
    expect(await restart()).toBe(1815);
    waiting[1]!.refuse(); await second;
    restore();
  }, 1800);
});

// The server answers each switch to version B, C, … with that version at the given plan fields, refuses it, or loses its reply.
function holdSwitches(adapter: object, plan: () => PlaybackPlan | null) {
  const versions = adapter as Record<string, unknown>;
  const waiting: Record<string, { accept: (fields: Partial<PlaybackPlan>) => void; refuse: () => void; lose: () => void }> = {};
  const refusal = new VelaError({ class: 'conflict', code: 'version_refused', message: 'refused', retry: { allowed: false } }, 409);
  versions.titleVersions = async () => ({ versions: [] });
  versions.clearVersionChoice = async () => {};
  versions.switchVersion = (id: string, c: { versionId: string }) => new Promise((resolve, reject) => {
    waiting[c.versionId] = {
      accept: fields => resolve({ ...plan()!, sessionId: id, selectedVersionId: c.versionId, ...fields }),
      refuse: () => reject(refusal),
      lose: () => reject(new TypeError('Network request failed')),
    };
  });
  return waiting;
}

test('taking a version after both restarts are spent gives a fresh restart budget, also when its switch reply comes behind a newer plan', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    expect(await restart()).toBe(1815);
    expect(await restart()).toBe(1815);
    // Both restarts are spent. Version B is published, then a newer plan for B, then B's older switch reply arrives.
    const { accept } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    await publish(2, 1810, { sourceGeneration: 2, selectedVersionId: 'b' });
    await publish(3, 1810, { sourceGeneration: 2, selectedVersionId: 'b' });
    accept({ positionSeconds: 1810, sourceGeneration: 2, seekGeneration: 2 }); await switched;
    // The session fails: a replacement starts on B.
    expect(await restart()).toBe(1810);
    expect(requests.at(-1).versionId).toBe('b');
    // The fresh budget is spent like any other: one more restart, then the viewer is told.
    expect(await restart()).toBe(1810);
    playback.recover(sessionId());
    expect(sessionId()).toBe('');
  }, 1800);
});

test('a recovery\'s own replacement on the version taken does not give a fresh restart budget', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const server = adapter as unknown as { startPlayback: (r: any) => Promise<PlaybackPlan> };
    const start = server.startPlayback;
    server.startPlayback = async r => ({ ...(await start(r)), selectedVersionId: r.versionId });
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const { accept } = holdSwitch(adapter, plan);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    accept({ positionSeconds: 1815, sourceGeneration: 2, seekGeneration: 2 }); await switched;
    expect(await restart()).toBe(1815);
    expect(await restart()).toBe(1815);
    expect(requests.at(-1).versionId).toBe('b');
    // The replacement names B, and a newer plan for B is published on it: both restarts stay spent.
    await publish(2, 1815, { sourceGeneration: 2, selectedVersionId: 'b' });
    playback.recover(sessionId());
    expect(sessionId()).toBe('');
  }, 1800);
});

test('an original reopened after both restarts are spent does not give a fresh restart budget', async () => {
  await watch(async ({ playback, sessionId, restart, plan, adapter }) => {
    playback.snapshot(at(sessionId(), 'playing', 1815));
    expect(await restart()).toBe(1815);
    expect(await restart()).toBe(1815);
    const server = adapter as unknown as { sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
    server.sessionSnapshot = async () => ({ plan: { ...plan()!, positionSeconds: 1810, sourceGeneration: 3, seekGeneration: 3 } });
    expect(await playback.originalLost(sessionId(), 1810)).toBe('reopened');
    playback.recover(sessionId());
    expect(sessionId()).toBe('');
  }, 1800);
});

test('a buffering report at the old position under an accepted seek\'s new generations does not outrank its reply', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // At 1815 s, a seek to 90; the server's adjusted plan is published at 91.
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 91);
    const reply = { ...plan()! };
    // Buffering at 1815 s under the new generations, then the accepted 91 s reply.
    playback.snapshot({ ...at(sessionId(), 'buffering', 1815), sourceGeneration: reply.sourceGeneration, seekGeneration: reply.seekGeneration });
    waiting[0]!.accept(reply); await seek;
    restore();
    expect(await restart()).toBe(91);
  }, 1800);
});

for (const [answer, expected] of [['refused', 300], ['accepted', 91]] as const) {
  test(`a buffering report under a seek's new generations before its reply restarts at ${expected} once the seek is ${answer}`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
      const { waiting, restore } = answerSeeks(adapter);
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
      await flush();
      await publish(2, 91);
      const reply = { ...plan()! };
      playback.snapshot({ ...at(sessionId(), 'buffering', 300), sourceGeneration: reply.sourceGeneration, seekGeneration: reply.seekGeneration });
      if (answer === 'accepted') waiting[0]!.accept(reply); else waiting[0]!.refuse();
      await seek;
      restore();
      expect(await restart()).toBe(expected);
    }, 1800);
  });
}

test('a buffering report at the old position under an adjusted seek\'s new generations stands once that seek is refused', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 91);
    const shown = plan()!;
    playback.snapshot({ ...at(sessionId(), 'buffering', 1815), sourceGeneration: shown.sourceGeneration, seekGeneration: shown.seekGeneration });
    waiting[0]!.refuse(); await seek;
    restore();
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a buffering report under new generations no seek asked for moves the restart position', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan }) => {
    await publish(2, 91);
    const shown = plan()!;
    playback.snapshot({ ...at(sessionId(), 'buffering', 1815), sourceGeneration: shown.sourceGeneration, seekGeneration: shown.seekGeneration });
    expect(await restart()).toBe(1815);
  }, 1800);
});

test('a playing report under an adjusted seek\'s new generations while the seek waits is newer than its reply', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter }) => {
    const { waiting, restore } = answerSeeks(adapter);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'seek-90' });
    await flush();
    await publish(2, 91);
    const reply = { ...plan()! };
    // The viewer scrubs locally to 95 s; the player plays there under the new generations.
    playback.snapshot({ ...at(sessionId(), 'playing', 95), sourceGeneration: reply.sourceGeneration, seekGeneration: reply.seekGeneration });
    expect(await restart(async () => { waiting[0]!.accept(reply); await seek; })).toBe(95);
    restore();
  }, 1800);
});

test('a refused version switch does not erase an earlier switch whose reply was lost', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a', positionSeconds: 1800 });
    await flush();
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // On A at 1815 s: the server accepts B at 1810 s and the reply is lost; C is refused; then B is published.
    const switches = holdSwitches(adapter, plan);
    const toB = playback.switchVersion(sessionId(), 'b', 1810).catch(() => undefined);
    await flush();
    switches.b!.lose(); await toB;
    const toC = playback.switchVersion(sessionId(), 'c', 1815).catch(() => undefined);
    await flush();
    switches.c!.refuse(); await toC;
    await publish(2, 1810, { sourceGeneration: 2, selectedVersionId: 'b' });
    expect(await restart()).toBe(1810);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

for (const [case_, expected] of [['C accepted', 'c'], ['B and C both refused', 'a'], ['B published before C is refused', 'b']] as const) {
  test(`after a switch to B and one to C, ${case_}: recovery asks for ${expected.toUpperCase()}`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a', positionSeconds: 1800 });
      await flush();
      playback.snapshot(at(sessionId(), 'playing', 1815));
      const switches = holdSwitches(adapter, plan);
      const toB = playback.switchVersion(sessionId(), 'b', 1810).catch(() => undefined);
      await flush();
      if (case_ === 'B and C both refused') switches.b!.refuse(); else switches.b!.lose();
      await toB;
      const toC = playback.switchVersion(sessionId(), 'c', 1820).catch(() => undefined);
      await flush();
      if (case_ === 'C accepted') switches.c!.accept({ positionSeconds: 1820, sourceGeneration: 2, seekGeneration: 2 });
      else {
        if (case_ === 'B published before C is refused') await publish(2, 1810, { sourceGeneration: 2, selectedVersionId: 'b' });
        switches.c!.refuse();
      }
      await toC;
      expect(await restart()).toBe({ a: 1815, b: 1810, c: 1820 }[expected]);
      expect(requests.at(-1).versionId).toBe(expected);
    }, 1800);
  });
}

test('a version asked for twice in a row is taken once: a later plan for it is not taken again', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    const switches = holdSwitches(adapter, plan);
    const first = playback.switchVersion(sessionId(), 'b', 1810).catch(() => undefined);
    await flush();
    const toFirst = switches.b!;
    const second = playback.switchVersion(sessionId(), 'b', 1810).catch(() => undefined);
    await flush();
    // B is published and plays on to 1830 s; then a newer plan for B (another source of it) is published at 1700 s.
    await publish(2, 1810, { sourceGeneration: 2, selectedVersionId: 'b' });
    playback.snapshot({ ...at(sessionId(), 'playing', 1830), sourceGeneration: 2, seekGeneration: 2 });
    await publish(3, 1700, { sourceGeneration: 3, selectedVersionId: 'b' });
    // The first request's reply is lost; the second one's is accepted at 1810 s, behind the plan shown.
    toFirst.lose(); await first;
    switches.b!.accept({ positionSeconds: 1810, sourceGeneration: 2, seekGeneration: 2 }); await second;
    expect(plan()?.sourceGeneration).toBe(3);
    expect(await restart()).toBe(1830);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

const twoAudioTracks = [{ id: '1' }, { id: '2' }] as unknown as PlaybackPlan['audioTracks'];

test('a retried switch\'s reply behind a track change on its version does not take its tracks back', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    // The server takes track changes; a replacement offers both audio tracks and opens on track 1.
    const server = adapter as unknown as { changeTracks: (id: string, c: any) => Promise<PlaybackPlan>; startPlayback: (r: any) => Promise<PlaybackPlan> };
    const sent: any[] = [];
    server.changeTracks = async (id, c) => { sent.push(c); return { ...plan()!, sessionId: id, selectedAudioTrackId: c.audioTrackId, sourceGeneration: 3, seekGeneration: 3 }; };
    const start = server.startPlayback;
    server.startPlayback = async r => ({ ...(await start(r)), audioTracks: twoAudioTracks, selectedAudioTrackId: '1' } as unknown as PlaybackPlan);
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // The first request for B is lost; B is asked for again and published at generation 2 on audio track 1.
    const switches = holdSwitches(adapter, plan);
    const first = playback.switchVersion(sessionId(), 'b', 1815).catch(() => undefined);
    await flush();
    switches.b!.lose(); await first;
    const second = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    await publish(2, 1815, { sourceGeneration: 2, selectedVersionId: 'b', audioTracks: twoAudioTracks, selectedAudioTrackId: '1' });
    // Audio track 2 is accepted at generation 3; then the retry's generation-2 reply, selecting track 1, arrives.
    await playback.command(sessionId(), { kind: 'tracks', audioTrackId: '2', sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'tracks-2' });
    switches.b!.accept({ positionSeconds: 1815, sourceGeneration: 2, seekGeneration: 2, audioTracks: twoAudioTracks, selectedAudioTrackId: '1' }); await second;
    expect(plan()?.selectedAudioTrackId).toBe('2');
    sent.length = 0;
    expect(await restart()).toBe(1815);
    expect(requests.at(-1).versionId).toBe('b');
    // Recovery asks the replacement for track 2.
    expect(sent.map(c => c.audioTrackId)).toEqual(['2']);
  }, 1800);
});

test('a retried switch\'s reply behind a seek on its version does not put the older plan back', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // The first request for B is lost before the server takes it; the retry is published at 1810 s.
    const switches = holdSwitches(adapter, plan);
    const first = playback.switchVersion(sessionId(), 'b', 1810).catch(() => undefined);
    await flush();
    switches.b!.lose(); await first;
    const second = playback.switchVersion(sessionId(), 'b', 1810);
    await flush();
    await publish(2, 1810, { sourceGeneration: 2, selectedVersionId: 'b' });
    // A seek on B to 90 s is accepted; then the retry's older reply arrives.
    const { waiting, restore } = answerSeeks(adapter);
    const seek = playback.command(sessionId(), { kind: 'seek', positionSeconds: 90, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'seek-90' });
    await flush();
    waiting[0]!.accept({ ...plan()!, positionSeconds: 90, sourceGeneration: 2, seekGeneration: 3 }); await seek;
    restore();
    switches.b!.accept({ positionSeconds: 1810, sourceGeneration: 2, seekGeneration: 2 }); await second;
    expect(plan()?.positionSeconds).toBe(90);
    expect(plan()?.seekGeneration).toBe(3);
    expect(await restart()).toBe(90);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

for (const way of ['published', 'read by a refresh', 'reopened by the original-lost read'] as const) {
  test(`a version taken from a plan ${way} keeps its own tracks over a local choice made on the previous version`, async () => {
    await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
      const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
      // Every replacement offers both audio tracks and opens on track 1; the server leaves track selection to the engine.
      const server = adapter as unknown as { changeTracks: (id: string, c: any) => Promise<PlaybackPlan>; startPlayback: (r: any) => Promise<PlaybackPlan>; sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
      server.changeTracks = async () => { throw new TypeError('Track changes are unavailable'); };
      const start = server.startPlayback;
      server.startPlayback = async r => ({ ...(await start(r)), audioTracks: twoAudioTracks, selectedAudioTrackId: '1' } as unknown as PlaybackPlan);
      // Audio track 2 plays on version A, and a replacement keeps it locally.
      playback.snapshot({ ...at(sessionId(), 'playing', 1815), audioTrackId: '2' });
      expect(await restart()).toBe(1815);
      const sent: any[] = [];
      server.changeTracks = async (id, c) => { sent.push(c); return { ...plan()!, sessionId: id, selectedAudioTrackId: c.audioTrackId }; };
      // B negotiates track 1 and reuses id 2 for another language; it comes in, then its matching reply arrives.
      const { accept } = holdSwitch(adapter, plan);
      const switched = playback.switchVersion(sessionId(), 'b', 1815);
      await flush();
      const onB = { sourceGeneration: 2, seekGeneration: 2, selectedVersionId: 'b', audioTracks: twoAudioTracks, selectedAudioTrackId: '1' };
      if (way === 'published') await publish(2, 1810, onB);
      else {
        server.sessionSnapshot = async id => ({ plan: { ...plan()!, sessionId: id, positionSeconds: 1810, ...onB } });
        if (way === 'read by a refresh') expect(await playback.refresh(sessionId())).toBe(true);
        else expect(await playback.originalLost(sessionId(), 1815)).toBe('reopened');
      }
      accept({ positionSeconds: 1810, ...onB }); await switched;
      // The session fails before B reports its tracks.
      expect(await restart()).toBe(1810);
      expect(requests.at(-1).versionId).toBe('b');
      // The replacement opens on B's track 1 and is not asked for track 2.
      expect(sent.map(c => c.audioTrackId)).toEqual([]);
    }, 1800);
  });
}

test('a pending switch is taken by the first usable plan of its version after the original-lost read showed it unavailable', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a', positionSeconds: 1800 });
    await flush();
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // On A, pinned, at 1815 s: the server accepts B at 1810 s and the reply is lost.
    const switches = holdSwitches(adapter, plan);
    const toB = playback.switchVersion(sessionId(), 'b', 1810).catch(() => undefined);
    await flush();
    switches.b!.lose(); await toB;
    // The original-lost read first shows B as unavailable; then a newer plan for B is published at 1810 s.
    const server = adapter as unknown as { sessionSnapshot: (id: string) => Promise<{ plan: PlaybackPlan }> };
    server.sessionSnapshot = async () => ({ plan: { ...plan()!, positionSeconds: 1810, selectedVersionId: 'b', sourceFailure: 'version_unavailable', sourceGeneration: 2, seekGeneration: 2 } as PlaybackPlan });
    expect(await playback.originalLost(sessionId(), 1815)).toBe('version_unavailable');
    await publish(3, 1810, { sourceGeneration: 3, selectedVersionId: 'b' });
    expect(await restart()).toBe(1810);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});

test('a queued report from the previous source does not choose the tracks of the version taken', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const server = adapter as unknown as { changeTracks: (id: string, c: any) => Promise<PlaybackPlan>; startPlayback: (r: any) => Promise<PlaybackPlan> };
    const start = server.startPlayback;
    server.startPlayback = async r => ({ ...(await start(r)), audioTracks: twoAudioTracks, selectedAudioTrackId: '1' } as unknown as PlaybackPlan);
    const sent: any[] = [];
    server.changeTracks = async (id, c) => { sent.push(c); return { ...plan()!, sessionId: id, selectedAudioTrackId: c.audioTrackId }; };
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // B is published on audio 1 at generation 2; A's queued generation-1 report naming audio 2 arrives, then B's reply.
    const { accept } = holdSwitch(adapter, plan);
    const switched = playback.switchVersion(sessionId(), 'b', 1815);
    await flush();
    const onB = { sourceGeneration: 2, seekGeneration: 2, selectedVersionId: 'b', audioTracks: twoAudioTracks, selectedAudioTrackId: '1' };
    await publish(2, 1810, onB);
    playback.snapshot({ ...at(sessionId(), 'playing', 1815), audioTrackId: '2' });
    accept({ positionSeconds: 1810, ...onB }); await switched;
    // B fails before it presents: the replacement opens on B's audio 1 and is not asked for audio 2.
    expect(await restart()).toBe(1810);
    expect(requests.at(-1).versionId).toBe('b');
    expect(sent.map(c => c.audioTrackId)).toEqual([]);
  }, 1800);
});

test('a version still waiting for its lost switch reply is taken from a subtitle download\'s reply that shows it', async () => {
  await watch(async ({ playback, sessionId, restart, publish, plan, adapter, requests }) => {
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a', positionSeconds: 1800 });
    await flush();
    playback.snapshot(at(sessionId(), 'playing', 1815));
    // On A, pinned, at 1815 s: the server accepts B at 1810 s and the reply is lost.
    const switches = holdSwitches(adapter, plan);
    const toB = playback.switchVersion(sessionId(), 'b', 1810).catch(() => undefined);
    await flush();
    switches.b!.lose(); await toB;
    // A subtitle download's reply first shows B; then the poll publishes B, and the session fails before B presents.
    const onB = { positionSeconds: 1810, selectedVersionId: 'b', sourceGeneration: 2, seekGeneration: 2 };
    const subtitles = adapter as unknown as Record<string, unknown>;
    subtitles.subtitleLanguages = async () => null;
    subtitles.searchSubtitles = async () => ({ results: [] });
    subtitles.downloadSubtitle = async (id: string) => ({ ...plan()!, sessionId: id, ...onB, subtitleTracks: [{ id: 'found' }] });
    expect(await playback.downloadSubtitle('found')).toBe('found');
    await publish(2, 1810, { ...onB, subtitleTracks: [{ id: 'found' }] } as Partial<PlaybackPlan>);
    expect(await restart()).toBe(1810);
    expect(requests.at(-1).versionId).toBe('b');
  }, 1800);
});
