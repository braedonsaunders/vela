import { expect, test } from 'bun:test';
import { HOME_SLOW_MS, Home, homePresentation, initialHome } from '../src/store/home';
import { StateBox, idle } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { Bootstrap } from '../src/wire';

const bootstrap = { viewer: { id: 'v', name: 'Viewer' }, heroes: [], rows: [], defaultSkinId: 'cinematic', capabilities: { skins: [], features: {} } } as unknown as Bootstrap;

test('home moves from its skeleton to an honest slow state at seven seconds', () => {
  expect(homePresentation('loading', false, 0)).toBe('skeleton');
  expect(homePresentation('loading', false, HOME_SLOW_MS - 1)).toBe('skeleton');
  expect(homePresentation('loading', false, HOME_SLOW_MS)).toBe('slow');
  expect(homePresentation('loading', true, HOME_SLOW_MS)).toBe('ready');
  expect(homePresentation('failed', false, HOME_SLOW_MS)).toBe('failed');
});

test('home shares concurrent reads and stays cached until explicit refresh or a new session', async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  let calls = 0, reset = () => {};
  const data = bootstrap;
  const api = { home: async () => { calls++; return data; } };
  const session = { epoch: 0, onReset(fn: () => void) { reset = fn; }, negotiate: async () => {},
    ready: async () => ({ adapter: api, images: async () => undefined }), check: () => {} };
  const home = new Home(box, session as unknown as Session, () => 640);
  const first = home.ensure(); expect(home.load()).toBe(first);
  await Promise.all([first, ...Array.from({ length: 20 }, () => home.ensure())]);
  expect(calls).toBe(1);
  home.watched({ titleId: 't', positionSeconds: 60, finished: false });
  await home.ensure(); expect(calls).toBe(1);
  await home.load(); expect(calls).toBe(2);
  session.epoch++; reset(); await home.ensure(); expect(calls).toBe(3);
});

test('slow state settles with the answer and concurrent viewer retries make one replacement read', async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  let calls = 0;
  const api = { home: (_fresh = false, signal?: AbortSignal) => {
    calls++;
    if (calls > 1) return Promise.resolve(bootstrap);
    return new Promise<Bootstrap>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } };
  const session = { epoch: 0, onReset() {}, negotiate: async () => {},
    ready: async () => ({ adapter: api, images: async () => undefined }), check: () => {} };
  const home = new Home(box, session as unknown as Session, () => 640, 5);
  const first = home.ensure();
  await Bun.sleep(10);
  expect(box.get().home.slow).toBe(true);
  await Promise.all([home.retry(), home.retry()]);
  await first;
  expect(calls).toBe(2);
  expect(box.get().home.load).toBe('ready');
  expect(box.get().home.slow).toBe(false);
});

test('a session reset while Home waits cannot publish the old server answer', async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  let reset = () => {};
  const answers: ((value: Bootstrap) => void)[] = [];
  const api = { home: () => new Promise<Bootstrap>(resolve => answers.push(resolve)) };
  const session = { epoch: 0, onReset(fn: () => void) { reset = fn; }, negotiate: async () => {},
    ready: async () => ({ adapter: api, images: async () => undefined }),
    check(epoch: number) { if (epoch !== this.epoch) throw new Error('stale session'); } };
  const home = new Home(box, session as unknown as Session, () => 640, 5);
  const old = home.ensure();
  while (!answers[0]) await Bun.sleep(0);
  session.epoch++;
  reset();
  const current = home.ensure();
  while (!answers[1]) await Bun.sleep(0);
  answers[1]!({ ...bootstrap, defaultSkinId: 'current' });
  await current;
  answers[0]!({ ...bootstrap, defaultSkinId: 'stale' });
  await old;
  expect(box.get().home.value?.defaultSkinId).toBe('current');
  expect(box.get().home.slow).toBe(false);
});

test('refreshing refused artwork bypasses revalidation, coalesces reads and preserves the home carousel', async () => {
  const title = (url: string) => ({ id: 't', kind: 'movie', name: 'Title', summary: '', genres: [], artwork: [
    { id: 'art', kind: 'backdrop', tag: '1', sizes: [{ width: 1920, height: 1080, url }] },
  ] });
  const data = (url: string) => ({ viewer: { id: 'v', name: 'Viewer' }, heroes: [{ title: title(url), receiptToken: 'receipt', reason: 'featured', action: { kind: 'play', titleId: 't' } }], rows: [], defaultSkinId: 'cinematic', capabilities: { skins: [], features: {} } });
  const calls: boolean[] = [];
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  const detailCalls: boolean[] = [];
  const api = { home: async (fresh = false) => { calls.push(fresh); return data(fresh ? '/fresh' : '/expired'); },
    detail: async (_id: string, fresh: boolean) => { detailCalls.push(fresh); return { title: title('/detail-fresh') }; } };
  const session = { epoch: 0, onReset() {}, negotiate: async () => {}, ready: async () => ({ adapter: api, images: async () => ({ origin: 'https://ether.test' }) }), check() {} };
  const home = new Home(box, session as unknown as Session, () => 1920);
  await home.ensure();
  home.watched({ titleId: 't', positionSeconds: 60, finished: false });
  const rows = box.get().home.value!.rows;
  await Promise.all([home.refreshArtwork('t'), home.refreshArtwork('t')]);
  expect(calls).toEqual([false, true]);
  expect(box.get().home.value!.hero[0]!.backdrop).toBe('https://ether.test/fresh');
  expect(box.get().home.value!.hero[0]!.progressSeconds).toBe(60);
  expect(box.get().home.value!.rows).toBe(rows);
  api.home = async () => ({ ...data('/unused'), heroes: [] });
  await home.refreshArtwork('t');
  expect(detailCalls).toEqual([true]);
  expect(box.get().home.value!.hero[0]!.backdrop).toBe('https://ether.test/detail-fresh');
  expect(box.get().home.value!.hero[0]!.progressSeconds).toBe(60);
});
