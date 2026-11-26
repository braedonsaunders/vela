import { expect, test } from 'bun:test';
import { collectionRoute } from '../../../apps/vela/src/browse/library-query';

test('opening a collection pushes a named, counted view under its Collections tab', () => {
  expect(collectionRoute('movies', { collectionId: 'popular' }, 'popular', 'collections', { name: 'Popular', facts: '64 titles' })).toEqual({
    pathname: '/library/[id]',
    params: {
      id: 'movies', view: 'collections', facetTitle: 'Popular · 64 titles', collectionId: 'popular',
      query: undefined, facets: undefined, sort: undefined, dir: undefined, kind: undefined,
      genre: undefined, year: undefined, played: undefined, fav: undefined, start: undefined,
    },
  });
});
