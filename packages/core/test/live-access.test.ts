import { expect, test } from 'bun:test';
import { Live, initialLive } from '../src/store/live';
import type { Session } from '../src/store/session';
import type { Playback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';

test.each([true, false])('unavailable Live TV creates no controller (bootstrap loaded: %s)', async bootstrapped => {
  let reads = 0;
  const features = { liveTV: { available: false, reason: 'No accessible Plex DVR' } };
  const adapter = { channels() { reads++; }, guide() { reads++; }, describe: async () => ({ features }) };
  const session = {
    onReset() {}, ready: async () => ({ adapter }),
    features: bootstrapped ? features : undefined,
    tokens: async () => { throw new Error('Unavailable Live TV must not request tokens'); },
  };
  const box = new StateBox({ live: initialLive } as unknown as VelaState);
  const live = new Live(box, session as unknown as Session, {} as Playback);
  expect(await live.access()).toBeNull();
  expect(reads).toBe(0);
});

test('controller access forwards optional complete-window reads with the adapter receiver', async () => {
  const query = { channelIds: ['one'], from: '2026-11-18T12:00:00Z', until: '2026-11-18T15:00:00Z' };
  const adapter = {
    channels: async () => ({ items: [], continuation: 'exhausted' }), guide: async () => ({}),
    guideWindow: async function (request: typeof query) {
      expect(this).toBe(adapter);
      return { ...request, revision: 'revision', validUntil: '2026-11-18T16:00:00Z', channels: [] };
    },
  };
  const connection = { record: { id: 'server' }, adapter, images: async () => ({}) };
  const session = {
    onReset() {}, ready: async () => connection, features: { liveTV: { available: true } },
    tokens: async () => null, declared: async () => ({}),
  };
  const live = new Live(new StateBox({ live: initialLive } as unknown as VelaState), session as unknown as Session, { server: {} } as unknown as Playback);
  const access = await live.access();
  expect((await access?.api.guideWindow?.(query))?.revision).toBe('revision');
});

test('a cold guide reads the signed-in viewer’s archive capability', async () => {
  const adapter = {
    channels() {}, guide() {},
    describe: async () => { throw new Error('Public capabilities omit this viewer’s archive'); },
    viewerLiveFeatures: async () => ({
      liveTV: { available: true },
      liveCatchUp: { available: true, maxDays: 2, timeshift: { available: true, maxMinutes: 60 } },
    }),
  };
  const connection = { record: { id: 'server' }, adapter, images: async () => ({}) };
  const session = { onReset() {}, ready: async () => connection, tokens: async () => null, declared: async () => ({}) };
  const live = new Live(new StateBox({ live: initialLive } as unknown as VelaState), session as unknown as Session, { server: {} } as unknown as Playback);
  expect((await live.access())?.catchUp).toEqual({ archive: true, maxDays: 2, timeshift: true });
});
