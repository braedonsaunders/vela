import { expect, test } from 'bun:test';
import { card, detailModel } from '../src/discovery/models';
import type { Title, TitleDetail } from '../src/wire';

const title: Title = { id: 'episode', kind: 'episode', name: 'Arrival', showId: 'show', seasonId: 'season', showName: 'Meridian Station', seasonNumber: 0, episodeNumber: 3, summary: '', genres: [], artwork: [
  { id: 'poster', kind: 'poster', tag: '', sizes: [{ width: 0, height: 0, url: 'https://media.example/poster' }] },
  { id: 'backdrop', kind: 'backdrop', tag: '', sizes: [{ width: 0, height: 0, url: 'https://media.example/backdrop' }] },
  { id: 'still', kind: 'still', tag: '', sizes: [{ width: 0, height: 0, url: 'https://media.example/still' }] },
] };

test('episode details show series context including specials, with separate portrait and landscape art', () => {
  const model = detailModel({ title, extras: [], chapters: [], cast: [] } satisfies TitleDetail).title[0]!;
  expect(model.episodeContext).toBe('Meridian Station · Season 0, Episode 3');
  expect(model.poster).toContain('/poster');
  expect(model.backdrop).toContain('/backdrop');
  expect(card(title).backdrop).toContain('/still');
  expect(card({ ...title, showName: undefined, seasonNumber: undefined }).episodeContext).toBe('Episode 3');
  expect(card({ ...title, kind: 'movie' }).episodeContext).toBe('Meridian Station · Season 0, Episode 3');
  expect(card({ ...title, kind: 'movie' }).backdrop).toContain('/backdrop');
});


test('episode air dates and the server-selected next item reach the display model', () => {
  const next = { ...title, id: 'server-next', airDate: '2025-02-03' };
  const model = detailModel({ title, nextUp: next, episodes: [title, next], extras: [], chapters: [], cast: [] });
  expect(model.nextUp?.[0]?.id).toBe('server-next');
  expect(model.episodes[1]?.facts).toContain('Feb 3, 2025');
  expect(detailModel({ title, nextUp: null, extras: [], chapters: [], cast: [] }).nextUp).toEqual([]);
});

test('parent identifiers survive card and detail projection for any kind', () => {
  const source = { ...title, kind: 'plugin-item' as typeof title.kind };
  expect(card(source)).toMatchObject({ id: 'episode', showId: 'show', seasonId: 'season' });
  expect(detailModel({ title: source, extras: [], chapters: [], cast: [] }).title[0]).toMatchObject({ showId: 'show', seasonId: 'season' });
});

test('context parts carry independently selectable destinations without depending on kind', () => {
  expect(card({ ...title, kind: 'plugin-item' as typeof title.kind }).contextParts).toEqual([
    { label: 'Meridian Station', select: 'show|' },
    { label: 'Season 0', select: 'season|season||show' },
    { label: 'Episode 3', select: 'episode|' },
  ]);
  expect(card({ ...title, showId: undefined, seasonId: undefined }).contextParts[0]?.select).toBe('');
  expect(card({ ...title, seasonId: undefined }).contextParts[1]?.select).toBe('@number:0|season||show');
});
