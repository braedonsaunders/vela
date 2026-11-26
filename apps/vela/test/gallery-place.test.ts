import { expect, test } from 'bun:test';
import { galleryPlace, galleryTab, hasGalleryEntries, TIMELINE_PLACE } from '../src/experiences/gallery-place';

test('Photos opens its timeline and preserves only the relevant directory address', () => {
  expect(galleryPlace({ page: 'home', params: {} })).toBe(TIMELINE_PLACE);
  expect(galleryPlace({ page: 'library', params: {} })).toBe(TIMELINE_PLACE);
  expect(galleryPlace({ page: 'person', params: {} })).toBe(TIMELINE_PLACE);
  expect(galleryPlace({ page: 'person', params: { id: 'subject', name: 'Elena Rivers', query: 'unused' } }))
    .toEqual({ page: 'person', params: { id: 'subject', name: 'Elena Rivers' } });
  expect(galleryTab('album')).toBe('albums');
  expect(galleryTab('person')).toBe('people');
  expect(galleryTab('timeline')).toBe('timeline');
});

test('directory tabs require actual entries from the server', () => {
  for (const value of [undefined, 'unsupported', {}, { items: [] }, { items: 'invalid' }]) {
    expect(hasGalleryEntries(value)).toBe(false);
  }
  expect(hasGalleryEntries({ items: [{ $record: 'item:subject' }], more: false })).toBe(true);
});
