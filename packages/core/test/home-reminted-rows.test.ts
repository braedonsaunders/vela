// Ether re-mints Home's row ids when the feed recomputes after playback: the old id answers 409
// cursor_expired (some builds: 404). Home must take the server's rows after a re-read (ids, order,
// membership), and a See all opened on an old id finds the row again before showing an error.
import { expect, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { Home, initialHome } from '../src/store/home';
import { Rows } from '../src/store/rows';
import { StateBox, idle } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { Bootstrap, Row as WireRow } from '../src/wire';

const title = (id: string, positionSeconds = 0, played = false) => ({
  id, kind: 'movie', name: id, summary: '', genres: [], durationSeconds: 100, artwork: [],
  watch: { positionSeconds, played, favorite: false, watchlisted: false },
});

/** A feed whose row ids carry the snapshot they were minted in, as Ether's do. */
class Feed {
  snapshot = 1;
  calls: string[] = [];
  /** What each row holds now; purpose, name and the shelf's titles. */
  shelves: { key: string; name: string; purpose: WireRow['purpose']; titles: ReturnType<typeof title>[] }[] = [];
  keys = false;
  /** 409 like Ether's release builds, or 404 like the lab build of the report. */
  stale: 404 | 409 = 409;
  /** Bootstrap reads still to refuse with 409 bootstrap_changed (Ether rebuilding its feed). */
  changing = 0;
  id(key: string) { return `${key}@${this.snapshot}`; }
  row(shelf: Feed['shelves'][number], from = 0, limit = 20): WireRow {
    const items = shelf.titles.slice(from, from + limit);
    const more = from + limit < shelf.titles.length;
    return { id: this.id(shelf.key), ...(this.keys ? { key: shelf.key } : {}), name: shelf.name, purpose: shelf.purpose, receiptToken: '',
      continuation: more ? 'more' : 'exhausted', ...(more ? { nextCursor: `${this.id(shelf.key)}|${from + limit}` } : {}),
      items: items.map(value => ({ id: `${shelf.key}:${value.id}`, kind: 'title' as const, title: value as never, receiptToken: '' })) };
  }
  bootstrap(): Bootstrap {
    return { viewer: { id: 'v', name: 'Viewer' }, heroes: [], defaultSkinId: 'cinematic', capabilities: { skins: [], features: {} },
      rows: this.shelves.filter(shelf => shelf.titles.length).map(shelf => this.row(shelf)) } as unknown as Bootstrap;
  }
  /** Playback recomputes the feed: every row gets a new id. */
  played() { this.snapshot++; }
  readonly adapter = {
    home: async () => {
      this.calls.push('bootstrap');
      if (this.changing > 0) {
        this.changing--;
        throw new VelaError({ class: 'conflict', code: 'bootstrap_changed', message: 'Home changed while loading', retry: { allowed: true, afterSeconds: 1, maxAttempts: 3 } } as never, 409);
      }
      return this.bootstrap();
    },
    row: async (id: string, cursor?: string, limit = 20) => {
      this.calls.push(`row ${id}${cursor ? ` ${cursor}` : ''}`);
      const [key, snapshot] = id.split('@');
      const shelf = this.shelves.find(value => value.key === key);
      if (!shelf || Number(snapshot) !== this.snapshot) {
        throw new VelaError({ class: this.stale === 409 ? 'conflict' : 'not-found', code: this.stale === 409 ? 'cursor_expired' : 'row_not_found', message: 'Refresh from first page', retry: { allowed: false } } as never, this.stale);
      }
      return this.row(shelf, cursor ? Number(cursor.split('|')[1]) : 0, limit);
    },
    rows: async () => ({ items: [], continuation: 'exhausted' as const }),
  };
}

function harness(feed: Feed) {
  const box = new StateBox({ home: initialHome, libraries: idle(), rows: {} } as unknown as VelaState);
  const session = { epoch: 0, onReset() {}, negotiate: async () => {}, ready: async () => ({ adapter: feed.adapter, images: async () => undefined }), check() {} };
  const home = new Home(box, session as unknown as Session, () => 640, 7_000, 1, 0, async () => {});
  const rows = new Rows(box, session as unknown as Session, () => 640, row => home.resolveRow(row));
  return { box, home, rows, ids: () => box.get().home.value!.rows.map(row => row.id), names: () => box.get().home.value!.rows.map(row => row.name) };
}

const films = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => title(`${prefix}-${index}`));

