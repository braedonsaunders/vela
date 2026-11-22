import { expect, test } from 'bun:test';
import { VelaError } from '@vela/core';
import type { Snapshot } from '@vela/player-api';
import type { PlaybackPlan } from '../../protocol/types';
import { MultiviewController, type MultiviewSource, type MultiviewTileRequest } from '../src/widgets/multiview/controller';
import { bugSides } from '../src/widgets/multiview/bug-model';
import { connectionCap, tileRefusal } from '../src/widgets/multiview/refusal';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const playing = (sessionId: string) => ({ sessionId, state: 'playing', waiting: false, totalFrames: 10 }) as unknown as Snapshot;
const capError = () => new VelaError({
  class: 'capacity', code: 'provider_connection_cap', message: 'Provider connection limit reached', retry: { allowed: false },
  details: { provider: 'Acme IPTV', max: 2, inUse: 2 },
} as never, 409);

function fakeSource(refuse: (channelId: string) => unknown = () => null) {
  const calls = { opened: 0, closed: [] as string[], tunes: [] as { channelId: string; request: MultiviewTileRequest }[], stopped: [] as string[] };
  let session = 0;
  const source: MultiviewSource = {
    open: async () => { calls.opened++; return { groupId: 'g1', maxTiles: 4 }; },
    close: async groupId => { calls.closed.push(groupId); },
    tune: async (channelId, request) => {
      calls.tunes.push({ channelId, request });
      const error = refuse(channelId);
      if (error) throw error;
      return { sessionId: `s${++session}-${channelId}`, channelId } as unknown as PlaybackPlan;
    },
    stop: async plan => { calls.stopped.push(plan.sessionId); },
  };
  return { source, calls };
}

test('opening asks for a group, then every tile plays in it with its index and the height cap', async () => {
  const { source, calls } = fakeSource();
  const mv = new MultiviewController({ source });
  for (const id of ['a', 'b', 'c', 'd']) mv.add(id);
  expect(calls.tunes).toHaveLength(0);
  mv.open();
  await settle();
  expect(calls.opened).toBe(1);
  expect(calls.tunes.map(t => [t.channelId, t.request])).toEqual([
    ['a', { groupId: 'g1', tile: 0, maxHeight: 720 }], ['b', { groupId: 'g1', tile: 1, maxHeight: 720 }],
    ['c', { groupId: 'g1', tile: 2, maxHeight: 720 }], ['d', { groupId: 'g1', tile: 3, maxHeight: 720 }],
  ]);
  expect(mv.view().tiles.every(tile => tile.plan !== null && tile.state === 'tuning')).toBe(true);
  mv.snapshot(0, playing(mv.view().tiles[0]!.plan!.sessionId));
  expect(mv.view().tiles[0]!.state).toBe('playing');
});

test('two tiles ask for 1080p', async () => {
  const { source, calls } = fakeSource();
  const mv = new MultiviewController({ source });
  mv.add('a'); mv.add('b');
  mv.open();
  await settle();
  expect(calls.tunes.map(t => t.request.maxHeight)).toEqual([1080, 1080]);
});

test('audio follows focus: only the focused tile is unmuted, by commands with rising ids', async () => {
  const { source } = fakeSource();
  const mv = new MultiviewController({ source });
  for (const id of ['a', 'b', 'c']) mv.add(id);
  const muted = () => mv.view().tiles.map(tile => tile.muted);
  expect(mv.view().focused).toBe(0);
  expect(muted()).toEqual([false, true, true]);
  const before = mv.view().tiles.map(tile => tile.command!.id);
  mv.focus(2);
  expect(muted()).toEqual([true, true, false]);
  const after = mv.view().tiles.map(tile => tile.command!);
  expect(after[0]).toMatchObject({ type: 'mute', muted: true });
  expect(after[0]!.id).toBeGreaterThan(before[0]!);
  // An unchanged tile keeps its last command, so its player sees nothing new.
  expect(after[1]!.id).toBe(before[1]!);
  expect(after[2]).toMatchObject({ type: 'mute', muted: false });
});

