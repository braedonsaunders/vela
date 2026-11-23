import { expect, test } from 'bun:test';
import { card, opensMediaPage, podcastOrder } from '../src';
import type { Title } from '../src/wire';

// Which page a title opens is decided by its card kind: media titles carry their role, and photos
// and podcasts have kinds of their own so they never fall to the video title page.
const title = (id: string, extra: Partial<Title> = {}): Title => ({ id, kind: 'movie', name: id, summary: '', genres: [], artwork: [], ...extra });

test('a photo opens the photo page whatever its role', () => {
  const photo = card(title('p', { media: { class: 'photo', role: 'item' } }));
  expect(photo.kind).toBe('photo');
  expect(opensMediaPage(photo.kind)).toBe(true);
});

test("a podcast's show and episodes open media pages; a video show keeps its title page", () => {
  const show = card(title('s', { kind: 'show', media: { class: 'podcast', role: 'show' } }));
  const episode = card(title('e', { kind: 'episode', media: { class: 'podcast', role: 'episode', parents: [{ id: 's', name: 'S', role: 'show' }] } }));
  const loose = card(title('i', { media: { class: 'podcast', role: 'item' } }));
  expect([show.kind, episode.kind, loose.kind]).toEqual(['podcast', 'podcastEpisode', 'podcastEpisode']);
  expect([show, episode, loose].every(c => opensMediaPage(c.kind))).toBe(true);
  expect(episode.media?.parent?.id).toBe('s');
  expect(episode.media?.audio).toBe(true);
  const video = card(title('v', { kind: 'show' }));
  expect(video.kind).toBe('show');
  expect(opensMediaPage(video.kind)).toBe(false);
  // A video-class title with a media block is still video.
  expect(opensMediaPage(card(title('c', { kind: 'show', media: { class: 'video', role: 'show' } })).kind)).toBe(false);
});

test('music, book and audiobook roles keep opening their pages', () => {
  for (const [cls, role] of [['music', 'album'], ['music', 'track'], ['music', 'artist'], ['book', 'book'], ['book', 'series'], ['audiobook', 'audiobook'], ['audiobook', 'part']] as const)
    expect(opensMediaPage(card(title(role, { media: { class: cls, role } })).kind)).toBe(true);
});

test("a podcast's episodes are listed newest first, by date then number", () => {
  const ep = (id: string, airDate: string, index?: number) => card(title(id, { airDate, media: { class: 'podcast', role: 'episode', ...(index ? { index } : {}) } }));
  const ordered = podcastOrder([ep('old', '2024-01-02', 1), ep('new', '2026-05-01', 3), ep('same-2', '2025-03-03', 2), ep('same-5', '2025-03-03', 5)]);
  expect(ordered.map(c => c.id)).toEqual(['new', 'same-5', 'same-2', 'old']);
});
