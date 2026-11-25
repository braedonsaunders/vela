import { describe, expect, test } from 'bun:test';
import {
  TOP_SHELF_LIMIT, TopShelfSync, topShelfLink, topShelfLinkAction, topShelfOwner, topShelfPublication,
  type ShelfCard, type ShelfRow, type TopShelfDownload, type TopShelfWriter,
} from '../src/model';

function card(id: string, values: Partial<ShelfCard> = {}): ShelfCard {
  return { id, kind: 'movie', name: `Film ${id}`, showName: '', episodeContext: '', durationSeconds: 6000, progressSeconds: 1500,
    backdrop: `https://art.example/${id}/backdrop?X-Plex-Token=secret`, poster: `https://art.example/${id}/poster`, ...values };
}
const row = (purpose: string, items: ShelfCard[], name = 'Continue Watching'): ShelfRow => ({ purpose, name, items });
const OWNER = topShelfOwner('plex-server', 'viewer-1');

describe('topShelfPublication', () => {
  test('takes the Continue Watching row: title, progress, a landscape picture and a resume link', () => {
    const episode = card('e1', { kind: 'episode', name: 'Pilot', showName: 'The Show', episodeContext: 'The Show · S1, E1', thumbnail: 'https://art.example/e1/still' });
    const publication = topShelfPublication([row('recent', [card('r1')]), row('continue', [episode, card('m1')])], OWNER)!;
    expect(publication.snapshot.title).toBe('Continue Watching');
    expect(publication.snapshot.owner).toBe(OWNER);
    expect(publication.snapshot.items.map(item => [item.id, item.title, item.shape, item.progress])).toEqual([
      ['e1', 'The Show · S1, E1', 'wide', 0.25],
      ['m1', 'Film m1', 'wide', 0.25],
    ]);
    expect(publication.snapshot.items[0]!.link).toBe(topShelfLink('e1', OWNER));
    expect(publication.downloads.map(download => download.url)).toEqual(['https://art.example/e1/still', 'https://art.example/m1/backdrop?X-Plex-Token=secret']);
  });

  test('an episode without its show (Ether leaves it out) is named by its own name and number', () => {
    const episode = card('e2', { kind: 'episode', name: 'Off with a Bang', episodeContext: 'Season 1, Episode 3' });
    expect(topShelfPublication([row('continue', [episode])], OWNER)!.snapshot.items[0]!.title).toBe('Off with a Bang · Season 1, Episode 3');
  });

  test('never writes an artwork URL into the snapshot; pictures are files named apart per viewer', () => {
    const publication = topShelfPublication([row('continue', [card('m1')])], OWNER)!;
    const json = JSON.stringify(publication.snapshot);
    expect(json).not.toContain('art.example');
    expect(json).not.toContain('secret');
    const file = publication.snapshot.items[0]!.image;
    expect(file).toMatch(/^[0-9a-f]{16}\.jpg$/);
    expect(publication.downloads[0]!.file).toBe(file);
    const other = topShelfPublication([row('continue', [card('m1')])], topShelfOwner('plex-server', 'viewer-2'))!;
    expect(other.snapshot.items[0]!.image).not.toBe(file);
  });

  test('uses a new picture file when a title changes artwork', () => {
    const previous = topShelfPublication([row('continue', [card('a')])], OWNER)!;
    const updated = topShelfPublication([row('continue', [card('a', { backdrop: 'https://art.example/a/new-art' })])], OWNER)!;
    expect(updated.snapshot.items[0]!.image).not.toBe(previous.snapshot.items[0]!.image);
  });

  test('skips a continue row when none of its pictures can be loaded', () => {
    const unreadable = card('a', { backdrop: 'https://', poster: '' });
    const publication = topShelfPublication([row('continue', [unreadable]), row('continue', [card('b')])], OWNER)!;
    expect(publication.snapshot.items.map(item => item.id)).toEqual(['b']);
  });

  test('skips music and books, unplayable entries, cards without pictures and repeats; uses a poster last', () => {
    const items = [card('book', { media: { kind: 'book' } }), card('col', { kind: 'collection' }), card('none', { backdrop: '', poster: '' }),
      card('rel', { backdrop: '/relative.jpg', poster: '' }), card('p1', { backdrop: '' }), card('p1')];
    const publication = topShelfPublication([row('continue', items)], OWNER)!;
    expect(publication.snapshot.items.map(item => [item.id, item.shape])).toEqual([['p1', 'poster']]);
  });

  test('a Continue Reading row before Continue Watching is passed over', () => {
    const publication = topShelfPublication([row('continue', [card('b', { media: {} })], 'Continue Reading'), row('continue', [card('m1')])], OWNER)!;
    expect(publication.snapshot.title).toBe('Continue Watching');
  });

  test('is bounded: at most the limit, long titles clipped', () => {
    const many = Array.from({ length: 30 }, (_, i) => card(`m${i}`, { name: 'x'.repeat(500) }));
    const publication = topShelfPublication([row('continue', many)], OWNER)!;
    expect(publication.snapshot.items).toHaveLength(TOP_SHELF_LIMIT);
    expect(publication.downloads).toHaveLength(TOP_SHELF_LIMIT);
    expect(publication.snapshot.items[0]!.title.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(publication.snapshot).length).toBeLessThan(8000);
  });

  test('progress is clamped, and unknown when the duration is', () => {
    const publication = topShelfPublication([row('continue', [card('a', { progressSeconds: 9000 }), card('b', { durationSeconds: 0 })])], OWNER)!;
    expect(publication.snapshot.items.map(item => item.progress)).toEqual([1, 0]);
  });

  test('nothing without a viewer, rows or a Continue Watching row', () => {
    expect(topShelfPublication([row('continue', [card('m1')])], '')).toBeNull();
    expect(topShelfPublication(undefined, OWNER)).toBeNull();
    expect(topShelfPublication([row('nextUp', [card('m1')])], OWNER)).toBeNull();
    expect(topShelfPublication([row('continue', [])], OWNER)).toBeNull();
  });
});

