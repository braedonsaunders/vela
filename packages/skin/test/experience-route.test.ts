// The experience host's address (screen/experience-route.ts) and page scroll memory (screen/scroll-memory.ts).
import { describe, expect, test } from 'bun:test';
import { addressOfPlace, placeKey, placeOfAddress } from '../src/screen/experience-route';
import { createScrollMemory } from '../src/screen/scroll-memory';

describe('experience addresses', () => {
  test('the music app\'s links open the same pages', () => {
    expect(placeOfAddress(undefined)).toEqual({ page: 'home', params: {} });
    expect(placeOfAddress('')).toEqual({ page: 'home', params: {} });
    expect(placeOfAddress('liked')).toEqual({ page: 'liked', params: {} });
    expect(placeOfAddress('title:abc')).toEqual({ page: 'title', params: { id: 'abc' } });
    expect(placeOfAddress('playlist:p1')).toEqual({ page: 'playlist', params: { id: 'p1' } });
    expect(placeOfAddress('albums:blue train')).toEqual({ page: 'albums', params: { query: 'blue train' } });
    expect(placeOfAddress('title:')).toEqual({ page: 'home', params: {} });
    expect(placeOfAddress('../etc')).toEqual({ page: 'home', params: {} });
    // An id may hold a colon.
    expect(placeOfAddress('title:item:42')).toEqual({ page: 'title', params: { id: 'item:42' } });
  });
  test('a place writes back the same address, other params beside it', () => {
    for (const m of ['', 'liked', 'title:abc', 'playlist:p1', 'albums:blue train', 'rewind']) expect(addressOfPlace(placeOfAddress(m)).m).toBe(m);
    expect(addressOfPlace({ page: 'album', params: { id: 'a1', disc: '2' } })).toEqual({ m: 'album:a1', rest: { disc: '2' } });
    expect(addressOfPlace({ page: 'search', params: { query: 'x', kind: 'album' } })).toEqual({ m: 'search:x', rest: { kind: 'album' } });
  });
  test('a page key follows the page and its params, not their order', () => {
    expect(placeKey({ page: 'album', params: { b: '2', a: '1' } })).toBe(placeKey({ page: 'album', params: { a: '1', b: '2' } }));
    expect(placeKey({ page: 'album', params: { id: '1' } })).not.toBe(placeKey({ page: 'album', params: { id: '2' } }));
  });
});

describe('page scroll memory', () => {
  test('keeps where a page was left, forgets the top and the oldest', () => {
    const memory = createScrollMemory(2);
    memory.keep('a', 120);
    expect(memory.resume('a')).toBe(120);
    memory.keep('a', 0);
    expect(memory.resume('a')).toBe(0);
    memory.keep('a', 1); memory.keep('b', 2); memory.keep('c', 3);
    expect([memory.resume('a'), memory.resume('b'), memory.resume('c')]).toEqual([0, 2, 3]);
  });
});