for (const stale of [409, 404] as const) {
  test(`after playback Home takes the server's re-minted row ids, and See all on the old id re-resolves once (${stale})`, async () => {
    const feed = new Feed();
    feed.stale = stale;
    feed.shelves = [
      { key: 'continue', name: 'Continue Watching', purpose: 'continue', titles: [title('film', 10)] },
      { key: 'new', name: 'New & Noteworthy', purpose: 'recommendation', titles: films('new', 70) },
      { key: 'top', name: 'Top 10 Today', purpose: 'recommendation', titles: films('top', 10) },
    ];
    const { box, home, rows, ids } = harness(feed);
    await home.ensure();
    const before = box.get().home.value!.rows;
    // A See all page opened before the title was played (its row seeded from Home).
    rows.seed(before[1]!);

    feed.shelves[0]!.titles = [title('film', 55)];
    feed.played();
    await home.reconcile({ titleId: 'film', positionSeconds: 55, finished: false });

    expect(ids()).toEqual(['continue@2', 'new@2', 'top@2']);
    // Unchanged rows keep what they draw as and their card objects: nothing is drawn again.
    const after = box.get().home.value!.rows;
    expect(after[1]!.drawnAs).toBe('new@1');
    expect(after[1]!.items[0]).toBe(before[1]!.items[0]!);
    expect(after[0]!.items[0]!.progressSeconds).toBe(55);

    // See all opened from Home now reads the fresh id directly.
    rows.seed(after[2]!);
    await rows.load('top@2');
    expect(box.get().rows['top@2']!.load).toBe('ready');

    // The page opened on the old id asks for more: 409/404, Home read afresh, the fresh id read.
    feed.calls = [];
    await rows.load('new@1', true);
    expect(box.get().rows['new@1']!.load).toBe('ready');
    expect(feed.calls).toEqual(['row new@1 new@1|20', 'bootstrap', 'row new@2']);
    expect(box.get().rows['new@1']!.value!.items).toHaveLength(60);
    // And pages on from the fresh row's cursor.
    feed.calls = [];
    await rows.load('new@1', true);
    expect(feed.calls).toEqual(['row new@2 new@2|60']);
    expect(box.get().rows['new@1']!.value!.items.map(card => card.id)).toEqual(films('new', 70).map(value => value.id));
  });
}

test('a See all opened on an old id with nothing shown yet is found again in Home read afresh', async () => {
  const feed = new Feed();
  feed.shelves = [{ key: 'new', name: 'New & Noteworthy', purpose: 'recommendation', titles: films('new', 30) }];
  const { box, home, rows } = harness(feed);
  await home.ensure();
  feed.played();
  feed.calls = [];
  // Opened by its link (no seed): the row is known from Home as it was drawn.
  await rows.load('new@1');
  expect(feed.calls).toEqual(['row new@1', 'bootstrap', 'row new@2']);
  expect(box.get().rows['new@1']!.load).toBe('ready');
  expect(box.get().home.value!.rows[0]!.id).toBe('new@2');
});

test('a row the fresh Home no longer has is an error after one re-resolve, not a loop', async () => {
  const feed = new Feed();
  feed.shelves = [{ key: 'new', name: 'New & Noteworthy', purpose: 'recommendation', titles: films('new', 30) }, { key: 'gone', name: 'Gone', purpose: 'collection', titles: films('gone', 30) }];
  const { box, home, rows } = harness(feed);
  await home.ensure();
  rows.seed(box.get().home.value!.rows[1]!);
  feed.shelves.pop();
  feed.played();
  feed.calls = [];
  await rows.load('gone@1', true);
  expect(feed.calls).toEqual(['row gone@1 gone@1|20', 'bootstrap']);
  expect(box.get().rows['gone@1']!.load).toBe('failed');
  expect(box.get().home.value!.rows.map(row => row.id)).toEqual(['new@2']);
});

test('a title played to its end: Up Next appears once, where the server puts it, and no old shelf stays', async () => {
  const feed = new Feed();
  feed.shelves = [
    { key: 'continue', name: 'Continue Watching', purpose: 'continue', titles: [title('moon', 60)] },
    { key: 'trending', name: 'Trending Now', purpose: 'recommendation', titles: films('trend', 12) },
    { key: 'top', name: 'Top 10 Today', purpose: 'recommendation', titles: films('top', 10) },
    { key: 'up-next', name: 'Up Next', purpose: 'nextUp', titles: [title('episode-2')] },
    { key: 'new', name: 'New & Noteworthy', purpose: 'recommendation', titles: films('new', 12) },
  ];
  const { home, ids, names } = harness(feed);
  await home.ensure();
  // The title finishes: Continue Watching empties, Up Next gains its sequel, every id is re-minted.
  feed.shelves[0]!.titles = [];
  feed.shelves[3]!.titles = [title('moon-2'), title('episode-2')];
  feed.played();
  await home.reconcile({ titleId: 'moon', positionSeconds: 0, finished: true });
  expect(names()).toEqual(['Trending Now', 'Top 10 Today', 'Up Next', 'New & Noteworthy']);
  expect(ids()).toEqual(['trending@2', 'top@2', 'up-next@2', 'new@2']);
});

