// The live-events store against the mock: screens and details read, one shared stream that
// follows mounted views and stops when they leave, reveals and favourites.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createVela, type Vela } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import { screenKey } from '../src/store/live-events';
import { launchMock, type RunningMock } from '../../../mock-server/test/launch';
import { MemoryStore } from './helpers';
import type * as V from '../src/wire';

let mock: RunningMock;
let store: Vela;
const NFL = 'sports:sports:nfl-nyg-phi';
const device = { id: 'live-events-device-123', name: 'Browser', platform: 'web', appVersion: '0.2.9' };

beforeAll(async () => {
  mock = await launchMock({ VELA_MOCK_LIVE_TICK_MS: '100' });
  const code = (await (await fetch(`${mock.url}/__admin/web-code`, { method: 'POST' })).json()).code as string;
  store = createVela({ etherOrigin: mock.url, secrets: new MemoryStore(), device, appVersion: '0.2.9', rendererVersion: 17,
    media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: { native: false, fmp4: false, mpegTs: false }, mse: false } as never,
    page: { origin: mock.url, webCode: code }, artWidth: 640 } as VelaPlatform & { rendererVersion: number });
  await store.auth.start();
  await store.home.ensure();
});
afterAll(async () => { await mock?.stop(); });

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(20);
  }
}

test('home lists the sports screen from bootstrap navigation, and the store sees the feature', () => {
  expect(store.getState().home.value?.screens).toMatchObject([{ id: 'sports', title: 'Sports', icon: 'sports', page: 'index', document: { renderer: 19 } }]);
  expect(store.liveEvents.available()).toBe(true);
});

test('a screen read fills the shared event map', async () => {
  await store.liveEvents.loadScreen('sports');
  const screen = store.getState().liveEvents.screens[screenKey('sports')]!;
  expect(screen.load).toBe('ready');
  expect(screen.value!.sections[0]!.type).toBe('hero');
  expect(store.getState().liveEvents.events[NFL]?.league.id).toBe('nfl');
});

test('following an event opens one stream that pushes its changes, and leaving closes it', async () => {
  const before = store.getState().liveEvents.events[NFL]!.updatedAt;
  const stop = store.liveEvents.follow({ events: [NFL] });
  const also = store.liveEvents.follow({ events: [NFL], alerts: true });
  expect(store.liveEvents.query()).toEqual({ events: [NFL], screens: [], alerts: true });
  await until(() => store.getState().liveEvents.stream === 'open');
  await until(() => store.getState().liveEvents.events[NFL]!.updatedAt !== before);
  stop(); also();
  await until(() => store.getState().liveEvents.stream === 'idle');
});

test('a detail carries plays; revealing a spoiler-free event shows its score', async () => {
  await store.liveEvents.loadDetail(NFL);
  expect(store.getState().liveEvents.details[NFL]!.value!.plays.length).toBeGreaterThan(0);
  const hidden = 'sports:sports:epl-che-mci';
  await store.liveEvents.loadDetail(hidden);
  expect(store.getState().liveEvents.events[hidden]!.spoiler).toBe(true);
  await store.liveEvents.reveal(hidden);
  const shown = store.getState().liveEvents.events[hidden]!;
  expect(shown.spoiler).toBeUndefined();
  expect(shown.competitors.map((c: V.LiveCompetitor) => c.score)).toEqual(['1', '3']);
});

test('a favourite applies at once and survives the server answer', async () => {
  await store.liveEvents.loadEntities({ league: 'nba' });
  const celtics = store.getState().liveEvents.entities['|nba|']!.value!.find(entity => entity.abbr === 'BOS')!;
  expect(store.liveEvents.isFavorite(celtics)).toBe(false);
  const change = store.liveEvents.setFavorite(celtics.key!, true);
  expect(store.liveEvents.isFavorite(celtics)).toBe(true);
  await change;
  await store.liveEvents.loadEntities({ league: 'nba' });
  const again = store.getState().liveEvents.entities['|nba|']!.value!.find(entity => entity.abbr === 'BOS')!;
  expect(again.favorite).toBe(true);
  await store.liveEvents.setFavorite(celtics.key!, false);
});

test('hiding scores applies at once, withholds every started event, and showing them restores the scores', async () => {
  await store.liveEvents.loadPreferences();
  expect(store.getState().liveEvents.spoilerFree).toBe(false);
  expect(store.liveEvents.canSetPreferences()).toBe(true);
  await store.liveEvents.loadScreen('sports');
  const change = store.liveEvents.setSpoilerFree(true);
  expect(store.getState().liveEvents.spoilerFree).toBe(true);
  await change;
  await until(() => store.getState().liveEvents.events[NFL]!.spoiler === true);
  expect(store.getState().liveEvents.events[NFL]!.competitors.every((c: V.LiveCompetitor) => c.score === undefined)).toBe(true);
  await store.liveEvents.setSpoilerFree(false);
  await until(() => store.getState().liveEvents.events[NFL]!.spoiler !== true);
  expect(store.getState().liveEvents.events[NFL]!.competitors.every((c: V.LiveCompetitor) => typeof c.score === 'string')).toBe(true);
});
