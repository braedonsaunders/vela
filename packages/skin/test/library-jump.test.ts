// Eligibility, URL persistence, active bucket resolution, grid column layout and post-jump focus targeting for letter jump.
import { describe, expect, test } from 'bun:test';
import type { LibraryJumpBucket, LibraryModel } from '@vela/core';
import { filteredBy, flipped, jumpIndexEligible, paramsOf, queryOf, sortedBy } from '../../../apps/vela/src/browse/library-query';
import { activeJumpBucket, firstPosterTarget, jumpGridColumns, jumpGridRows } from '../src/widgets/library/jump-model';
import type { LibraryPage } from '../src/widgets/library/model';

const model = (over: Partial<LibraryModel> = {}): LibraryModel => ({
  id: 'movies',
  name: 'Movies',
  kind: 'movies',
  media: 'video',
  dateDisplay: 'year',
  backdrop: '',
  sorts: [
    { id: 'title', label: 'Title', directions: ['asc', 'desc'] },
    { id: 'added', label: 'Recently added', directions: ['desc', 'asc'] },
  ],
  sort: 'title',
  direction: 'asc',
  kinds: [],
  genres: [],
  kindFilter: '',
  genreFilter: '',
  playedFilter: '',
  favoriteFilter: false,
  yearFilter: 0,
  canYear: true,
  canPlayed: true,
  canFavorite: false,
  items: [],
  more: false,
  pages: 1,
  ...over,
});

describe('jumpIndexEligible', () => {
  const base = { view: 'library', layout: 'grid' };

  test('allows unfiltered title-ascending movie and show grids', () => {
    expect(jumpIndexEligible(model({ kind: 'movies' }), {}, base)).toBe(true);
    expect(jumpIndexEligible(model({ kind: 'shows' }), { sort: 'title', direction: 'asc' }, base)).toBe(true);
    expect(jumpIndexEligible(model({ kind: 'movies' }), { start: 340 }, base)).toBe(true);
  });

  test('hides on ineligible views: non-grid, non-library tab, facet collection, non-movie/show, non-video, descending, other sort, or any filter/query', () => {
    expect(jumpIndexEligible(undefined, {}, base)).toBe(false);
    expect(jumpIndexEligible(model(), {}, { view: 'recommended', layout: 'grid' })).toBe(false);
    expect(jumpIndexEligible(model(), {}, { view: 'library', layout: 'list' })).toBe(false);
    expect(jumpIndexEligible(model(), {}, { ...base, facetTitle: 'Sci-Fi' })).toBe(false);
    expect(jumpIndexEligible(model({ kind: 'mixed' }), {}, base)).toBe(false);
    expect(jumpIndexEligible(model({ kind: 'movies', media: 'music' }), {}, base)).toBe(false);
    expect(jumpIndexEligible(model({ direction: 'desc' }), {}, base)).toBe(false);
    expect(jumpIndexEligible(model(), { direction: 'desc' }, base)).toBe(false);
    expect(jumpIndexEligible(model({ sort: 'added' }), {}, base)).toBe(false);
    expect(jumpIndexEligible(model(), { sort: 'added' }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { genre: 'Action' }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { year: 1999 }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { played: false }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { favorite: true }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { query: 'war' }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { kind: 'movie' }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { collectionId: 'c1' }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { facets: { studio: ['a24'] } }, base)).toBe(false);
    expect(jumpIndexEligible(model(), { tab: 'albums' }, base)).toBe(false);
  });
});

