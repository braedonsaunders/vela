import { expect, test } from 'bun:test';
import { engineCommandAnswered, engineCommandSent, heardEngine, heardServer, PATIENCE_SECONDS, QUIET_SECONDS, stallDeadline, stallVerdict, stallWatch, type StallSample } from '../src/store/stall';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';

const S = 1000;
/** Feed samples one second apart from `from`, returning the watch and the clock after the last. */
function feed(samples: StallSample[], watch = stallWatch(0), from = 0) {
  let now = from;
  for (const sample of samples) { now += S; watch = heardEngine(watch, sample, now); }
  return { watch, now };
}
const loading = (ahead: number, extra: Partial<StallSample> = {}): StallSample =>
  ({ state: 'buffering', position: 2468, bufferAheadSeconds: ahead, playable: [{ start: 2468, end: 2468 + ahead }], ...extra });

test('a session that shows nothing at all is stalled after the attempt\'s quiet budget, longer each restart', () => {
  expect(QUIET_SECONDS).toEqual([10, 20, 40]);
  for (const [attempt, seconds] of QUIET_SECONDS.entries()) {
    const watch = heardEngine(stallWatch(0, attempt), { state: 'loading', position: 0 }, 0);
    // The same report again and again is not progress.
    const { watch: quiet } = feed(Array(5).fill({ state: 'loading', position: 0, bufferAheadSeconds: 0 }), watch);
    expect(stallDeadline(quiet)).toBe(seconds * S);
  }
  // Two restarts, then the viewer is told.
  expect(stallVerdict({ attempt: 0 })).toBe('restart');
  expect(stallVerdict({ attempt: 1 })).toBe('restart');
  expect(stallVerdict({ attempt: 2 })).toBe('give-up');
});

test('a slow start keeps waiting while its buffer grows, bytes arrive or the decoder moves through preparation', () => {
  // A seek on an overloaded device: half a second of media a second for 45 s, then it plays.
  const samples = Array.from({ length: 45 }, (_, i) => loading(i * 0.5));
  const { watch, now } = feed(samples);
  expect(stallDeadline(watch)).toBe(now + 10 * S);
  // Bytes arriving (a new throughput measure) with nothing buffered yet, and a preparation stage, count too.
  const bytes = feed([{ state: 'loading', position: 0, throughputBps: 1e5 }, { state: 'loading', position: 0, throughputBps: 2e5 }]);
  expect(stallDeadline(bytes.watch)).toBe(bytes.now + 10 * S);
  // Media3 buffers nothing it can count until it has parsed samples; its byte count still grows.
  const received = feed(Array.from({ length: 30 }, (_, i) => ({ state: 'loading', position: 0, bufferAheadSeconds: 0, loadProgress: i * 5000 })));
  expect(stallDeadline(received.watch)).toBe(received.now + 10 * S);
  // A counter that stops (or starts over at a new engine) says nothing more.
  const stopped = feed([{ state: 'loading', position: 0, loadProgress: 900 }, { state: 'loading', position: 0, loadProgress: 900 }, { state: 'loading', position: 0, loadProgress: 0 }]);
  expect(stallDeadline(stopped.watch)).toBe(1 * S + 10 * S);
  const preparing = feed([{ state: 'loading', position: 0, preparation: 'media-metadata' }, { state: 'loading', position: 0, preparation: 'initial-buffer' }]);
  expect(stallDeadline(preparing.watch)).toBe(preparing.now + 10 * S);
  // Growth too slow to show between two snapshots still counts over several.
  let slow = heardEngine(stallWatch(0), loading(0), 0);
  for (let t = 250; t <= 30_000; t += 250) slow = heardEngine(slow, loading(t / 1000 * 0.02), t);
  expect(stallDeadline(slow)).toBeGreaterThan(30_000);
  // A buffer that drains or a throughput figure that never changes is not progress.
  const stale = feed([loading(4, { throughputBps: 1e5 }), loading(3, { throughputBps: 1e5 }), loading(3, { throughputBps: 1e5 })]);
  expect(stallDeadline(stale.watch)).toBe(1 * S + 10 * S);
});

