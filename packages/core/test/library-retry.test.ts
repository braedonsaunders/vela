// A library view the server is still preparing (503, retry allowed) is asked again on the
// server's terms while the view stays loading; anything else, or leaving the view, ends it.
import { expect, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { Catalogue } from '../src/store/catalogue';
import { readRetryDelay, withReadRetry } from '../src/store/read-retry';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { Page, RowEntry } from '../src/wire';

const pending = (retry: VelaError['detail']['retry'] = { allowed: true, afterSeconds: 2, maxAttempts: 3 }, retryAfter: string | null = null) =>
  new VelaError({ class: 'transient', code: 'preparation_pending', message: 'Preparing', retry }, 503, retryAfter);
const forbidden = () => new VelaError({ class: 'policy', code: 'forbidden', message: 'No', retry: { allowed: false } }, 403);

/** A clock tests advance by hand: each wait is recorded and resolved when told. */
function manualSleep() {
  const waits: { ms: number; signal?: AbortSignal; resolve(): void; reject(reason: unknown): void }[] = [];
  const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const wait = { ms, signal, resolve, reject };
    waits.push(wait);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  return { waits, sleep };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('the delay honours the server: allowed, afterSeconds, Retry-After and maxAttempts', () => {
  expect(readRetryDelay(pending(), 0)).toBe(2000);
  expect(readRetryDelay(pending(), 1)).toBe(2000);
  expect(readRetryDelay(pending(), 2)).toBeUndefined();
  expect(readRetryDelay(pending({ allowed: true, maxAttempts: 2 }), 1)).toBeUndefined();
  expect(readRetryDelay(pending({ allowed: true }, '5'), 0)).toBe(5000);
  expect(readRetryDelay(pending({ allowed: false }), 0)).toBeUndefined();
  expect(readRetryDelay(forbidden(), 0)).toBeUndefined();
  expect(readRetryDelay(new Error('offline'), 0)).toBeUndefined();
});

test('a server asking for more attempts than our bound, or a far-off wait, is not waited for', () => {
  expect(readRetryDelay(pending({ allowed: true, maxAttempts: 10 }), 2)).toBeUndefined();
  expect(readRetryDelay(pending({ allowed: true, afterSeconds: 31 }), 0)).toBeUndefined();
  expect(readRetryDelay(pending({ allowed: true, afterSeconds: 30 }), 0)).toBe(30_000);
});

test('a temporary refusal is read again after the declared wait, then answers', async () => {
  const clock = manualSleep();
  let calls = 0;
  const reading = withReadRetry(async () => { if (++calls < 3) throw pending(); return 'ready'; }, { sleep: clock.sleep });
  await settle();
  expect(clock.waits.map(wait => wait.ms)).toEqual([2000]);
  clock.waits[0]!.resolve();
  await settle();
  expect(clock.waits.map(wait => wait.ms)).toEqual([2000, 2000]);
  clock.waits[1]!.resolve();
  expect(await reading).toBe('ready');
  expect(calls).toBe(3);
});

test('the last refusal, or a permanent one, reaches the reader as it was', async () => {
  const clock = manualSleep();
  let calls = 0;
  const reading = withReadRetry(async () => { calls++; throw pending(); }, { sleep: clock.sleep });
  await settle(); clock.waits[0]!.resolve(); await settle(); clock.waits[1]!.resolve();
  await expect(reading).rejects.toMatchObject({ detail: { code: 'preparation_pending' } });
  expect(calls).toBe(3);
  calls = 0;
  await expect(withReadRetry(async () => { calls++; throw forbidden(); }, { sleep: clock.sleep })).rejects.toMatchObject({ status: 403 });
  expect(calls).toBe(1);
});

test('leaving (abort) or a session change stops further attempts', async () => {
  const clock = manualSleep();
  const leave = new AbortController();
  let calls = 0;
  const reading = withReadRetry(async () => { calls++; throw pending(); }, { sleep: clock.sleep, signal: leave.signal });
  await settle();
  leave.abort(new Error('left'));
  await expect(reading).rejects.toThrow('left');
  expect(calls).toBe(1);

  let wanted = true;
  calls = 0;
  const moved = withReadRetry(async () => { calls++; throw pending(); }, { sleep: clock.sleep, wanted: () => wanted });
  await settle();
  wanted = false;
  clock.waits.at(-1)!.resolve();
  await expect(moved).rejects.toMatchObject({ detail: { code: 'preparation_pending' } });
  expect(calls).toBe(1);
});

function setup(collections: (cursor?: string) => Promise<Page<RowEntry>>) {
  const box = new StateBox({ library: {}, titles: {}, related: {}, collections: {}, home: { progressRevision: 0 }, libraries: { load: 'ready', value: [
    { id: 'clips', name: 'Clips', kind: 'movies', dateDisplay: 'year', backdrop: '', presentation: { card: 'landscape' } },
    { id: 'films', name: 'Films', kind: 'movies', dateDisplay: 'year', backdrop: '' },
  ] } } as unknown as VelaState);
  const calls = { collections: 0, person: [] as (string | undefined)[] };
  const entry = (id: string): RowEntry => ({ id, targetId: id, name: id, kind: 'movie', receiptToken: '', artwork: [
    { id: 'p', tag: 'p', kind: 'poster', sizes: [{ width: 600, height: 900, url: `https://fixture.test/${id}-poster.jpg` }] },
    { id: 't', tag: 't', kind: 'thumb', sizes: [{ width: 1280, height: 720, url: `https://fixture.test/${id}-thumb.jpg` }] },
  ] } as unknown as RowEntry);
  const adapter = {
    libraryRows: async () => [],
    libraryGenres: async () => [],
    libraryCollections: (_id: string, cursor?: string) => { calls.collections++; return collections(cursor); },
    personTitles: async (_id: string, libraryId?: string) => { calls.person.push(libraryId); return { items: [entry('scene')], continuation: 'exhausted' }; },
  };
  const session = { epoch: 0, onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  const clock = manualSleep();
  const catalogue = new Catalogue(box, session as unknown as Session, () => 640, { sleep: clock.sleep });
  return { catalogue, calls, clock, session };
}
const page = (name: string): Page<RowEntry> => ({ items: [{ id: name, targetId: name, name, kind: 'collection', artwork: [], receiptToken: '' } as unknown as RowEntry], continuation: 'exhausted' });

test('a collections tab still being prepared is read again and answers, never failing the view', async () => {
  let attempt = 0;
  const f = setup(async () => { if (attempt++ === 0) throw pending(); return page('Studio'); });
  const reading = f.catalogue.libraryCollectionPage('clips', 'studios');
  await settle();
  expect(f.clock.waits.map(wait => wait.ms)).toEqual([2000]);
  f.clock.waits[0]!.resolve();
  expect((await reading)?.items.map(card => card.name)).toEqual(['Studio']);
  expect(f.calls.collections).toBe(2);
  expect(f.catalogue.cachedLibraryCollections('clips', 'studios')?.items.length).toBe(1);
});

test('leaving a collections tab mid-wait ends its retries; the next visit reads afresh', async () => {
  let attempt = 0;
  const f = setup(async () => { if (attempt++ === 0) throw pending(); return page('Studio'); });
  const leave = new AbortController();
  const reading = f.catalogue.libraryCollectionPage('clips', 'studios', undefined, false, leave.signal);
  await settle();
  leave.abort(new Error('left'));
  await expect(reading).rejects.toThrow('left');
  expect(f.calls.collections).toBe(1);
  expect((await f.catalogue.libraryCollectionPage('clips', 'studios'))?.items.length).toBe(1);
});

test('a reader joining a shared read keeps it going when the first reader leaves', async () => {
  let attempt = 0;
  const f = setup(async () => { if (attempt++ === 0) throw pending(); return page('Studio'); });
  const first = new AbortController();
  const a = f.catalogue.libraryCollectionPage('clips', 'studios', undefined, false, first.signal);
  const b = f.catalogue.libraryCollectionPage('clips', 'studios', undefined, false, new AbortController().signal);
  await settle();
  first.abort(new Error('left'));
  f.clock.waits[0]!.resolve();
  expect((await b)?.items.length).toBe(1);
  expect((await a)?.items.length).toBe(1);
});

test('further collections pages are retried too', async () => {
  let attempt = 0;
  const f = setup(async () => { if (attempt++ === 0) throw pending(); return page('Next'); });
  const reading = f.catalogue.moreLibraryCollections('clips', 'c2', 'studios');
  await settle();
  f.clock.waits[0]!.resolve();
  expect((await reading).items.map(card => card.name)).toEqual(['Next']);
});

test('a person opened from a landscape library keeps its scope and shows its thumbnails', async () => {
  const f = setup(async () => page('x'));
  const scoped = await f.catalogue.personTitles('p1', 'clips');
  expect(f.calls.person).toEqual(['clips']);
  expect(scoped.items[0]!.poster).toContain('scene-thumb');
  const poster = await f.catalogue.personTitles('p1', 'films');
  expect(poster.items[0]!.poster).toContain('scene-poster');
  const unscoped = await f.catalogue.personTitles('p1');
  expect(unscoped.items[0]!.poster).toContain('scene-poster');
});
