import { expect, test } from 'bun:test';
import type { PlaybackPlan } from '../../protocol/types';
import { Tile } from '../src/widgets/guide/tile';
import type { LiveSource } from '../src/widgets/guide/source';

test('preview, fullscreen and back retain exactly one live session', async () => {
  let starts = 0, stops = 0, opened = '';
  const plan = { sessionId: 'one' } as PlaybackPlan;
  const source = {
    tune: async () => { starts++; return plan; },
    stop: async () => { stops++; },
  } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, id => { opened = id; });
  const inputs = { open: true, canPreview: true, quiet: false, order: ['a'], remembered: '' };
  tile.update(inputs);
  await Promise.resolve();
  expect(tile.view().plan).toBe(plan);
  tile.watch('a');
  tile.update({ ...inputs, open: false });
  expect(opened).toBe('a');
  expect(tile.view().plan).toBe(plan);
  tile.update(inputs);
  tile.leaveWatch();
  expect(tile.view().plan).toBe(plan);
  expect(starts).toBe(1);
  expect(stops).toBe(0);
  tile.dispose();
  expect(stops).toBe(1);
});

test('changing channels stops only the previous owner session', async () => {
  const starts: string[] = [], stops: string[] = [];
  const source = {
    tune: async (id: string) => { starts.push(id); return { sessionId: id } as PlaybackPlan; },
    stop: async (plan: PlaybackPlan) => { stops.push(plan.sessionId); },
  } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, () => {});
  tile.update({ open: true, canPreview: true, quiet: false, order: ['a', 'b'], remembered: '' });
  await Promise.resolve();
  tile.enterWatch('b');
  await Promise.resolve();
  expect(starts).toEqual(['a', 'b']);
  expect(stops).toEqual(['a']);
  expect(tile.view().plan?.sessionId).toBe('b');
  tile.dispose();
});

test('explicitly focusing the automatic channel prevents a failure from playing another channel', async () => {
  const starts: string[] = [];
  const source = {
    tune: async (id: string) => { starts.push(id); return { sessionId: id } as PlaybackPlan; },
    stop: async () => {},
  } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, () => {});
  tile.update({ open: true, canPreview: true, quiet: false, order: ['a', 'b'], remembered: '' });
  await Promise.resolve();
  tile.retune('a');
  tile.fail();
  await Promise.resolve();
  expect(starts).toEqual(['a']);
  expect(tile.view()).toMatchObject({ channelId: 'a', state: 'unavailable' });
  tile.dispose();
});

test('a failed initial channel stays selected, and an explicit retry can play it', async () => {
  const starts: string[] = [];
  const source = {
    tune: async (id: string) => { starts.push(id); if (starts.length === 1) throw new Error('offline'); return { sessionId: id } as PlaybackPlan; },
    stop: async () => {},
  } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, () => {});
  tile.update({ open: true, canPreview: true, quiet: false, order: ['a', 'b'], remembered: '' });
  await Promise.resolve();
  expect(tile.view()).toMatchObject({ channelId: 'a', state: 'unavailable' });
  tile.retune('a');
  await Promise.resolve();
  expect(starts).toEqual(['a', 'a']);
  tile.dispose();
});

test('the picture is connecting until a decoded frame is reported; stale snapshots cannot complete a tune', async () => {
  const tile = new Tile({ tune: async () => ({ sessionId: 'a' } as PlaybackPlan), stop: async () => {} } as unknown as LiveSource, () => {}, () => {});
  tile.update({ open: true, canPreview: true, quiet: false, order: ['a'], remembered: '' });
  await Promise.resolve();
  const snapshot = { sessionId: 'a', state: 'playing', waiting: false, totalFrames: 0 } as import('@vela/player-api').Snapshot;
  tile.snapshot(snapshot);
  expect(tile.view().state).toBe('connecting');
  tile.snapshot({ ...snapshot, sessionId: 'old', totalFrames: 1 });
  expect(tile.view().state).toBe('connecting');
  tile.snapshot({ ...snapshot, totalFrames: 1 });
  expect(tile.view().state).toBe('playing');
  tile.dispose();
});