test('an engine that says it is playing must move its position: a growing buffer behind a frozen picture is a stall', () => {
  const { watch } = feed([
    { state: 'playing', position: 100, bufferAheadSeconds: 5 },
    { state: 'playing', position: 100, bufferAheadSeconds: 6 },
    { state: 'playing', position: 100, bufferAheadSeconds: 7 },
  ]);
  expect(stallDeadline(watch)).toBe(1 * S + 10 * S);
});

test('however much trickles in, an attempt that never plays is stalled after the patience bound', () => {
  const samples = Array.from({ length: PATIENCE_SECONDS + 30 }, (_, i) => loading(i * 0.01 + 0.06 * i));
  const { watch } = feed(samples);
  // The first sample started the clocks at 1 s.
  expect(stallDeadline(watch)).toBe(1 * S + PATIENCE_SECONDS * S);
});

test('while the server says the media is still being prepared, only the patience bound applies', () => {
  let watch = heardEngine(stallWatch(0), { state: 'loading', position: 0 }, 0);
  const plan = { state: 'playing', revision: 3, selectedPathId: 'hls', paths: [{ id: 'hls', readiness: 'preparing' }], fallback: { state: 'idle' } };
  watch = heardServer(watch, plan, 30 * S);
  expect(stallDeadline(watch)).toBe(PATIENCE_SECONDS * S);
  // Ready: the quiet budget is back, counted from the server's last word.
  watch = heardServer(watch, { ...plan, revision: 4, paths: [{ id: 'hls', readiness: 'ready' }] }, 40 * S);
  expect(stallDeadline(watch)).toBe(50 * S);
  // The same revision again says nothing new.
  watch = heardServer(watch, { ...plan, revision: 4, paths: [{ id: 'hls', readiness: 'ready' }] }, 45 * S);
  expect(stallDeadline(watch)).toBe(50 * S);
});

test('paused or ended is never stalled, and the clocks start afresh when the viewer plays again', () => {
  let watch = heardEngine(stallWatch(0), { state: 'paused', position: 50 }, 5 * S);
  expect(stallDeadline(watch)).toBeNull();
  watch = heardEngine(watch, { state: 'paused', position: 50 }, 500 * S);
  watch = heardEngine(watch, { state: 'loading', position: 50 }, 600 * S);
  expect(stallDeadline(watch)).toBe(610 * S);
  expect(stallDeadline(heardEngine(watch, { state: 'ended', position: 50 }, 601 * S))).toBeNull();
});

test('a seek starts its own wait; only sustained playback forgives earlier restarts', () => {
  // Attempt 1 (one restart behind it), playing briefly: still attempt 1.
  let { watch, now } = feed([
    { state: 'loading', position: 300 },
    { state: 'playing', position: 300.5 },
    { state: 'playing', position: 301.5 },
    { state: 'playing', position: 302.5 },
  ], stallWatch(0, 1));
  expect(watch.attempt).toBe(1);
  // The viewer seeks: the new position's wait starts now, the same attempt.
  ({ watch, now } = feed([{ state: 'loading', position: 900, seekGeneration: 2 }], watch, now));
  expect(watch.attempt).toBe(1);
  expect(watch.moved).toBe(now);
  expect(stallDeadline(watch)).toBe(now + 20 * S);
  // Ten seconds of play: healthy again, the next stall gets the first budget.
  ({ watch, now } = feed(Array.from({ length: 12 }, (_, i) => ({ state: 'playing', position: 900 + i, seekGeneration: 2 })), watch, now));
  expect(watch.attempt).toBe(0);
  expect(stallDeadline(watch)).toBe(now + 10 * S);
});