describe('library-query start parameter persistence & clearing', () => {
  test('round-trips valid positive start offsets through URL params for Back and reload', () => {
    const query = queryOf({ start: '340' });
    expect(query.start).toBe(340);
    expect(paramsOf(query).start).toBe('340');

    expect(queryOf({ start: '0' }).start).toBeUndefined();
    expect(queryOf({ start: '-5' }).start).toBeUndefined();
    expect(queryOf({ start: 'abc' }).start).toBeUndefined();
    // Drops start when URL also carries an ineligible sort/direction/filter.
    expect(queryOf({ sort: 'added', start: '340' }).start).toBeUndefined();
    expect(queryOf({ dir: 'desc', start: '340' }).start).toBeUndefined();
    expect(queryOf({ genre: 'Drama', start: '340' }).start).toBeUndefined();
    expect(queryOf({ sort: 'title', dir: 'asc', start: '340' }).start).toBe(340);
  });

  test('libraryFilter start sets/clears offset; sort, flip and any other filter clear start', () => {
    const jumped = filteredBy({}, 'start|340');
    expect(jumped.start).toBe(340);
    expect(filteredBy(jumped, 'start|').start).toBeUndefined();
    expect(filteredBy(jumped, 'start|0').start).toBeUndefined();

    expect(sortedBy(jumped, model(), 'added').start).toBeUndefined();
    expect(flipped(jumped, model()).start).toBeUndefined();
    expect(filteredBy(jumped, 'genre|Action').start).toBeUndefined();
    expect(filteredBy(jumped, 'year|2020').start).toBeUndefined();
    expect(filteredBy(jumped, 'played|false').start).toBeUndefined();
    expect(filteredBy(jumped, 'query|star').start).toBeUndefined();
    expect(filteredBy(jumped, 'clear|{}').start).toBeUndefined();
  });
});

describe('activeJumpBucket, jumpGridColumns and firstPosterTarget', () => {
  const buckets: LibraryJumpBucket[] = [
    { key: '#', label: '#', count: 4, startOffset: 0 },
    { key: 'A', label: 'A', count: 20, startOffset: 4 },
    { key: 'W', label: 'W', count: 35, startOffset: 340 },
  ];

  test('computes balanced column counts across phone, tablet, desktop and TV inner widths', () => {
    expect(jumpGridColumns(360 - 34, false)).toBe(6);
    expect(jumpGridColumns(390 - 34, false)).toBe(7);
    expect(jumpGridColumns(430 - 34, false)).toBe(7);
    expect(jumpGridColumns(416 - 34, false)).toBe(7);
    expect(jumpGridColumns(560 - 34, true)).toBe(7);
    expect(jumpGridColumns(0, false)).toBe(1);
    expect(jumpGridRows(['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G'], 7)).toEqual([
      ['#', 'A', 'B', 'C', 'D', 'E', 'F'],
      ['G'],
    ]);
  });

  test('resolves active bucket for a jumped start offset', () => {
    expect(activeJumpBucket(buckets, undefined)).toBeUndefined();
    expect(activeJumpBucket(buckets, 0)).toBeUndefined();
    expect(activeJumpBucket(buckets, 4)?.label).toBe('A');
    expect(activeJumpBucket(buckets, 340)?.label).toBe('W');
    expect(activeJumpBucket(buckets, 350)?.label).toBe('W');
  });

  test('firstPosterTarget waits while loading or showing an older offset, then targets the first poster', () => {
    const poster = { id: 'w1', kind: 'movie', receipt: 'r1' } as LibraryModel['items'][number];
    const oldPage: LibraryPage = { loading: true, moreLoading: false, model: model({ startOffset: undefined, items: [poster] }) };
    expect(firstPosterTarget(oldPage, 340)).toBeUndefined();

    const wrongOffset: LibraryPage = { loading: false, moreLoading: false, model: model({ startOffset: undefined, items: [poster] }) };
    expect(firstPosterTarget(wrongOffset, 340)).toBeUndefined();

    const readyJumped: LibraryPage = { loading: false, moreLoading: false, model: model({ startOffset: 340, items: [poster] }) };
    expect(firstPosterTarget(readyJumped, 340)).toEqual(['select:w1|movie|r1']);

    const readyTop: LibraryPage = { loading: false, moreLoading: false, model: model({ startOffset: undefined, items: [poster] }) };
    expect(firstPosterTarget(readyTop, 0)).toEqual(['select:w1|movie|r1']);
  });
});