describe('owner and links', () => {
  test('one server and one viewer; nobody without both', () => {
    expect(topShelfOwner('s', 'v')).toBe(topShelfOwner('s', 'v'));
    expect(topShelfOwner('s', 'v')).not.toBe(topShelfOwner('s', 'w'));
    expect(topShelfOwner('s', 'v')).not.toBe(topShelfOwner('t', 'v'));
    expect(topShelfOwner('', 'v')).toBe('');
    expect(topShelfOwner('s', '')).toBe('');
  });

  test('a link escapes the title id and carries the owner', () => {
    expect(topShelfLink('a/b c', 'abc')).toBe('vela://resume/a%2Fb%20c?owner=abc');
  });

  test('a link resumes only for its own viewer, once signed in', () => {
    expect(topShelfLinkAction('starting', OWNER, OWNER)).toBe('wait');
    expect(topShelfLinkAction('signed-out', OWNER, OWNER)).toBe('wait');
    expect(topShelfLinkAction('signed-in', OWNER, OWNER)).toBe('resume');
    expect(topShelfLinkAction('signed-in', OWNER, topShelfOwner('plex-server', 'viewer-2'))).toBe('home');
    expect(topShelfLinkAction('signed-in', OWNER, undefined)).toBe('home');
    expect(topShelfLinkAction('signed-in', '', '')).toBe('home');
  });
});

