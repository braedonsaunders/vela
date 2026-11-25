// Vela's own sources as records: lists of references, the queue and Now Playing records, source
// arguments filled from a page's params, and action arguments read in their declared types.
import { describe, expect, test } from 'bun:test';
import { boolArg, cardList, cardOf, intsArg, lyricsLine, musicHomeValue, itemId, itemKey, missingArgs, nowPlayingRecord, pairsArg, queueRecord, rowsValue, sourceArgs } from '../src/screens/local-records';
import { importRecord, libraryQuery, LocalSources, playlistCard } from '../src/screens/local';
import { createQueue, enqueue } from '../src/audio/queue';
import { isVelaAction, isVelaSource, VELA_ACTIONS, VELA_SOURCES } from '../../protocol/vela-sources';
import type { Card, Row } from '../src/models';

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  ...playlistCard({ id, name: `Track ${id}`, poster: '', backdrop: '', itemCount: 0, smart: false }),
  kind: 'episode',
  ...extra,
});

describe('lists and rows', () => {
  test('a list holds references; each card becomes its item record, without a playlist entry id', () => {
    const { value, records } = cardList([card('a', { entryId: 'e1' }), card('b')], true, 9);
    expect(value).toEqual({ items: [{ $record: 'item:a' }, { $record: 'item:b' }], more: true, total: 9 });
    expect(Object.keys(records)).toEqual(['item:a', 'item:b']);
    expect((records['item:a'] as Card).entryId).toBeUndefined();
    expect((records['item:a'] as Card).name).toBe('Track a');
  });

  test('rows keep their identity, layout and paging, with item references', () => {
    const row = { id: 'r1', key: 'k1', name: 'Recently added', purpose: 'recent', items: [card('a')], nextCursor: 'c', continuation: 'more', layout: 'tracks', presentation: '', receipt: '', previewOnFocus: false, personal: false } as unknown as Row;
    const { value, records } = rowsValue([row]);
    expect(value.rows[0]).toMatchObject({ id: 'r1', key: 'k1', name: 'Recently added', purpose: 'recent', layout: 'tracks', items: [{ $record: 'item:a' }], more: true });
    expect(records['item:a']).toBeDefined();
  });

  test('item keys and ids round-trip; cardOf refuses what is not a card', () => {
    expect(itemKey('x')).toBe('item:x');
    expect(itemKey('item:x')).toBe('item:x');
    expect(itemId('item:x')).toBe('x');
    expect(cardOf(card('a'))?.id).toBe('a');
    expect(cardOf({ id: 'a' })).toBeUndefined();
    expect(cardOf(null)).toBeUndefined();
  });
});

describe('queue and Now Playing records', () => {
  const items = [card('1'), card('2'), card('3'), card('4')];

  test('the queue lists play order, the current item, queued items apart from the source', () => {
    let queue = createQueue(items, 1, { source: { id: 'album', name: 'Album', kind: 'title' } });
    queue = enqueue(queue, [card('q')], 'next');
    const { value, records } = queueRecord(queue);
    expect(value.at).toBe(1);
    expect(value.current).toEqual({ $record: 'item:2' });
    expect(value.queued).toEqual([{ $record: 'item:q' }]);
    expect(value.next.map(item => item.$record)).toEqual(['item:3', 'item:4']);
    expect(value.source).toEqual({ id: 'album', name: 'Album', kind: 'title' });
    expect(records['item:q']).toBeDefined();
  });

  test('an empty queue reads as nothing playing', () => {
    expect(queueRecord(null).value).toMatchObject({ items: [], at: -1, current: null, next: [] });
  });

  test('Now Playing is whole seconds, so it moves about once a second', () => {
    const queue = createQueue(items, 0);
    const audio = { queue, phase: 'playing' as const, positionSeconds: 61.4, durationSeconds: 200.2, rate: 1, volume: 1, muted: false, error: '', sleep: { mode: 'off', endsAt: 0 } };
    const first = nowPlayingRecord(audio).value;
    const sameSecond = nowPlayingRecord({ ...audio, positionSeconds: 61.9 }).value;
    expect(first).toEqual(sameSecond);
    expect(first).toMatchObject({ item: { $record: 'item:1' }, playing: true, position: 61, duration: 200 });
    expect(first.progress).toBeCloseTo(61 / 200);
    expect(nowPlayingRecord({ ...audio, queue: null, phase: 'idle' }).value).toMatchObject({ item: null, playing: false });
  });
});

