// A title's children read page by page (store/media.ts): pages append as they land, a later ask
// continues from the server's cursor, asks during a read join it, and a refresh abandons it.
import { expect, test } from 'bun:test';
import { CHILDREN_PAGE, Media } from '../src/store/media';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { ChildrenPage, Title } from '../src/wire';

const title = (n: number): Title => ({ id: `album-${n}`, kind: 'season', name: `Album ${n}`, artwork: [], media: { class: 'music', role: 'album', parents: [] } } as unknown as Title);

/** An artist with `count` albums, served `CHILDREN_PAGE` a page; `gate` holds each answer until released. */
function artist(count: number, options: { gate?: boolean; failAt?: string } = {}) {
  const box = new StateBox({ children: {}, titles: {} } as unknown as VelaState);
  const calls: { cursor?: string; limit?: number; signal?: AbortSignal }[] = [];
  const held: (() => void)[] = [];
  const adapter = {
    children: async (_id: string, cursor?: string, limit = 100, _role?: string, signal?: AbortSignal): Promise<ChildrenPage> => {
      calls.push({ cursor, limit, signal });
      if (options.gate) await new Promise<void>(resolve => held.push(resolve));
      if (cursor && cursor === options.failAt) { options.failAt = undefined; throw new Error('temporarily unavailable'); }
      const from = cursor ? Number(cursor) : 0;
      const to = Math.min(count, from + limit);
      const items = Array.from({ length: to - from }, (_, i) => title(from + i));
      return to < count ? { items, continuation: 'more', nextCursor: String(to) } : { items, continuation: 'exhausted' };
    },
  };
  const session = { epoch: 0, features: undefined, onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  const media = new Media(box, session as unknown as Session, () => 640);
  const state = () => box.get().children['artist'];
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const release = async () => { await settle(); held.shift()?.(); await settle(); };
  return { media, calls, state, release, settle };
}

test('every page is read, each appended as it lands, asking the server for 50 at a time', async () => {
  const f = artist(275, { gate: true });
  const read = f.media.children('artist', false, undefined, Infinity);
  await f.release();
  // The first page is drawn while the rest are read.
  expect(f.state()?.load).toBe('loading');
  expect(f.state()?.value?.items).toHaveLength(50);
  expect(f.state()?.value?.more).toBe(true);
  for (let i = 0; i < 5; i++) await f.release();
  await read;
  expect(f.calls.map(call => call.limit)).toEqual(Array(6).fill(CHILDREN_PAGE));
  expect(f.calls.map(call => call.cursor)).toEqual([undefined, '50', '100', '150', '200', '250']);
  expect(f.state()?.load).toBe('ready');
  expect(f.state()?.value?.items.map(card => card.id)).toEqual(Array.from({ length: 275 }, (_, i) => `album-${i}`));
  expect(f.state()?.value).toMatchObject({ complete: true, more: false });
});

test('a read stops at what was asked for, and asking for more continues from the cursor', async () => {
  const f = artist(120);
  await f.media.children('artist', false, undefined, 50);
  expect(f.state()?.value).toMatchObject({ complete: false, more: true });
  expect(f.state()?.value?.items).toHaveLength(50);
  // Asked again for no more: nothing is read.
  await f.media.children('artist', false, undefined, 50);
  expect(f.calls).toHaveLength(1);
  await f.media.children('artist', false, undefined, Infinity);
  expect(f.calls.map(call => call.cursor)).toEqual([undefined, '50', '100']);
  expect(f.state()?.value?.items).toHaveLength(120);
  expect(f.state()?.value).toMatchObject({ complete: true, more: false });
});

test('an ask during a read joins it, raising how far it reads', async () => {
  const f = artist(150, { gate: true });
  const first = f.media.children('artist', false, undefined, 50);
  const second = f.media.children('artist', false, undefined, Infinity);
  for (let i = 0; i < 3; i++) await f.release();
  await Promise.all([first, second]);
  expect(f.calls.map(call => call.cursor)).toEqual([undefined, '50', '100']);
  expect(f.state()?.value?.items).toHaveLength(150);
});

test('a page that fails keeps what was read, and trying again continues from there', async () => {
  const f = artist(150, { failAt: '100' });
  await f.media.children('artist', false, undefined, Infinity);
  expect(f.state()?.load).toBe('failed');
  expect(f.state()?.value?.items).toHaveLength(100);
  await f.media.children('artist', false, undefined, Infinity);
  expect(f.calls.map(call => call.cursor)).toEqual([undefined, '50', '100', '100']);
  expect(f.state()?.load).toBe('ready');
  expect(f.state()?.value?.items).toHaveLength(150);
});

test('a refresh abandons the read under way and starts from the first page', async () => {
  const f = artist(150, { gate: true });
  void f.media.children('artist', false, undefined, Infinity);
  await f.release();
  const fresh = f.media.children('artist', true, undefined, Infinity);
  await f.settle();
  // The old read's pending page is abandoned; the fresh read asks with its own signal.
  expect(f.calls[1]!.signal?.aborted).toBe(true);
  expect(f.calls[2]!.signal?.aborted).toBe(false);
  expect(f.calls[2]!.cursor).toBeUndefined();
  for (let i = 0; i < 4; i++) await f.release();
  await fresh;
  expect(f.calls.filter(call => !call.signal?.aborted).map(call => call.cursor)).toEqual([undefined, '50', '100']);
  expect(f.state()?.value?.items.map(card => card.id)).toEqual(Array.from({ length: 150 }, (_, i) => `album-${i}`));
});

test('a cursor the server already gave is not followed again', async () => {
  const box = new StateBox({ children: {}, titles: {} } as unknown as VelaState);
  let calls = 0;
  const adapter = { children: async (): Promise<ChildrenPage> => { calls++; return { items: [title(calls)], continuation: 'more', nextCursor: 'same' }; } };
  const session = { epoch: 0, onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  const media = new Media(box, session as unknown as Session, () => 640);
  await media.children('artist', false, undefined, Infinity);
  expect(calls).toBe(2);
  expect(box.get().children['artist']?.value).toMatchObject({ complete: false, more: false });
});