describe('TopShelfSync', () => {
  function writer() {
    const calls: (['publish', number, string, TopShelfDownload[]] | ['clear', number])[] = [];
    const value: TopShelfWriter = {
      publish: async (sequence, snapshot, downloads) => { calls.push(['publish', sequence, snapshot, downloads]); },
      clear: async sequence => { calls.push(['clear', sequence]); },
    };
    /** The snapshot a publish call wrote. */
    const written = (index: number) => {
      const call = calls[index];
      if (call?.[0] !== 'publish') throw new Error(`call ${index} is not a publish`);
      return JSON.parse(call[2]);
    };
    return { calls, value, written };
  }
  const rowsFor = (...ids: string[]) => [row('continue', ids.map(id => card(id)))];

  test('writes when Home is read, not again for the same shelf, again when it changes', () => {
    const { calls, value, written } = writer();
    const sync = new TopShelfSync(value);
    sync.update({ phase: 'starting', owner: '', revision: 0, rows: undefined });
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: undefined });
    expect(calls).toEqual([]);
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: rowsFor('a') });
    // A fresh read with the same titles and re-signed pictures is not news.
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: [row('continue', [card('a', { backdrop: 'https://art.example/a/backdrop?X-Plex-Token=new' })])] });
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: [row('continue', [card('a', { progressSeconds: 3000 })])] });
    expect(calls.map(call => [call[0], call[1]])).toEqual([['publish', 1], ['publish', 2]]);
    expect(written(1).items[0].progress).toBe(0.5);
  });

  test('signing out clears once; offline and a restart keep the shelf', () => {
    const { calls, value } = writer();
    const sync = new TopShelfSync(value);
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: rowsFor('a') });
    sync.update({ phase: 'offline', owner: OWNER, revision: 1, rows: rowsFor('a') });
    sync.update({ phase: 'signed-out', owner: '', revision: 2, rows: undefined });
    sync.update({ phase: 'signed-out', owner: '', revision: 2, rows: undefined });
    expect(calls.map(call => call[0])).toEqual(['publish', 'clear']);
  });

  test('an empty Continue Watching clears the shelf back to its artwork', () => {
    const { calls, value } = writer();
    const sync = new TopShelfSync(value);
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: rowsFor('a') });
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: [row('continue', [])] });
    expect(calls.map(call => call[0])).toEqual(['publish', 'clear']);
  });

  test('a new viewer clears the last viewer\'s shelf and never gets their rows', () => {
    const { calls, value, written } = writer();
    const sync = new TopShelfSync(value);
    const before = rowsFor('a');
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: before });
    // A Plex Home profile switch: the session moves on while Home still holds the last viewer's rows.
    const next = topShelfOwner('plex-server', 'viewer-2');
    sync.update({ phase: 'signed-in', owner: next, revision: 2, rows: before });
    sync.update({ phase: 'signed-in', owner: next, revision: 2, rows: undefined });
    expect(calls.map(call => call[0])).toEqual(['publish', 'clear']);
    sync.update({ phase: 'signed-in', owner: next, revision: 2, rows: rowsFor('b') });
    const published = written(2);
    expect(published.owner).toBe(next);
    expect(published.items.map((item: { id: string }) => item.id)).toEqual(['b']);
  });

  test('every call carries a rising sequence', () => {
    const { calls, value } = writer();
    const sync = new TopShelfSync(value);
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: rowsFor('a') });
    sync.update({ phase: 'signed-out', owner: '', revision: 2, rows: undefined });
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 3, rows: rowsFor('a') });
    expect(calls.map(call => call[1])).toEqual([1, 2, 3]);
  });

  test('a late failure from the previous viewer leaves the current shelf published', async () => {
    const { calls, value } = writer();
    let failPrevious!: (reason: Error) => void;
    const previous = new Promise<void>((_, reject) => { failPrevious = reject; });
    const sync = new TopShelfSync({
      ...value,
      publish: (sequence, snapshot, downloads) => {
        const saved = value.publish(sequence, snapshot, downloads);
        return sequence === 1 ? previous : saved;
      },
    });
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: rowsFor('a') });
    const next = { phase: 'signed-in', owner: topShelfOwner('server', 'other'), revision: 2, rows: rowsFor('b') };
    sync.update(next);
    failPrevious(new Error('download failed'));
    await Promise.resolve();
    sync.update(next);
    expect(calls.map(call => call[1])).toEqual([1, 2]);
  });

  test('retries a failed sign-out clear', async () => {
    let attempts = 0;
    const sync = new TopShelfSync({
      publish: async () => {},
      clear: async () => { if (++attempts === 1) throw new Error('clear failed'); },
    });
    const signedOut = { phase: 'signed-out', owner: '', revision: 2, rows: undefined };
    sync.update(signedOut);
    await Promise.resolve();
    sync.update(signedOut);
    expect(attempts).toBe(2);
  });

  test('a failed write is reported and retried when Home refreshes', async () => {
    const errors: unknown[] = [];
    const sync = new TopShelfSync({ publish: () => Promise.reject(new Error('no group')), clear: async () => {} }, error => errors.push(error));
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: rowsFor('a') });
    await Promise.resolve();
    expect(errors).toHaveLength(1);
    sync.update({ phase: 'signed-in', owner: OWNER, revision: 1, rows: rowsFor('a') });
    await Promise.resolve();
    expect(errors).toHaveLength(2);
  });
});