test('with keys on the wire, a renamed row is matched by its key and two rows that share a name are not confused', async () => {
  const feed = new Feed();
  feed.keys = true;
  feed.shelves = [
    { key: 'because-1', name: 'Because you watched Alpha', purpose: 'recommendation', titles: films('a', 5) },
    { key: 'top', name: 'Top Rated', purpose: 'recommendation', titles: films('top', 5) },
  ];
  const { box, home, rows } = harness(feed);
  await home.ensure();
  const shown = box.get().home.value!.rows;
  rows.seed(shown[0]!);
  feed.shelves[0]!.name = 'Because you watched Beta';
  feed.played();
  await home.reconcile({ titleId: 'unrelated', positionSeconds: 30, finished: false });
  const after = box.get().home.value!.rows;
  expect(after.map(row => row.id)).toEqual(['because-1@2', 'top@2']);
  expect(after[0]!.key).toBe('because-1');
  expect(after[0]!.drawnAs).toBeUndefined();
  expect(after[0]!.items[0]).toBe(shown[0]!.items[0]!);
  feed.played();
  feed.calls = [];
  await rows.load('because-1@1');
  expect(feed.calls).toEqual(['row because-1@1', 'bootstrap', 'row because-1@3']);
  expect(box.get().rows['because-1@1']!.value!.name).toBe('Because you watched Alpha');
});

test('a Home row paged past its first page keeps its cards after the re-read, pages on past them, and a stale id pages from the fresh row', async () => {
  const feed = new Feed();
  feed.shelves = [{ key: 'continue', name: 'Continue Watching', purpose: 'continue', titles: [title('film', 10)] },
    { key: 'new', name: 'New & Noteworthy', purpose: 'recommendation', titles: films('new', 70) }];
  const { box, home } = harness(feed);
  await home.ensure();
  await home.rowItems('new@1');
  const paged = box.get().home.value!.rows[1]!;
  expect(paged.items).toHaveLength(40);
  feed.shelves[0]!.titles = [title('film', 55)];
  feed.played();
  await home.reconcile({ titleId: 'film', positionSeconds: 55, finished: false });
  const row = box.get().home.value!.rows[1]!;
  expect(row.id).toBe('new@2');
  // Focus on the 30th card stays: the row still holds it, as the same object.
  expect(row.items).toHaveLength(40);
  expect(row.items[29]).toBe(paged.items[29]!);
  feed.calls = [];
  await home.rowItems('new@2');
  // The fresh cursor's first page holds only cards already shown: it reads on.
  expect(feed.calls).toEqual(['row new@2 new@2|20', 'row new@2 new@2|40']);
  expect(box.get().home.value!.rows[1]!.items).toHaveLength(60);

  // Ids re-minted again with no Home read yet: paging the row finds it again, once.
  feed.played();
  feed.calls = [];
  await home.rowItems('new@2');
  expect(feed.calls).toEqual(['row new@2 new@2|60', 'bootstrap', 'row new@3 new@3|20', 'row new@3 new@3|40', 'row new@3 new@3|60']);
  expect(box.get().home.value!.rows.map(value => value.id)).toEqual(['continue@3', 'new@3']);
  expect(box.get().home.value!.rows[1]!.items).toHaveLength(70);
});

test('a See all whose re-resolve meets 409 bootstrap_changed reads Home again on the server\'s terms, not an error', async () => {
  const feed = new Feed();
  feed.shelves = [{ key: 'popular', name: 'Popular', purpose: 'recommendation', titles: films('pop', 30) }];
  const { box, home, rows } = harness(feed);
  await home.ensure();
  rows.seed(box.get().home.value!.rows[0]!);
  feed.played();
  // The rc.9 lab: the old id answers 409 cursor_expired, then the re-read meets the feed mid-rebuild.
  feed.changing = 2;
  feed.calls = [];
  await rows.load('popular@1', true);
  expect(feed.calls).toEqual(['row popular@1 popular@1|20', 'bootstrap', 'bootstrap', 'bootstrap', 'row popular@2']);
  expect(box.get().rows['popular@1']!.load).toBe('ready');
});

test('a re-resolve the server keeps refusing ends in the error after its allowed attempts, not a loop', async () => {
  const feed = new Feed();
  feed.shelves = [{ key: 'popular', name: 'Popular', purpose: 'recommendation', titles: films('pop', 30) }];
  const { box, home, rows } = harness(feed);
  await home.ensure();
  rows.seed(box.get().home.value!.rows[0]!);
  feed.played();
  feed.changing = 10;
  feed.calls = [];
  await rows.load('popular@1', true);
  expect(feed.calls).toEqual(['row popular@1 popular@1|20', 'bootstrap', 'bootstrap', 'bootstrap']);
  expect(box.get().rows['popular@1']!.load).toBe('failed');
});