test("an engine's own recovery is not progress: waiting-state flips, reloads that start over and its path switches", () => {
  // A dead stream on Apple: Aether reloads after each read failure, flipping between loading and
  // buffering at the position it failed at (its loadProgress counts only a new furthest startup step).
  const flips = feed(Array.from({ length: 12 }, (_, i) => ({ state: i % 2 ? 'buffering' : 'loading', position: 12.25, loadProgress: 7 })));
  expect(stallDeadline(flips.watch)).toBe(1 * S + 10 * S);
  // Playing to waiting is still news.
  const stopped = feed([{ state: 'playing', position: 12 }, { state: 'playing', position: 13 }, { state: 'buffering', position: 13 }]);
  expect(stallDeadline(stopped.watch)).toBe(stopped.now + 10 * S);

  // The engine switches path on its own: the server's answer and its event carry the new path and
  // new generations, and the new source starts a little off the old position. None of it moves the clocks.
  const before = { revision: 3, selectedPathId: 'direct', paths: [{ id: 'direct', readiness: 'ready' }, { id: 'transcode', readiness: 'ready' }] };
  const after = { ...before, revision: 4, selectedPathId: 'transcode', sourceGeneration: 2, seekGeneration: 0 };
  let watch = heardServer(heardEngine(stallWatch(0), { state: 'buffering', position: 12.25, sourceGeneration: 1, seekGeneration: 0 }, 0), before, 0);
  watch = engineCommandSent(watch);
  watch = heardServer(watch, after, 2 * S);
  watch = engineCommandAnswered(watch, after);
  watch = heardServer(watch, after, 3 * S);
  watch = heardEngine(watch, { state: 'loading', position: 12, sourceGeneration: 2, seekGeneration: 0 }, 5 * S);
  watch = heardEngine(watch, { state: 'buffering', position: 12, sourceGeneration: 2, seekGeneration: 0 }, 6 * S);
  // The player's own observations come back as new revisions, and "buffering" as "recovering": an echo.
  for (let t = 7; t <= 9; t++) watch = heardServer(watch, { ...after, revision: 4 + t, state: 'recovering' }, t * S);
  expect(watch.heard).toBe(0);
  expect(watch.moved).toBe(0);
  expect(watch.serverPreparing).toBe(false);
  expect(stallDeadline(watch)).toBe(10 * S);
  // What the server prepares changing is news: a path it makes ready.
  const ready = { ...after, revision: 20, paths: [...after.paths, { id: 'fallback', readiness: 'ready' }] };
  expect(heardServer(watch, ready, 9.5 * S).heard).toBe(9.5 * S);
  // A refused command leaves nothing pending: the server's next change is news again.
  watch = engineCommandAnswered(engineCommandSent(watch), null);
  expect(heardServer(watch, ready, 7 * S).heard).toBe(7 * S);
  // The viewer's own seek afterwards is a new position, with its own wait.
  watch = heardEngine(watch, { state: 'buffering', position: 600, sourceGeneration: 2, seekGeneration: 1 }, 8 * S);
  expect(watch.moved).toBe(8 * S);
});

