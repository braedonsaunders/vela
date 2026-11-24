import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';
import type { PlaybackTarget } from '../src/store/playback';
import { VelaError } from '../src/adapter/errors';

const S = 1000;

/** A Playback over a fake server, on a fake clock: every session it is given fails as soon as it starts. */
async function withHarness(run: (h: {
  refuse: (error: unknown) => void;
  playback: Playback;
  box: StateBox<VelaState>;
  started: string[];
  stops: string[];
  plan: (id: string) => PlaybackPlan;
  advance: (ms: number) => Promise<void>;
}) => Promise<void>): Promise<void> {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalNow = Date.now;
  const timers = new Map<number, { at: number; fire: () => unknown }>();
  let sequence = 0, clock = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { at: clock + ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  Date.now = () => clock;
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const advance = async (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); clock = due[1].at; await due[1].fire(); await settle();
    }
    clock = end;
    await settle();
  };
  try {
    const started: string[] = [], stops: string[] = [];
    let sessions = 0;
    let refusal: unknown;
    const plan = (id: string) => ({ sessionId: id, revision: 1, state: 'playing', channelId: 'news', live: {}, positionSeconds: 0,
      audioTracks: [], subtitleTracks: [], sourceGeneration: 0, seekGeneration: 0 } as unknown as PlaybackPlan);
    const adapter = {
      startPlayback: async () => { if (refusal) throw refusal; const id = `s${++sessions}`; started.push(id); return plan(id); },
      sessionSnapshot: async (id: string) => ({ plan: plan(id) }),
      command: async (id: string, c: { kind: string }) => { if (c.kind === 'stop') stops.push(id); return plan(id); },
      detail: async () => ({ title: {} }),
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    await run({ refuse: error => { refusal = error; }, playback, box, started, stops, plan, advance });
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = originalNow; }
}

const channel: PlaybackTarget = { kind: 'channel', id: 'news' };

test('a live channel whose owner hands back every restarted session gives up after two restarts, not one per session', async () => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: string) => { warnings.push(String(message)); };
  try {
    await withHarness(async ({ playback, box, started, stops, plan, advance }) => {
      // The guide's tile tuned the channel (tune), and the watch route follows its session.
      let owned = plan('tune');
      await playback.attach(channel, owned);
      // The lab's failure: each session's media fails at once (a source error), thirteen times over.
      for (let failure = 0; failure < 13 && box.get().playback.phase !== 'failed'; failure++) {
        playback.recover(owned.sessionId);
        await advance(20 * S);
        const next = box.get().playback.plan;
        if (box.get().playback.phase === 'failed' || !next || next.sessionId === owned.sessionId) continue;
        // The route hands the restarted plan to the owner, and its effect follows the new session:
        // detach from the old, attach to the new (which reset the count before).
        playback.detach(owned.sessionId);
        owned = next;
        await playback.attach(channel, owned);
      }
      expect(started).toEqual(['s1', 's2']);
      const state = box.get().playback;
      expect(state.phase).toBe('failed');
      expect(state.errorCode).toBe('playback_stalled');
      expect(state.plan).toBeNull();
      // Every session it gave up on, the owner's first and both restarts, is released on the server.
      expect(stops).toEqual(['tune', 's1', 's2']);
      expect(warnings.filter(w => w.includes('restart '))).toEqual([
        'Vela playback: session tune failed; restart 1 of 2',
        'Vela playback: session s1 failed; restart 2 of 2',
      ]);
      expect(warnings.at(-1)).toBe('Vela playback: session s2 failed after 2 restart(s); giving up');

      // Try again: the owner tunes afresh, a new watch with its full set of restarts.
      await playback.attach(channel, plan('retune'));
      expect(box.get().playback.phase).toBe('playing');
      playback.recover('retune');
      await advance(20 * S);
      expect(started).toEqual(['s1', 's2', 's3']);
      expect(box.get().playback.phase).toBe('playing');
    });
  } finally { console.warn = warn; }
});

test('failures and stalls share one count per watch, whichever session each lands on', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await withHarness(async ({ playback, box, started, advance }) => {
      await playback.start(channel);
      expect(started).toEqual(['s1']);
      // s1 fails outright; its replacement s2 never moves and stalls; s3 fails: that is the third strike.
      playback.recover('s1');
      await advance(2 * S);
      expect(box.get().playback.sessionId).toBe('s2');
      for (let i = 0; i < 25 && box.get().playback.sessionId === 's2'; i++) {
        playback.snapshot({ sessionId: 's2', live: null, state: 'loading', position: 0 });
        await advance(S);
      }
      await advance(5 * S);
      expect(box.get().playback.sessionId).toBe('s3');
      playback.recover('s3');
      expect(box.get().playback.phase).toBe('failed');
      expect(started).toEqual(['s1', 's2', 's3']);
      // A viewer's start is a new watch.
      await playback.start(channel);
      playback.recover('s4');
      await advance(2 * S);
      expect(box.get().playback.phase).toBe('playing');
      expect(box.get().playback.sessionId).toBe('s5');
      await playback.stop();
    });
  } finally { console.warn = warn; }
});

test('a restart the server itself refuses ends in its words; one it cannot answer is waited out', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    // Lab, 2026-11-24: the channel's provider timed out for every restart, and the player span for ever.
    await withHarness(async ({ refuse, playback, box, started, advance }) => {
      await playback.start(channel);
      refuse(new VelaError({ class: 'source', code: 'timeout', message: 'The channel source isn\'t responding (the provider took too long).', retry: { allowed: false } }, 503));
      playback.recover('s1');
      await advance(60 * S);
      const state = box.get().playback;
      expect(state.phase).toBe('failed');
      expect(state.errorCode).toBe('timeout');
      expect(state.error).toContain('provider took too long');
      expect(state.retryAfterSeconds).toBe(0);
      expect(started).toEqual(['s1']);
      await playback.stop();
    });
    // A gateway in the way or the server restarting (a bodiless 503): the restart keeps asking.
    await withHarness(async ({ refuse, playback, box, started, advance }) => {
      await playback.start(channel);
      refuse(new VelaError({ class: 'transient', code: 'http_error', message: 'Server returned 503', retry: { allowed: false } }, 503));
      playback.recover('s1');
      await advance(60 * S);
      expect(box.get().playback.phase).toBe('preparing');
      refuse(undefined);
      await advance(20 * S);
      expect(box.get().playback.phase).toBe('playing');
      expect(started).toEqual(['s1', 's2']);
      await playback.stop();
    });
  } finally { console.warn = warn; }
});
