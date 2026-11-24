import { describe, expect, test } from 'bun:test';
import { namesTitle, readsAsDescription, searchList, wantsDescription } from '../src/store/search-list';
import type { SearchLane, SearchState } from '../src/store/search';
import type { Card } from '../src/models';

const card = (id: string, name = id) => ({ id, name }) as Card;
const fast = (status: SearchLane['status'], items: Card[] = [], extra: Partial<SearchState['fast']> = {}): SearchState['fast'] =>
  ({ status, items, error: '', liveChannels: [], liveProgrammes: [], ...extra });
const described = (status: SearchLane['status'], items: Card[] = [], extra: Partial<SearchState['descriptive']> = {}): SearchState['descriptive'] =>
  ({ status, items, error: '', canRetry: false, ...extra });

describe('readsAsDescription', () => {
  test('names and short keyword searches are not descriptions', () => {
    for (const q of ['James Bond', 'bond', 'heist movie', 'Lost in Translation', 'Star Wars Episode IV', 'The Dark Knight Rises', '007']) {
      expect(readsAsDescription(q)).toBe(false);
    }
  });

  test('sentences about a story, setting or feeling are descriptions', () => {
    for (const q of [
      'a slow-burn heist in Lisbon',
      'something cosy for a rainy day',
      'films about grief',
      'movies like Heat',
      'set in 1970s Tokyo',
      'is there a funny space movie?',
      'two brothers rebuild their father’s farm after the war',
    ]) expect(readsAsDescription(q)).toBe(true);
  });

  test('accents, case and punctuation do not matter', () => {
    expect(readsAsDescription('SOMETHING   about   Café   life!')).toBe(true);
  });
});

describe('namesTitle', () => {
  test('a title whose name contains the whole query is named by it', () => {
    expect(namesTitle('the man with the golden gun', [card('a', 'The Man with the Golden Gun')])).toBe(true);
    expect(namesTitle('Amélie', [card('a', 'Amelie')])).toBe(true);
  });

  test('a title whose name is only a word of the query is not named', () => {
    expect(namesTitle('a slow-burn heist in Lisbon', [card('a', 'Heist'), card('b', 'Lisbon Story')])).toBe(false);
    expect(namesTitle('her', [card('a', 'Hereditary')])).toBe(false);
  });
});

describe('wantsDescription', () => {
  test('only once titles are known, unless the words already describe', () => {
    expect(wantsDescription('james bond', fast('loading'))).toBeUndefined();
    expect(wantsDescription('a slow-burn heist in Lisbon', fast('loading'))).toBe(true);
    expect(wantsDescription('james bond', fast('ready', [card('dn', 'Dr. No')]))).toBe(false);
    expect(wantsDescription('james bond', fast('ready'))).toBe(true);
    // A single word naming nothing is not a description: its answer is empty, not the nearest matches.
    expect(wantsDescription('zxqvjk', fast('ready'))).toBe(false);
    expect(wantsDescription('a slow-burn heist in Lisbon', fast('ready', [card('h', 'Heist')]))).toBe(true);
    expect(wantsDescription('a slow-burn heist in Lisbon', fast('failed'))).toBe(false);
  });
});

describe('searchList', () => {
  const bond = [card('dn', 'Dr. No'), card('gf', 'Goldfinger')];

  test('titles found: the list is the titles, and the description search plays no part', () => {
    const list = searchList({ query: 'James Bond', fast: fast('ready', bond), descriptive: described('loading', [card('x')]) });
    expect(list).toMatchObject({ state: 'ready', byDescription: false, description: 'off', canRetry: false });
    expect(list.items.map(c => c.id)).toEqual(['dn', 'gf']);
  });

  test('loading until titles answer; failed titles fail the list', () => {
    expect(searchList({ query: 'bond', fast: fast('loading'), descriptive: described('ready', [card('x')]) }).state).toBe('loading');
    expect(searchList({ query: 'bond', fast: fast('failed'), descriptive: described('idle') }).state).toBe('failed');
  });

  test('no titles: loading while the fallback waits or runs, then its matches', () => {
    for (const status of ['idle', 'loading'] as const) {
      expect(searchList({ query: 'rififi heist', fast: fast('ready'), descriptive: described(status) })).toMatchObject({ state: 'loading', items: [], description: 'loading' });
    }
    const list = searchList({ query: 'rififi heist', fast: fast('ready'), descriptive: described('ready', [card('r')], { nextCursor: 'p2' }) });
    expect(list).toMatchObject({ state: 'ready', byDescription: true, description: 'ready', more: 'descriptive' });
    expect(list.items.map(c => c.id)).toEqual(['r']);
  });

  test('a server without description search shows the empty title answer at once', () => {
    expect(searchList({ query: 'zzqx', fast: fast('ready'), descriptive: described('unavailable') }))
      .toMatchObject({ state: 'ready', items: [], byDescription: false, description: 'off' });
  });

  test('a descriptive query shows description matches instead of loose title hits', () => {
    const list = searchList({ query: 'a slow-burn heist in Lisbon', fast: fast('ready', [card('h', 'Heist')], { nextCursor: 'f2' }), descriptive: described('ready', [card('lj')]) });
    expect(list.items.map(c => c.id)).toEqual(['lj']);
    expect(list.more).toBeUndefined();
  });

  test('nothing by description: the title hits stand, or an empty answer about the words', () => {
    const hits = searchList({ query: 'a slow-burn heist in Lisbon', fast: fast('ready', [card('h', 'Heist')], { nextCursor: 'f2' }), descriptive: described('ready') });
    expect(hits).toMatchObject({ state: 'ready', byDescription: false, description: 'ready', more: 'fast' });
    expect(hits.items.map(c => c.id)).toEqual(['h']);
    expect(searchList({ query: 'a slow-burn heist in Lisbon', fast: fast('ready'), descriptive: described('ready') }))
      .toMatchObject({ state: 'ready', items: [], byDescription: true });
    expect(searchList({ query: 'zzqx blorp', fast: fast('ready'), descriptive: described('ready') }))
      .toMatchObject({ state: 'ready', items: [], byDescription: false });
    expect(searchList({ query: 'zxqvjk', fast: fast('ready'), descriptive: described('idle') }))
      .toMatchObject({ state: 'ready', items: [], byDescription: false, description: 'off' });
  });

  test('a failed description search keeps what it found, or the titles, and offers a retry once allowed', () => {
    const partial = searchList({ query: 'films about grief', fast: fast('ready'), descriptive: described('failed', [card('g')], { canRetry: true }) });
    expect(partial).toMatchObject({ state: 'ready', byDescription: true, description: 'failed', canRetry: true });
    expect(partial.items.map(c => c.id)).toEqual(['g']);
    const titles = searchList({ query: 'films about grief', fast: fast('ready', [card('m', 'Manchester by the Sea')]), descriptive: described('failed') });
    expect(titles).toMatchObject({ state: 'ready', byDescription: false, description: 'failed', canRetry: false });
    expect(titles.items.map(c => c.id)).toEqual(['m']);
  });

  test('a page being loaded is not offered again', () => {
    expect(searchList({ query: 'bond', fast: fast('ready', bond, { nextCursor: 'p2', loadingMore: true }), descriptive: described('idle') }).more).toBeUndefined();
  });
});
