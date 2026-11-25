// The mock music plugin's slot surface end to end: offered in bootstrap for listen.album.panel, its
// vela.title source answered on the device from the slot's title context, its own route's p:note
// record from the mock, and nothing of the vela.* source asked of the server.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createVela, type Vela } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import { launchMock, type RunningMock } from '../../../mock-server/test/launch';
import { mediaGroups } from '../../protocol/fixtures/media';
import type { TitleValue } from '../../protocol/vela-sources';
import { MemoryStore } from './helpers';

let mock: RunningMock;
let store: Vela;
const device = { id: 'slot-surface-device-123', name: 'Browser', platform: 'web', appVersion: '0.2.9' };

beforeAll(async () => {
  mock = await launchMock({});
  const code = (await (await fetch(`${mock.url}/__admin/web-code`, { method: 'POST' })).json()).code as string;
  store = createVela({ etherOrigin: mock.url, secrets: new MemoryStore(), device, appVersion: '0.2.9', rendererVersion: 20,
    media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: { native: false, fmp4: false, mpegTs: false }, mse: false } as never,
    page: { origin: mock.url, webCode: code }, artWidth: 640 } as VelaPlatform & { rendererVersion: number });
  await store.auth.start();
  await store.home.ensure();
});
afterAll(async () => { await mock?.stop(); });

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(20);
  }
}

test('the album panel slot surface reads vela.title locally and its note from the plugin', async () => {
  const surface = store.getState().home.value!.surfaces.find(item => item.id === 'music.albumNote');
  expect(surface).toMatchObject({ presentation: 'slot', slot: 'listen.album.panel', document: { renderer: 20 } });
  const album = mediaGroups.albums[0]!;
  const handle = store.screens.open({ target: { kind: 'surface', id: surface!.id }, href: surface!.document.href, context: { title: `item:${album.id}` } });
  const page = () => store.getState().screens.pages[handle.key]!;
  await until(() => page()?.load === 'ready' && Object.keys(page().pending).length === 0 && 'album' in page().sources);
  expect(page().errors).toEqual({});
  expect((page().sources.album as TitleValue).item).toEqual({ $record: `item:${album.id}` });
  expect(store.screens.records.get(`item:${album.id}`)?.value).toMatchObject({ name: album.name });
  const note = (page().sources.note as { note: { $record: string } }).note.$record;
  expect(note).toBe(`p:note:${album.id}`);
  expect((store.screens.records.get(note)?.value as { text: string }).text).toContain(album.name);
  handle.release();
});