describe('arguments', () => {
  test('param and context holes are filled; unknown holes read empty', () => {
    const args = sourceArgs({ from: 'vela.children', id: '{param.id}', role: 'track', extra: '{context.title}-{param.nope}', limit: 5 }, { params: { id: 'album-1' }, context: { title: 'item:t' } });
    expect(args).toEqual({ id: 'album-1', role: 'track', extra: 'item:t-', limit: '5' });
  });

  test('required arguments are checked; bools, lists and pairs are read', () => {
    expect(missingArgs(VELA_SOURCES['vela.children'], { id: '' })).toEqual(['id']);
    expect(missingArgs(VELA_ACTIONS['vela.like'], { item: 'item:a', on: false })).toEqual([]);
    expect(boolArg('true')).toBe(true);
    expect(boolArg('0')).toBe(false);
    expect(boolArg('maybe')).toBeUndefined();
    expect(intsArg('1, 2,x,3')).toEqual([1, 2, 3]);
    expect(pairsArg('4=item:t1, 7=t2,bad')).toEqual({ 4: 't1', 7: 't2' });
  });

  test('library arguments become a catalogue query, empty ones left to the server', () => {
    expect(libraryQuery({ id: 'music', sort: 'title', direction: 'desc', played: 'false', favorite: 'true', year: '2024', genre: '', q: 'boats' }))
      .toEqual({ sort: 'title', direction: 'desc', played: false, favorite: true, year: 2024, query: 'boats' });
    expect(libraryQuery({ id: 'music', favorite: 'false' })).toEqual({});
  });
});

describe('the published list', () => {
  test('names are full vela.* names; live sources are marked', () => {
    expect(isVelaSource('vela.queue')).toBe(true);
    expect(isVelaSource('vela.nope')).toBe(false);
    expect(isVelaAction('vela.like')).toBe(true);
    expect(isVelaAction('ether.favorite')).toBe(false);
    expect(LocalSources.isLive({ from: 'vela.nowPlaying' })).toBe(true);
    expect(LocalSources.isLive({ from: 'vela.title', id: 'x' })).toBe(false);
    expect(LocalSources.isLocal({ from: 'vela.anything' })).toBe(true);
    expect(LocalSources.isLocal({ from: 'sports.games' })).toBe(false);
  });
});

describe('the import record', () => {
  test('idle, starting, progress and failure read as states a document can draw', () => {
    expect(importRecord({ load: 'idle', error: '' }).value.state).toBe('idle');
    expect(importRecord({ load: 'loading', error: '' }).value.state).toBe('starting');
    expect(importRecord({ load: 'failed', error: 'unsupported link', code: 'unsupported_link', value: null }).value).toMatchObject({ state: 'failed', error: 'unsupported_link' });
    const model = { id: 'j', state: 'matching' as const, name: 'Mix', description: '', poster: '', total: 4, done: 1,
      matched: [{ index: 0, source: { title: 'A', artist: 'B' }, card: card('m'), by: 'isrc' as const }],
      unmatched: [{ index: 1, source: { title: 'C', artist: 'D' }, reason: 'ambiguous' as const, candidates: [card('c1')] }] };
    const { value, records } = importRecord({ load: 'ready', error: '', value: model });
    expect(value).toMatchObject({ state: 'matching', progress: 0.25, matched: [{ index: 0, item: { $record: 'item:m' }, by: 'isrc' }], unmatched: [{ index: 1, candidates: [{ $record: 'item:c1' }] }] });
    expect(Object.keys(records).sort()).toEqual(['item:c1', 'item:m']);
  });
});