/** A Playback on fake timers and a fake server; `run` gets it, `advance` and the requests and stops seen. */
async function withPlayback(options: { echo?: boolean }, run: (h: {
  playback: Playback; box: StateBox<VelaState>; advance: (ms: number) => Promise<void>; now: () => number;
  requests: string[]; stops: string[]; switches: string[];
}) => Promise<void>) {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalNow = Date.now;
  const timers = new Map<number, { at: number; fire: () => unknown }>();
  let sequence = 0, clock = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms: number) => { const id = ++sequence; timers.set(id, { at: clock + ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  Date.now = () => clock;
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  /** Advance the clock by `ms`, firing every timer that comes due on the way. */
  const advance = async (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); clock = due[1].at; await due[1].fire(); await settle();
    }
    clock = end;
  };
  try {
    const requests: string[] = [], stops: string[] = [], switches: string[] = [];
    let sessions = 0;
    const revisions = new Map<string, number>();
    const plan = (id: string) => ({ sessionId: id, revision: revisions.get(id) ?? 1, state: 'playing', positionSeconds: 2468, audioTracks: [], subtitleTracks: [],
      sourceGeneration: (revisions.get(id) ?? 1) - 1, seekGeneration: 0 } as unknown as PlaybackPlan);
    const adapter = {
      startPlayback: async () => { requests.push(`s${++sessions}`); return plan(requests.at(-1)!); },
      // A server echoing the player (as Ether and the mock do): each observation a new revision, and
      // its "buffering" the plan's "recovering".
      sessionSnapshot: async (id: string) => ({ plan: options.echo ? { ...plan(id), revision: 100 + clock, state: 'recovering' } : plan(id) }),
      command: async (id: string, c: any) => { if (c.kind === 'stop') stops.push(id); return plan(id); },
      switchPath: async (id: string) => { switches.push(id); revisions.set(id, (revisions.get(id) ?? 1) + 1); return plan(id); },
      detail: async () => ({ title: {} }),
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    await run({ playback, box, advance, now: () => clock, requests, stops, switches });
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = originalNow; }
}

test('a slow seek finishes on the session it started on, and a dead one ends in the failed state in bounded time', async () => {
  await withPlayback({}, async ({ playback, box, advance, now, requests, stops }) => {
    // Slow: 45 s of bytes trickling in with nothing buffered yet (Media3 before it has parsed
    // samples), 15 s of buffer growing, then it plays.
    await playback.start({ kind: 'title', id: 'allen', positionSeconds: 2468 });
    for (let i = 1; i <= 45; i++) {
      await advance(S);
      playback.snapshot({ sessionId: 's1', live: null, ...loading(0), loadProgress: i * 5000 });
    }
    for (let i = 1; i <= 15; i++) {
      await advance(S);
      playback.snapshot({ sessionId: 's1', live: null, ...loading(i * 0.05), loadProgress: 225000 });
    }
    for (let i = 1; i <= 5; i++) {
      await advance(S);
      playback.snapshot({ sessionId: 's1', live: null, state: 'playing', position: 2468 + i, bufferAheadSeconds: 12 });
    }
    expect(requests).toEqual(['s1']);
    expect(box.get().playback.phase).toBe('playing');
    await playback.stop();

    // Dead: the engine reports the same nothing forever. Restarts after 10 s and 20 s of quiet
    // (plus the backoff before asking again), then the failed state after 40 s more.
    requests.length = 0; stops.length = 0;
    await playback.start({ kind: 'title', id: 'allen', positionSeconds: 2468 });
    const started = now();
    let failedAt = 0;
    while (now() - started < 300 * S && !failedAt) {
      await advance(S);
      const id = box.get().playback.sessionId;
      if (id) playback.snapshot({ sessionId: id, live: null, ...loading(0) });
      if (box.get().playback.phase === 'failed') failedAt = now() - started;
    }
    expect(requests).toEqual(['s2', 's3', 's4']);
    expect(failedAt).toBeGreaterThan(70 * S);
    expect(failedAt).toBeLessThanOrEqual(80 * S);
    expect(box.get().playback.plan).toBeNull();
    expect(stops).toEqual(['s2', 's3', 's4']);
    // Try again is a fresh start, with its full set of attempts.
    await playback.start({ kind: 'title', id: 'allen', positionSeconds: 2468 });
    expect(requests.at(-1)).toBe('s5');
    expect(box.get().playback.phase).toBe('playing');
    await playback.stop();
  });
});

test('a dead stream on Apple ends in the failed state in the same bound, through reloads, its own path switches and the server echoing it', async () => {
  await withPlayback({ echo: true }, async ({ playback, box, advance, now, requests, stops, switches }) => {
    await playback.start({ kind: 'title', id: 'allen', positionSeconds: 2468 });
    const started = now();
    let failedAt = 0, tick = 0;
    while (now() - started < 300 * S && !failedAt) {
      await advance(S);
      tick++;
      const { sessionId: id, plan } = box.get().playback;
      if (id && plan) {
        // Aether reloading after each failed read: loading and buffering by turns, at the position it
        // failed at, its startup steps passed again (so no new furthest), and every 7 s a path switch
        // of its own, whose new generation its next reports carry (its new source a moment off the old position).
        if (tick % 7 === 0) await playback.command(id, { kind: 'switch', pathId: 'transcode', atSeconds: 2468, sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration, idempotencyKey: `k${tick}` }, 'engine');
        const current = box.get().playback.plan ?? plan;
        playback.snapshot({ sessionId: id, live: null, state: tick % 2 ? 'loading' : 'buffering', position: current.sourceGeneration ? 2467.8 : 2468, loadProgress: 7,
          sourceGeneration: current.sourceGeneration, seekGeneration: current.seekGeneration });
      }
      if (box.get().playback.phase === 'failed') failedAt = now() - started;
    }
    expect(switches.length).toBeGreaterThan(0);
    expect(requests).toEqual(['s1', 's2', 's3']);
    expect(failedAt).toBeGreaterThan(70 * S);
    expect(failedAt).toBeLessThanOrEqual(80 * S);
    expect(box.get().playback.errorCode).toBe('playback_stalled');
    expect(stops).toEqual(['s1', 's2', 's3']);
  });
});
