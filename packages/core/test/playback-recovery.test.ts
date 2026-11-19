import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';

// A deterministic clock, including asynchronous callbacks, without wall-clock sleeps.
test('session recovery coalesces, backs off, resumes VOD, waits for auth and cancels on exit', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { ms: number; fire: () => unknown }>();
  let sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  const tick = async (ms: number) => {
    const entry = [...timers].find(([, t]) => t.ms === ms);
    expect(entry).toBeDefined();
    timers.delete(entry![0]); await entry![1].fire();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  try {
    const requests: any[] = [], stops: string[] = [], tracks: any[] = [];
    let offline = false;
    const plan = (id: string) => ({ sessionId: id, state: 'playing', positionSeconds: 0, sourceGeneration: 0, seekGeneration: 0 } as PlaybackPlan);
    const adapter = {
      startPlayback: async (r: any) => { requests.push(r); if (offline) throw new Error('connection refused'); return plan(`s${requests.length}`); },
      sessionSnapshot: async (id: string) => ({ plan: plan(id) }),
      changeTracks: async (id: string, c: any) => { tracks.push(c); return plan(id); },
      command: async (id: string, c: any) => { if (c.kind === 'stop') stops.push(id); else tracks.push(c); return plan(id); },
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 123, state: 'playing', audioTrackId: 'fr', subtitleTrackId: 'en' });
    offline = true;
    playback.recover('s1'); playback.recover('s1');
    expect(box.get().playback.plan).toBeNull();
    await tick(1000); expect(requests).toHaveLength(2);
    await tick(2000); await tick(4000); await tick(8000); await tick(15000);
    expect(requests).toHaveLength(6);
    box.update('auth', a => ({ ...a, phase: 'offline' }));
    await tick(15000); expect(requests).toHaveLength(6);
    box.update('auth', a => ({ ...a, phase: 'signed-in' }));
    offline = false;
    await tick(15000);
    expect(requests.at(-1).positionSeconds).toBe(123);
    expect(requests.at(-1).audioTrackId).toBeUndefined();
    expect(tracks.at(-1).audioTrackId).toBe('fr');
    expect(tracks.at(-1).subtitleTrackId).toBe('en');
    expect(stops).toContain('s1');
    playback.recover(box.get().playback.sessionId);
    await playback.stop();
    expect(timers.size).toBe(0);
    await playback.start({ kind: 'channel', id: 'fox' });
    const id = box.get().playback.sessionId;
    playback.snapshot({ sessionId: id, live: null, position: 200, state: 'buffering' });
    await tick(5500); await tick(1000);
    expect(requests.at(-1).channelId).toBe('fox');
    expect(requests.at(-1).positionSeconds).toBeUndefined();
    // A newly allocated session that never makes progress must also recover, at the next backoff.
    await tick(5500); await tick(2000);
    const liveId = box.get().playback.sessionId;
    playback.snapshot({ sessionId: liveId, live: null, position: 0, state: 'paused' });
    expect([...timers.values()].some(t => t.ms === 5500)).toBe(false);
    await playback.stop();
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

test('event stream EOF and errors both enter session recovery, explicit ended does not', async () => {
  for (const outcome of ['eof', 'error', 'ended']) {
    const plan = { sessionId: 'stream', state: 'playing', positionSeconds: 0, sourceGeneration: 0, seekGeneration: 0 } as PlaybackPlan;
    const adapter = {
      startPlayback: async () => plan,
      sessionSnapshot: async () => ({ plan, revision: 1, cursor: '1' }),
      streamViewerEvents: async () => {},
      streamSession: async (_id: string, _cursor: string, emit: (event: any) => Promise<void>) => {
        if (outcome === 'error') throw new Error('connection reset');
        if (outcome === 'ended') await emit({ data: JSON.stringify({ type: 'ended', sessionId: 'stream', revision: 2, cursor: '2' }) });
      },
      command: async () => plan,
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, client: {} };
    const box = new StateBox({ playback: initialPlayback } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    await playback.start({ kind: 'channel', id: 'fox' });
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(box.get().playback.phase).toBe(outcome === 'ended' ? 'ended' : 'preparing');
    await playback.stop();
  }
});