describe('lyrics lines', () => {
  test('word timing, translation and romanisation pass through when sent; malformed parts are left out', () => {
    expect(lyricsLine({ startMs: 1000, text: 'Hola' })).toEqual({ startMs: 1000, text: 'Hola' });
    expect(lyricsLine({ startMs: 1000, endMs: 2000, text: 'Hola mundo', translation: 'Hello world', romanized: 'Hola mundo',
      words: [{ startMs: 1000, text: 'Hola' }, { text: 'bad' }, { startMs: 1500, endMs: 2000, text: 'mundo' }] }))
      .toEqual({ startMs: 1000, endMs: 2000, text: 'Hola mundo', translation: 'Hello world', romanised: 'Hola mundo',
        words: [{ startMs: 1000, text: 'Hola' }, { startMs: 1500, endMs: 2000, text: 'mundo' }] });
    expect(lyricsLine({ startMs: 5 })).toBeUndefined();
  });
});

describe('music Home', () => {
  const row = (id: string, items: Card[], extra: Partial<Row> = {}) => ({ id, name: id, purpose: 'recommended', items, nextCursor: '', continuation: 'exhausted', layout: 'standard', presentation: '', receipt: '', previewOnFocus: false, personal: false, ...extra }) as unknown as Row;
  const track = (id: string, album: string) => card(id, { media: { role: 'track', parent: { id: album } } as never });
  const base = { rows: [] as Row[], recentAvailable: true, recent: [], playlists: [] as Card[], favoritesPlaylist: false, likedTotal: 0, recapAvailable: false };

  test('quick tiles: Liked Songs, Rewind, recent, playlists, each once, at most 8; the first item gives the accent', () => {
    const recent = [{ kind: 'title' as const, card: card('a', { accent: '#123456' }), playedAt: '' }, { kind: 'favorites' as const, role: 'track', playedAt: '' }];
    const playlists = ['a', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(id => card(id));
    const { value } = musicHomeValue({ ...base, recent, playlists, likedTotal: 12, recapAvailable: true });
    expect(value.quick[0]).toEqual({ kind: 'liked', total: 12 });
    expect(value.quick[1]).toEqual({ kind: 'rewind' });
    expect(value.quick.slice(2).map(tile => tile.kind === 'item' ? tile.item.$record : '')).toEqual(['item:a', 'item:p1', 'item:p2', 'item:p3', 'item:p4', 'item:p5']);
    expect(value.accent).toBe('#123456');
    expect(value.recent).toEqual([{ $record: 'item:a' }]);
  });

  test("the page's own recent and liked rows replace Vela's; songs keep one per album; legacy jump rows apart", () => {
    const rows = [
      row('ctx', [card('x')], { purpose: 'recentContexts' as never }),
      row('liked', [card('y')], { purpose: 'liked' as never }),
      row('songs', [track('t1', 'al1'), track('t2', 'al1'), track('t3', 'al2')]),
      row('list', [track('t4', 'al1'), track('t5', 'al1')], { layout: 'tracks' as never }),
      row('surface', [], { surface: 's' }),
    ];
    const { value } = musicHomeValue({ ...base, rows, recent: [{ kind: 'title', card: card('r'), playedAt: '' }], favoritesPlaylist: true });
    expect(value.recent).toEqual([]);
    expect(value.quick.some(tile => tile.kind === 'liked')).toBe(false);
    const songs = value.shelves.find(shelf => shelf.id === 'songs')!;
    expect(songs.songs).toBe(true);
    expect(songs.items.map(item => item.$record)).toEqual(['item:t1', 'item:t3']);
    const list = value.shelves.find(shelf => shelf.id === 'list')!;
    expect(list.songs).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(value.shelves.some(shelf => shelf.id === 'surface')).toBe(false);
    const legacy = musicHomeValue({ ...base, rows: [row('p:jump-back-in', [card('j')]), row('p:recently-played', [card('k')])] }).value;
    expect(legacy.jump).toEqual([{ $record: 'item:j' }]);
    expect(legacy.shelves).toEqual([]);
  });
});
