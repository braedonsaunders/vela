import { expect, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { Playback, initialPlayback } from '../src/store/playback';
import { commandFailure, commandOrigin } from '../src/store/command-failure';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan, SessionCommand } from '../src/wire';

const plan = (generation: number) => ({
  sessionId: 's1', revision: generation, state: 'playing', positionSeconds: 84, sourceGeneration: generation, seekGeneration: generation,
  audioTracks: [], subtitleTracks: [], selectedPathId: 'primary',
  paths: [{ id: 'primary' }, { id: 'quality-1080p20000k-h264-sdr' }],
} as unknown as PlaybackPlan);

// Ether's answer when a version switch moved the session on under a command planned at generation 1.
const stale = () => new VelaError({ class: 'conflict', code: 'stale_generation', message: 'stale generation',
  currentGenerations: { sourceGeneration: 2, seekGeneration: 2 }, retry: { allowed: false } } as never, 409);

function harness(switchPath: (command: SessionCommand) => Promise<PlaybackPlan>) {
  const sent: SessionCommand[] = [];
  const adapter = {
    switchPath: (_id: string, command: SessionCommand) => { sent.push(command); return switchPath(command); },
    command: async (_id: string, command: SessionCommand) => { sent.push(command); return plan(2); },
  };
  const session = { onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), key: () => `key-${sent.length}` };
  const box = new StateBox({ playback: { ...initialPlayback, phase: 'playing', sessionId: 's1', plan: plan(1) } } as VelaState);
  return { sent, box, playback: new Playback(box, session as unknown as Session, () => {}, () => {}) };
}

const switchAt1 = (): Extract<SessionCommand, { kind: 'switch' }> => ({ kind: 'switch', pathId: 'quality-1080p20000k-h264-sdr', atSeconds: 85.9,
  sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'engine-key' });

test('an automatic switch that loses to a version switch is dropped silently, never re-sent', async () => {
  const h = harness(async () => { throw stale(); });
  const before = h.box.get().playback.plan;
  await h.playback.command('s1', switchAt1(), 'engine');
  expect(h.sent).toHaveLength(1);
  const state = h.box.get().playback;
  expect(state.error).toBe('');
  expect(state.plan).toBe(before);
  expect(state.phase).toBe('playing');
});

test("the viewer's quality pick that goes stale is re-sent once at the server's generations", async () => {
  const h = harness(async command => {
    if (command.sourceGeneration === 1) throw stale();
    return { ...plan(3), selectedPathId: 'quality-1080p20000k-h264-sdr' } as PlaybackPlan;
  });
  await h.playback.command('s1', switchAt1(), 'viewer');
  expect(h.sent).toHaveLength(2);
  expect(h.sent[1]).toMatchObject({ kind: 'switch', pathId: 'quality-1080p20000k-h264-sdr', sourceGeneration: 2, seekGeneration: 2 });
  expect(h.sent[1]!.idempotencyKey).not.toBe('engine-key');
  const state = h.box.get().playback;
  expect(state.plan?.selectedPathId).toBe('quality-1080p20000k-h264-sdr');
  expect(state.error).toBe('');
});

test('a viewer pick is re-sent only once, and only while the session still offers its path', async () => {
  const always = harness(async () => { throw stale(); });
  await always.playback.command('s1', switchAt1(), 'viewer');
  expect(always.sent).toHaveLength(2);
  expect(always.box.get().playback.error).toBe('');

  const gone = harness(async () => { throw stale(); });
  await gone.playback.command('s1', { ...switchAt1(), pathId: 'quality-from-the-old-version' }, 'viewer');
  expect(gone.sent).toHaveLength(1);
  expect(gone.box.get().playback.error).toBe('');
});

test('a refused command shows viewer copy, never the server words; the engine\'s own stays silent', async () => {
  const refuse = () => new VelaError({ class: 'source', code: 'not_available', message: 'not available', retry: { allowed: false } } as never, 409);
  const viewer = harness(async () => { throw refuse(); });
  await viewer.playback.command('s1', switchAt1(), 'viewer');
  expect(viewer.box.get().playback.error).toBe('Could not change the quality. Playback continues.');
  const engine = harness(async () => { throw refuse(); });
  await engine.playback.command('s1', switchAt1(), 'engine');
  expect(engine.box.get().playback.error).toBe('');
});

test('failure copy: stale commands, stops and fallbacks are silent; nothing echoes the error', () => {
  const raw = new Error('stale generation');
  for (const kind of ['seek', 'pause', 'resume', 'tracks', 'switch'] as const) {
    const words = commandFailure({ kind }, raw, 'viewer');
    expect(words).not.toContain('stale');
    expect(words.length).toBeGreaterThan(0);
    expect(commandFailure({ kind }, stale(), 'viewer')).toBe('');
  }
  expect(commandFailure({ kind: 'stop' }, raw, 'viewer')).toBe('');
  expect(commandFailure({ kind: 'prepare-fallback' }, raw, 'engine')).toBe('');
  expect(commandFailure({ kind: 'switch' }, raw, 'engine')).toBe('');
});

test("a switch is the viewer's only while their pick of that path is pending", () => {
  const command = switchAt1();
  expect(commandOrigin(command, 'path:quality-1080p20000k-h264-sdr')).toBe('viewer');
  expect(commandOrigin(command, undefined)).toBe('engine');
  expect(commandOrigin(command, 'auto')).toBe('engine');
  expect(commandOrigin(command, 'path:quality-720p4000k-h264-sdr')).toBe('engine');
  expect(commandOrigin({ kind: 'seek', positionSeconds: 3, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'k' }, undefined)).toBe('viewer');
});
