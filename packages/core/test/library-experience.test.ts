// How a library opens (protocol README, Library experience): the server's name for it, else what it
// holds, so every library on every server keeps working across an upgrade.
import { expect, test } from 'bun:test';
import { classExperience, libraryExperience, libraryHomeTab, VELA_EXPERIENCES } from '../src/library-presentation';

const feature = { available: true, experiences: ['watch', 'listen', 'read', 'gallery', 'live'] };

test('a server without the feature (older Ether, Jellyfin, Emby, Plex) is read by media class and kind', () => {
  const by = (media: string | undefined, kind = 'mixed') => libraryExperience({ media, kind }, undefined);
  expect(by('music')).toBe('listen');
  expect(by('audiobook')).toBe('listen');
  expect(by('podcast')).toBe('listen');
  expect(by('book')).toBe('read');
  expect(by('comic')).toBe('read');
  expect(by('photo')).toBe('gallery');
  expect(by(undefined, 'live')).toBe('live');
  expect(by('video', 'movies')).toBe('watch');
  expect(by(undefined, 'shows')).toBe('watch');
  expect(by('hologram')).toBe('watch');
  // A server without the feature that sends the field anyway is not believed.
  expect(libraryExperience({ media: 'video', kind: 'movies', experience: 'listen' }, undefined)).toBe('watch');
  expect(libraryExperience({ media: 'music', experience: 'watch' }, { available: false })).toBe('listen');
});

test('with the feature the library names it: any library can listen, read or be a gallery', () => {
  expect(libraryExperience({ media: 'audiobook', experience: 'listen' }, feature)).toBe('listen');
  expect(libraryExperience({ media: 'video', experience: 'listen' }, feature)).toBe('listen');
  expect(libraryExperience({ media: 'music', experience: 'watch' }, feature)).toBe('watch');
  expect(libraryExperience({ media: 'video', experience: 'gallery' }, feature)).toBe('gallery');
  expect(libraryExperience({ media: 'book', experience: 'read' }, feature)).toBe('read');
  expect(libraryExperience({ kind: 'live', experience: 'live' }, feature)).toBe('live');
});

test('an id Vela does not know is watch, never an error; a library without the field falls back to its class', () => {
  expect(libraryExperience({ media: 'music', experience: 'karaoke' }, feature)).toBe('watch');
  expect(libraryExperience({ media: 'photo', experience: 'audio' }, feature)).toBe('watch');
  expect(libraryExperience({ media: 'music' }, feature)).toBe('listen');
  expect(libraryExperience({ media: 'photo', experience: '' }, feature)).toBe('gallery');
  expect(libraryExperience({ kind: 'live', experience: 42 }, feature)).toBe('live');
  // Every fallback is one Vela draws.
  for (const media of ['music', 'audiobook', 'podcast', 'book', 'photo', 'video', 'unknown']) expect(VELA_EXPERIENCES).toContain(classExperience(media, 'mixed'));
});

test("the audio app asks for a library's home tab only when the library declares it", () => {
  expect(libraryHomeTab([{ id: 'home', kind: 'recommended' }, { id: 'browse', kind: 'library' }])).toBe('home');
  expect(libraryHomeTab([{ id: 'recommended', kind: 'recommended' }, { id: 'library', kind: 'library' }])).toBeUndefined();
  expect(libraryHomeTab([{ id: 'home', kind: 'library' }])).toBeUndefined();
  expect(libraryHomeTab(undefined)).toBeUndefined();
});
