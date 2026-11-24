// The screens store against the mock, end to end: the Sports screen from bootstrap navigation, its
// first read, a lazy source, a param change re-reading by deps, a favourite with its optimistic
// patch, and the page topic followed on the stream until the page closes.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createVela, type Vela } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import { launchMock, type RunningMock } from '../../../mock-server/test/launch';
import { MemoryStore } from './helpers';

let mock: RunningMock;
let store: Vela;
const device = { id: 'screens-mock-device-123', name: 'Browser', platform: 'web', appVersion: '0.2.9' };

beforeAll(async () => {
  mock = await launchMock({ VELA_MOCK_LIVE_TICK_MS: '100' });
  const code = (await (await fetch(`${mock.url}/__admin/web-code`, { method: 'POST' })).json()).code as string;
  store = createVela({ etherOrigin: mock.url, secrets: new MemoryStore(), device, appVersion: '0.2.9', rendererVersion: 19,
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

test('the Sports screen opens from navigation, reads, follows its topic and patches a favourite', async () => {
  const nav = store.getState().home.value!.screens[0]!;
  expect(nav).toMatchObject({ id: 'sports', page: 'index', document: { renderer: 19 } });
  const target = { kind: 'screen' as const, id: 'sports', page: 'index' };
  const first = store.screens.open({ target, href: nav.document.href, params: {} });
  const page = () => store.getState().screens.pages[first.key];
  await until(() => page()?.load === 'ready');
  expect(store.getState().screens.documents[nav.document.href]?.load).toBe('ready');
  expect(Object.keys(page()!.sources).sort()).toEqual(['also', 'hero', 'leagues', 'live', 'schedule', 'viewer', 'yours']);
  const hero = (page()!.sources.hero as { events: { $record: string }[] }).events[0]!.$record;
  expect(store.screens.records.get(hero)?.value).toMatchObject({ phase: expect.any(String) });
  // The page's topic is followed on one stream; pushed records keep arriving.
  await until(() => store.getState().screens.stream === 'open');
  expect(store.screens.query().topics).toEqual([page()!.topic!]);
  // Lazy: the team picker.
  await store.screens.need(first.key, ['teams']);
  const teams = page()!.sources.teams as { entities: { $record: string }[] };
  // A team not yet followed (unfollowing the last of a league's favourites may move the picker's opening league).
  const ref = teams.entities.map(entity => entity.$record).find(key => !(store.screens.records.get(key)!.value as { favourite: boolean }).favourite)!;
  const before = store.screens.records.get(ref)!.value as { favourite: boolean };
  const pressed = store.screens.action(first.key, { name: 'ether.favorite', args: { ref, on: !before.favourite }, optimistic: { record: ref, path: 'favourite', value: !before.favourite }, control: 'chip' });
  expect((store.screens.records.get(ref)!.value as { favourite: boolean }).favourite).toBe(!before.favourite);
  await pressed;
  expect((store.screens.records.get(ref)!.value as { favourite: boolean }).favourite).toBe(!before.favourite);
  expect(store.getState().screens.busy).toEqual({});
  // A league change re-reads only the sources reading it; the rest keep their value.
  const viewer = page()!.sources.viewer;
  first.release();
  const next = store.screens.open({ target, href: nav.document.href, params: { league: 'nhl' } }, first.key);
  await until(() => store.getState().screens.pages[next.key]?.pending.hero === undefined && !!store.getState().screens.pages[next.key]?.sources.hero);
  await until(() => Object.keys(store.getState().screens.pages[next.key]!.pending).length === 0);
  expect(store.getState().screens.pages[next.key]!.sources.viewer).toBe(viewer);
  next.release();
  await until(() => store.getState().screens.stream === 'idle');
});
