import { expect, test } from 'bun:test';
import { documentIsVisible } from '../../../apps/vela/src/visible-route';

test('only the visible title participates in focus, including decoded server IDs', () => {
  const id = 'ether:movie:Some Title/part';
  expect(documentIsVisible('title', id, `/title/${id}`)).toBe(true);
  expect(documentIsVisible('title', id, '/title/another')).toBe(false);
  expect(documentIsVisible('title', id, `/watch/${id}`)).toBe(false);
});
test('a person page releases focus to titles and playback over it', () => {
  expect(documentIsVisible('person', 'source-title', '/person')).toBe(true);
  expect(documentIsVisible('person', 'source-title', '/title/movie')).toBe(false);
  expect(documentIsVisible('person', 'source-title', '/watch/movie')).toBe(false);
});
