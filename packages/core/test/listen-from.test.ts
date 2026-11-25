// Where listening starts (moved from the music widgets into core so documents' vela.play resumes
// as the app does): a book in parts at the part under way, a show at its episode under way or its
// newest unheard, an album from its first track; a spoken item on its own at the viewer's place.
import { expect, test } from 'bun:test';
import { listenFrom, playStart, resumePoint } from '../src/audio/cards';
import type { Card } from '../src/models';

const item = (id: string, media: Record<string, unknown>, extra: Partial<Card> = {}): Card =>
  ({ id, name: id, kind: 'episode', progressSeconds: 0, played: false, airDate: '', media: { audio: true, index: 0, ...media }, ...extra }) as unknown as Card;

const book = { media: { class: 'audiobook', role: 'audiobook' } } as unknown as Card;
const show = { media: { class: 'podcast', role: 'show' } } as unknown as Card;
const album = { media: { class: 'music', role: 'album' } } as unknown as Card;

test('a book resumes in the part under way, else the first unheard', () => {
  const parts = [item('p2', { class: 'audiobook', index: 2 }, { progressSeconds: 90 }), item('p1', { class: 'audiobook', index: 1 }, { played: true }), item('p3', { class: 'audiobook', index: 3 })];
  expect(listenFrom(book, parts)).toEqual({ items: [parts[1]!, parts[0]!, parts[2]!], index: 1, positionSeconds: 90 });
  const fresh = [item('p1', { class: 'audiobook', index: 1 }, { played: true }), item('p2', { class: 'audiobook', index: 2 })];
  expect(listenFrom(book, fresh)).toEqual({ items: fresh, index: 1 });
});

test('a show plays its episode under way, else its newest unheard', () => {
  const older = item('e1', { class: 'podcast', index: 1 }, { airDate: '2026-01-01' });
  const newer = item('e2', { class: 'podcast', index: 2 }, { airDate: '2026-02-01' });
  expect(listenFrom(show, [older, newer])).toEqual({ items: [newer], index: 0 });
  const underway = { ...older, progressSeconds: 30 };
  expect(listenFrom(show, [underway, newer])).toEqual({ items: [underway], index: 0, positionSeconds: 30 });
});

test('music starts from the top; only spoken items resume on their own', () => {
  const tracks = [item('t1', { class: 'music' }, { progressSeconds: 50 }), item('t2', { class: 'music' })];
  expect(playStart(album, tracks)).toEqual({ items: tracks, index: 0 });
  expect(resumePoint(tracks[0]!)).toBe(0);
  expect(resumePoint(item('p', { class: 'audiobook' }, { progressSeconds: 12 }))).toBe(12);
  expect(resumePoint(item('p', { class: 'podcast' }, { progressSeconds: 12, played: true }))).toBe(0);
});