test('full screen takes the focus and the audio, and back returns to the grid', () => {
  const { source } = fakeSource();
  const mv = new MultiviewController({ source });
  mv.add('a'); mv.add('b');
  mv.toggleFullscreen(1);
  expect(mv.view().fullscreen).toBe(1);
  expect(mv.view().focused).toBe(1);
  expect(mv.view().tiles[1]!.muted).toBe(false);
  expect(mv.exitFullscreen()).toBe(true);
  expect(mv.view().fullscreen).toBe(-1);
  expect(mv.exitFullscreen()).toBe(false);
});

test('a provider cap fails only its own tile, in words naming the channel, and the others keep playing', async () => {
  const { source } = fakeSource(id => (id === 'espn' ? capError() : null));
  const mv = new MultiviewController({ source, channelName: id => (id === 'espn' ? 'ESPN' : id) });
  for (const id of ['a', 'b', 'espn']) mv.add(id);
  mv.open();
  await settle();
  const [a, b, espn] = mv.view().tiles;
  expect(a!.plan).not.toBeNull();
  expect(b!.plan).not.toBeNull();
  expect(espn!.state).toBe('failed');
  expect(espn!.refusal?.title).toBe("ESPN's provider allows 2 connections");
  expect(espn!.refusal?.detail).toContain('Acme IPTV: 2 of 2 in use');
  expect(espn!.refusal?.retry).toBe(false);
});

test('swapping a tile stops its session and tunes the new channel in the same tile index', async () => {
  const { source, calls } = fakeSource();
  const mv = new MultiviewController({ source });
  mv.add('a'); mv.add('b');
  mv.open();
  await settle();
  const old = mv.view().tiles[1]!.plan!.sessionId;
  mv.swap(1, 'z');
  await settle();
  expect(calls.stopped).toEqual([old]);
  expect(calls.tunes.at(-1)).toEqual({ channelId: 'z', request: { groupId: 'g1', tile: 1, maxHeight: 1080 } });
  expect(mv.view().tiles[1]!.channelId).toBe('z');
});

test('swapping to a channel already on another tile trades the two places', async () => {
  const { source, calls } = fakeSource();
  const mv = new MultiviewController({ source });
  mv.add('a'); mv.add('b');
  mv.open();
  await settle();
  mv.swap(0, 'b');
  expect(mv.view().tiles.map(tile => tile.channelId)).toEqual(['b', 'a']);
  expect(calls.stopped).toEqual([]);
});

test('adding beyond four replaces the focused tile; a channel already shown is focused instead', () => {
  const { source } = fakeSource();
  const mv = new MultiviewController({ source });
  for (const id of ['a', 'b', 'c', 'd']) mv.add(id);
  mv.focus(2);
  expect(mv.add('e')).toBe(2);
  expect(mv.channels).toEqual(['a', 'b', 'e', 'd']);
  expect(mv.add('a')).toBe(0);
  expect(mv.view().focused).toBe(0);
});

test('removing a tile frees its index for the next channel and moves the focus on', async () => {
  const { source, calls } = fakeSource();
  const mv = new MultiviewController({ source });
  for (const id of ['a', 'b', 'c']) mv.add(id);
  mv.open();
  await settle();
  mv.focus(1);
  mv.remove(1);
  expect(mv.view().tiles.map(tile => tile.slot)).toEqual([0, 2]);
  expect(mv.view().focused).toBe(2);
  mv.add('d');
  await settle();
  expect(calls.tunes.at(-1)?.request.tile).toBe(1);
});

test('leaving deletes the group and forgets the sessions; the channels stay for next time', async () => {
  const { source, calls } = fakeSource();
  const mv = new MultiviewController({ source });
  mv.add('a'); mv.add('b');
  const close = mv.open();
  await settle();
  close();
  expect(calls.closed).toEqual(['g1']);
  expect(calls.stopped).toEqual([]);
  expect(mv.view().phase).toBe('closed');
  expect(mv.view().tiles.every(tile => tile.plan === null)).toBe(true);
  expect(mv.channels).toEqual(['a', 'b']);
});

