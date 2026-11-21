import { describe, expect, test } from 'bun:test';
import { actionHref } from '../../../apps/vela/src/action-href';
import { collectionHref } from '../../../apps/vela/src/browse/library-query';

describe('document action links', () => {
  test('titles omit an empty library parameter', () => {
    expect(actionHref({ route: 'home', entry: 'home' }, 'select', 'movie-1|movie||')).toBe('/title/movie-1');
    expect(actionHref({ route: 'library', entry: 'films' }, 'select', 'movie-1|movie||')).toBe('/title/movie-1?library=films');
  });

  test('season cards link to their show and collections keep their kind', () => {
    expect(actionHref({ route: 'home', entry: 'home' }, 'select', 'season-2|season||show-1')).toBe('/title/show-1');
    expect(actionHref({ route: 'home', entry: 'home' }, 'select', 'favourites|playlist')).toBe('/collection/favourites?playlist=1');
  });

  test('Resume and Restart have different addresses', () => {
    expect(actionHref({ route: 'home', entry: 'home' }, 'play', 'movie-1')).toBe('/watch/movie-1');
    expect(actionHref({ route: 'home', entry: 'home' }, 'play', 'movie-1|||0')).toBe('/watch/movie-1?positionSeconds=0');
    expect(actionHref({ route: 'home', entry: 'home' }, 'play', 'news-1|channel')).toBe('/watch/news-1?kind=channel');
  });

  test('shell destinations and people have shareable URLs', () => {
    expect(actionHref({ route: 'home', entry: 'home' }, 'library', 'kids & family')).toBe('/library/kids%20%26%20family');
    expect(actionHref({ route: 'title', entry: 'movie-1', library: 'films' }, 'person', 'Ada Lovelace'))
      .toBe('/person?title=movie-1&name=Ada+Lovelace&library=films');
  });
});

test('collection links carry the same named view as their press action', () => {
  const href = new URL(collectionHref('movies', { collectionId: 'popular' }, 'popular', 'collections', { name: 'Popular', facts: '64 titles' }), 'https://vela.invalid');
  expect(href.pathname).toBe('/library/movies');
  expect(Object.fromEntries(href.searchParams)).toEqual({ collectionId: 'popular', view: 'collections', facetTitle: 'Popular · 64 titles' });
});
