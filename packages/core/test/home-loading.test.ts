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

const progressTitle = (id: string, positionSeconds: number) => ({
  id, kind: 'movie', name: id, summary: '', genres: [], durationSeconds: 100,
  artwork: [], watch: { positionSeconds, played: false, favorite: false, watchlisted: false },
});
const progressBootstrap = (id?: string, positionSeconds = 0) => ({
  ...bootstrap,
  rows: id ? [{ id: 'continue', name: 'Continue Watching', purpose: 'continue', receiptToken: '', continuation: 'exhausted', items: [
    { id: `entry:${id}`, kind: 'title', title: progressTitle(id, positionSeconds), receiptToken: '' },
  ] }] : [{ id: 'ordinary', name: 'Ordinary', purpose: 'recommendation', receiptToken: '', continuation: 'exhausted', items: [
    { id: 'ordinary:item', kind: 'title', title: progressTitle('ordinary', 0), receiptToken: '' },
  ] }],
}) as unknown as Bootstrap;

test('Home retries an unrecorded stop and quietly merges the recorded progress answer', async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  const answers = [progressBootstrap(), progressBootstrap(), progressBootstrap('watched', 42)];
  const calls: boolean[] = [];
  const api = { home: async (fresh = false) => { calls.push(fresh); return answers.shift()!; } };
  const session = { epoch: 0, onReset() {}, negotiate: async () => {}, ready: async () => ({ adapter: api, images: async () => undefined }), check() {} };
  const home = new Home(box, session as unknown as Session, () => 640, HOME_SLOW_MS, 1);
  await home.ensure();
  await home.reconcile({ titleId: 'watched', positionSeconds: 42, finished: false });
  expect(calls).toEqual([false, true, true]);
  expect(box.get().home.value?.rows.map(row => row.id)).toEqual(['continue', 'ordinary']);
  expect(box.get().home.progressRevision).toBe(1);
});

test('a newer stop supersedes the in-flight Home reconcile', async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  let reset = () => {};
  let firstFresh = true;
  const api = { home: (fresh = false, signal?: AbortSignal) => {
    if (!fresh) return Promise.resolve(progressBootstrap());
    if (firstFresh) {
      firstFresh = false;
      return new Promise<Bootstrap>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
    return Promise.resolve(progressBootstrap('newer', 70));
  } };
  const session = { epoch: 0, onReset(fn: () => void) { reset = fn; }, negotiate: async () => {}, ready: async () => ({ adapter: api, images: async () => undefined }), check() {} };
  const home = new Home(box, session as unknown as Session, () => 640, HOME_SLOW_MS, 1);
  await home.ensure();
  const older = home.reconcile({ titleId: 'older', positionSeconds: 20, finished: false });
  await Promise.resolve();
  const newer = home.reconcile({ titleId: 'newer', positionSeconds: 70, finished: false });
  await Promise.all([older, newer]);
  expect(box.get().home.value?.rows[0]?.items[0]?.id).toBe('newer');
  expect(box.get().home.progressRevision).toBe(1);
  reset();
});

test('a session reset cancels Home progress reconciliation and drops its answer', async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  let reset = () => {};
  const api = { home: (fresh = false, signal?: AbortSignal) => fresh
    ? new Promise<Bootstrap>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    : Promise.resolve(progressBootstrap()) };
  const session = { epoch: 0, onReset(fn: () => void) { reset = fn; }, negotiate: async () => {}, ready: async () => ({ adapter: api, images: async () => undefined }), check() {} };
  const home = new Home(box, session as unknown as Session, () => 640, HOME_SLOW_MS, 1);
  await home.ensure();
  const reading = home.reconcile({ titleId: 'watched', positionSeconds: 42, finished: false });
  await Promise.resolve();
  session.epoch++; reset();
  await reading;
  expect(box.get().home).toEqual(initialHome);
});

test('reading progress re-reads the progress shelves once and advances the library revision', async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  const fresh: boolean[] = [];
  const api = { home: async (value = false) => { fresh.push(value); return bootstrap; } };
  const session = { epoch: 0, onReset() {}, negotiate: async () => {},
    ready: async () => ({ adapter: api, images: async () => undefined }), check: () => {} };
  const home = new Home(box, session as unknown as Session, () => 640, 5);
  await home.ensure();
  // A book's place is a locator, not a position: nothing to wait for, the server's answer stands.
  await home.refreshProgress();
  expect(fresh).toEqual([false, true]);
  expect(box.get().home.progressRevision).toBe(1);
});

test('the library list never waits on probing a server for library views (a collections read that can take tens of seconds)', async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  let release!: () => void;
  const probe = new Promise<void>(resolve => { release = resolve; });
  const probed: string[] = [];
  const api = {
    libraries: async () => ({ items: [{ id: 'live', name: 'Live', kind: 'live', artwork: [] }, { id: 'movies', name: 'Movies', kind: 'movies', artwork: [] }], continuation: 'exhausted' }),
    probeLibraryViews: (id: string) => { probed.push(id); return probe; },
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter: api, images: async () => ({ origin: 'https://fixture.test' }) }), check: () => {} };
  const home = new Home(box, session as unknown as Session, () => 640);
  await home.libraries();
  const listed = box.get().libraries;
  expect(listed.load).toBe('ready');
  expect(listed.value?.map(library => library.id)).toEqual(['live', 'movies']);
  expect(probed).toEqual(['movies']);
  // Once the probe answers, the same list is published again so library pages learn what they can show.
  release();
  await probe; await Promise.resolve();
  expect(box.get().libraries.value).not.toBe(listed.value);
  expect(box.get().libraries.value).toEqual(listed.value);
});

test("libraries listed before the server's features are known choose by class, then again by the server's word", async () => {
  const box = new StateBox({ home: initialHome, libraries: idle() } as unknown as VelaState);
  const library = (id: string, media: string, experience?: string) => ({ id, name: id, kind: 'mixed', media, artwork: [], ...(experience ? { presentation: { card: 'square', experience } } : {}) });
  const features = { libraryExperiences: { available: true, experiences: ['audio', 'standard'] } };
  const api = {
    libraries: async () => ({ items: [library('music', 'music', 'standard'), library('books', 'audiobook', 'audio'), library('shows', 'podcast')], continuation: 'exhausted' }),
    home: async () => ({ ...bootstrap, capabilities: { ...bootstrap.capabilities, features } }),
  };
  const session = { epoch: 0, features: undefined as unknown, onReset() {}, negotiate: async () => {},
    ready: async () => ({ adapter: api, images: async () => ({ origin: 'https://fixture.test' }) }), check: () => {} };
  const home = new Home(box, session as unknown as Session, () => 640);
  await home.libraries();
  expect(box.get().libraries.value?.map(l => [l.id, l.experience])).toEqual([['music', 'audio'], ['books', 'standard'], ['shows', 'standard']]);
  await home.ensure();
  expect(box.get().libraries.value?.map(l => [l.id, l.experience])).toEqual([['music', 'standard'], ['books', 'audio'], ['shows', 'standard']]);
  // Listed again with the features known, the server's word stands from the start.
  await home.libraries();
  expect(box.get().libraries.value?.map(l => [l.id, l.experience])).toEqual([['music', 'standard'], ['books', 'audio'], ['shows', 'standard']]);
});
