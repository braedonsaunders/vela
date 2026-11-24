// Which libraries open as the audio app (protocol README, Library experience).
import { expect, test } from 'bun:test';
import { libraryExperience } from '../src/library-presentation';

const feature = { available: true, experiences: ['audio', 'standard'] };

test('without the feature a library chooses by its class: music is the audio app, the rest standard', () => {
  expect(libraryExperience({ media: 'music' }, undefined)).toBe('audio');
  expect(libraryExperience({ media: 'audiobook' }, undefined)).toBe('standard');
  expect(libraryExperience({ media: 'podcast' }, undefined)).toBe('standard');
  expect(libraryExperience({}, undefined)).toBe('standard');
  // A server without the feature that sends the field anyway is not believed.
  expect(libraryExperience({ media: 'audiobook', presentation: { experience: 'audio' } }, undefined)).toBe('standard');
  expect(libraryExperience({ media: 'music', presentation: { experience: 'standard' } }, { available: false })).toBe('audio');
});

test('with the feature the library says: a plugin asks for the audio app, or keeps music standard', () => {
  expect(libraryExperience({ media: 'audiobook', presentation: { experience: 'audio' } }, feature)).toBe('audio');
  expect(libraryExperience({ media: 'podcast', presentation: { experience: 'audio' } }, feature)).toBe('audio');
  expect(libraryExperience({ media: 'video', presentation: { experience: 'audio' } }, feature)).toBe('audio');
  expect(libraryExperience({ media: 'music', presentation: { experience: 'standard' } }, feature)).toBe('standard');
});

test('an absent or unknown value is the class default, and a value the server does not list is ignored', () => {
  expect(libraryExperience({ media: 'music' }, feature)).toBe('audio');
  expect(libraryExperience({ media: 'music', presentation: { experience: 'reading' } }, feature)).toBe('audio');
  expect(libraryExperience({ media: 'audiobook', presentation: { experience: 'reading' } }, feature)).toBe('standard');
  expect(libraryExperience({ media: 'audiobook', presentation: { experience: 'audio' } }, { available: true, experiences: ['standard'] })).toBe('standard');
  // An unknown class reads as video.
  expect(libraryExperience({ media: 'hologram' }, feature)).toBe('standard');
});