test('a group that fails to delete has each tile stopped instead', async () => {
  const { source, calls } = fakeSource();
  source.close = async () => { throw new Error('gone'); };
  const mv = new MultiviewController({ source });
  mv.add('a');
  const close = mv.open();
  await settle();
  close();
  await settle();
  await settle();
  expect(calls.stopped).toHaveLength(1);
});

test('a plan that arrives after leaving is stopped, not shown', async () => {
  let release: (plan: PlaybackPlan) => void = () => {};
  const stopped: string[] = [];
  const source: MultiviewSource = {
    open: async () => ({ groupId: 'g', maxTiles: 4 }),
    close: async () => {},
    tune: () => new Promise(resolve => { release = resolve; }),
    stop: async plan => { stopped.push(plan.sessionId); },
  };
  const mv = new MultiviewController({ source });
  mv.add('a');
  const close = mv.open();
  await settle();
  close();
  release({ sessionId: 'late' } as PlaybackPlan);
  await settle();
  expect(stopped).toEqual(['late']);
  expect(mv.view().tiles[0]!.plan).toBeNull();
});

test('a superseded tune is asked once more before the tile gives up', async () => {
  let attempts = 0;
  const { source } = fakeSource(() => (++attempts === 1 ? new VelaError({ class: 'conflict', code: 'cancelled', message: 'cancelled', retry: { allowed: false } }, 409) : null));
  const mv = new MultiviewController({ source });
  mv.add('a');
  mv.open();
  await settle();
  await settle();
  expect(attempts).toBe(2);
  expect(mv.view().tiles[0]!.plan).not.toBeNull();
});

test('a tile follows the live event its plan and the session stream name', async () => {
  const { source } = fakeSource();
  source.tune = async (channelId) => ({ sessionId: `s-${channelId}`, liveEvent: { id: 'sports:nfl:1', feed: 'sports' } }) as unknown as PlaybackPlan;
  const mv = new MultiviewController({ source });
  mv.add('a');
  mv.open();
  await settle();
  expect(mv.view().tiles[0]!.liveEvent).toEqual({ id: 'sports:nfl:1', feed: 'sports' });
  mv.setLiveEvent('s-a', null);
  expect(mv.view().tiles[0]!.liveEvent).toBeNull();
});

test('a player failure on a tile shows on that tile, and Try again tunes it afresh', async () => {
  const { source, calls } = fakeSource();
  const mv = new MultiviewController({ source });
  mv.add('a');
  mv.open();
  await settle();
  const sessionId = mv.view().tiles[0]!.plan!.sessionId;
  mv.failed(0, sessionId, 'decoder gave up');
  expect(mv.view().tiles[0]!.state).toBe('failed');
  expect(calls.stopped).toEqual([sessionId]);
  mv.retry(0);
  await settle();
  expect(mv.view().tiles[0]!.state).toBe('tuning');
  expect(calls.tunes).toHaveLength(2);
});

test('the cap details are read only from the typed refusal', () => {
  expect(connectionCap(capError())).toEqual({ provider: 'Acme IPTV', max: 2, inUse: 2 });
  expect(connectionCap(new Error('x'))).toBeNull();
  const one = new VelaError({ class: 'capacity', code: 'provider_connection_cap', message: '', retry: { allowed: false }, details: { max: 1 } } as never, 409);
  expect(tileRefusal(one, 'ESPN').title).toBe("ESPN's provider allows 1 connection");
});

test('the bug prints away first and hides a spoiler or a game not yet started', () => {
  const event = (state: string, spoiler = false) => ({ status: { state, detail: '' }, spoiler,
    competitors: [{ abbr: 'PHI', score: '27', home: true }, { abbr: 'NYG', score: '24', home: false }] });
  expect(bugSides(event('in'))).toEqual({ left: 'NYG', right: 'PHI', score: '24–27' });
  expect(bugSides(event('pre'))?.score).toBe('');
  expect(bugSides(event('in', true))?.score).toBe('');
  expect(bugSides({ status: { state: 'in', detail: '' }, competitors: [] })).toBeNull();
});
