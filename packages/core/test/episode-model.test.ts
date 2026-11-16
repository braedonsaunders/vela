import { expect, test } from 'bun:test';
import { card, detailModel } from '../src/discovery/models';
import type { Title, TitleDetail } from '../src/wire';

const title: Title = { id: 'episode', kind: 'episode', name: 'Arrival', showName: 'Meridian Station', seasonNumber: 0, episodeNumber: 3, summary: '', genres: [], artwork: [
  { id: 'poster', kind: 'poster', tag: '', sizes: [{ width: 0, height: 0, url: 'https://media.example/poster' }] },
  { id: 'backdrop', kind: 'backdrop', tag: '', sizes: [{ width: 0, height: 0, url: 'https://media.example/backdrop' }] },
  { id: 'still', kind: 'still', tag: '', sizes: [{ width: 0, height: 0, url: 'https://media.example/still' }] },
] };

test('episode details show series context including specials, with separate portrait and landscape art', () => {
  const model = detailModel({ title, extras: [], chapters: [], cast: [] } satisfies TitleDetail).title[0]!;
  expect(model.episodeContext).toBe('Meridian Station · Season 0, Episode 3');
  expect(model.poster).toContain('/poster');
  expect(model.backdrop).toContain('/still');
  expect(card({ ...title, showName: undefined, seasonNumber: undefined }).episodeContext).toBe('Episode 3');
  expect(card({ ...title, kind: 'movie' }).episodeContext).toBe('');
  expect(card({ ...title, kind: 'movie' }).backdrop).toContain('/backdrop');
});
