// Vela's own sources on a server that lacks the parts (a Jellyfin or Plex adapter): each answers
// `unsupported` on its own, while the device's own records (the queue) still answer; arguments are
// checked before anything is read; live sources are followed only while bound.
import { expect, test } from 'bun:test';
import { LocalSources, type LocalStores } from '../src/screens/local';
import { RecordStore } from '../src/screens/records';
import { initialAudio } from '../src/store/audio';
import { initialMusic } from '../src/store/music';
import { createQueue } from '../src/audio/queue';
import type { Card } from '../src/models';

function harness() {
  let state = { audio: initialAudio, music: initialMusic, playlists: { list: { load: 'idle', error: '' } }, titles: {}, children: {}, collections: {}, related: {}, library: {} };
  const listeners = new Set<() => void>();
  const stores = {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    music: { likedAvailable: false, lyricsAvailable: false, recentAvailable: false, recapAvailable: false, duplicatesAvailable: false, playlistImportAvailable: false },
    playlists: { available: false },
    media: { features: () => ({ childRoles: false }) },
    home: { ensure: async () => undefined },
  } as unknown as LocalStores;
  const records = new RecordStore();
  const local = new LocalSources(stores, { ready: async () => ({ adapter: {} }), features: () => ({}) as never }, records);
  const setAudio = (audio: typeof initialAudio) => { state = { ...state, audio }; for (const listener of listeners) listener(); };
  return { local, records, setAudio, listeners };
}

const scope = { params: {} };

test('what the server cannot answer reads unsupported, per source', async () => {
  const { local } = harness();
  expect(await local.read({ from: 'vela.children', id: 'a' }, scope)).toEqual({ error: 'unsupported' });
  expect(await local.read({ from: 'vela.favorites', role: 'track' }, scope)).toEqual({ error: 'unsupported' });
  expect(await local.read({ from: 'vela.lyrics', id: 'a' }, scope)).toEqual({ error: 'unsupported' });
  expect(await local.read({ from: 'vela.recap', period: 'week' }, scope)).toEqual({ error: 'unsupported' });
  expect(await local.read({ from: 'vela.playlists' }, scope)).toEqual({ error: 'unsupported' });
  expect(await local.read({ from: 'vela.visualizer' }, scope)).toEqual({ error: 'unsupported' });
  expect(await local.read({ from: 'vela.unknown' }, scope)).toEqual({ error: 'unsupported' });
});

test('a required argument left empty is refused before any read', async () => {
  const { local } = harness();
  expect(await local.read({ from: 'vela.title', id: '{param.id}' }, scope)).toEqual({ error: 'invalid_request' });
});

test('the queue answers on any server, and follows the audio store only while bound', async () => {
  const { local, records, setAudio, listeners } = harness();
  const answer = await local.read({ from: 'vela.queue' }, scope);
  expect(answer).toMatchObject({ value: { $record: 'queue:current' } });
  if ('value' in answer) local.write(answer.records);
  expect(records.get('queue:current')?.value).toMatchObject({ at: -1 });

  const stop = local.bind('vela.queue');
  const again = local.bind('vela.queue');
  const track = { id: 't1', name: 'One', kind: 'episode' } as Card;
  setAudio({ ...initialAudio, queue: createQueue([track], 0) });
  expect(records.get('queue:current')?.value).toMatchObject({ at: 0, current: { $record: 'item:t1' } });
  expect(records.get('item:t1')?.value).toMatchObject({ name: 'One' });
  stop();
  expect(local.following('vela.queue')).toBe(true);
  again();
  expect(local.following('vela.queue')).toBe(false);
  expect(listeners.size).toBe(0);
});

test('Now Playing is rewritten only when its whole-second value changes', () => {
  const { local, records, setAudio } = harness();
  const track = { id: 't1', name: 'One', kind: 'episode' } as Card;
  const queue = createQueue([track], 0);
  const stop = local.bind('vela.nowPlaying');
  setAudio({ ...initialAudio, queue, phase: 'playing', positionSeconds: 10.1, durationSeconds: 100 });
  const first = records.get('nowPlaying:current');
  setAudio({ ...initialAudio, queue, phase: 'playing', positionSeconds: 10.6, durationSeconds: 100 });
  expect(records.get('nowPlaying:current')).toBe(first!);
  setAudio({ ...initialAudio, queue, phase: 'playing', positionSeconds: 11.0, durationSeconds: 100 });
  expect(records.get('nowPlaying:current')).not.toBe(first!);
  expect((records.get('nowPlaying:current')?.value as { position: number }).position).toBe(11);
  stop();
});

test('the visualizer setting is a device record, set by its action', async () => {
  const { local, records } = harness();
  let choice = { scene: 'aurora', enabled: true };
  const listeners = new Set<() => void>();
  local.setVisualizer({
    get: () => choice,
    set: id => { choice = id === 'off' ? { ...choice, enabled: false } : { scene: id, enabled: true }; for (const listener of listeners) listener(); },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  });
  const stop = local.bind('vela.visualizer');
  expect(records.get('setting:visualizer')?.value).toEqual({ scene: 'aurora', enabled: true });
  await local.action('vela.setVisualizerScene', { id: 'off' }, { specs: {}, values: {}, scope });
  expect(records.get('setting:visualizer')?.value).toEqual({ scene: 'aurora', enabled: false });
  stop();
  expect(listeners.size).toBe(0);
  await expect(local.action('vela.like', { item: 'item:a' }, { specs: {}, values: {}, scope })).rejects.toThrow();
});
