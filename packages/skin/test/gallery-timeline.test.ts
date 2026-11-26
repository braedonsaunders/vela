import { expect, test } from 'bun:test';
import { orderTimelinePhotos, photoRows, timelineRows } from '../src/blocks/gallery/timeline-layout';

const photo = (id: string, airDate: string) => ({ id, airDate });

test('groups descending calendar dates without shifting a zoned date and puts invalid dates last', () => {
  const rows = timelineRows([
    photo('invalid', '2025-02-29'),
    photo('older', '2025-02-28'),
    photo('newest', '2025-03-01T00:30:00+05:00'),
    photo('missing', ''),
  ], 3);
  expect(rows.map(row => row.kind === 'photos' ? row.photos.map(item => item.id) : row.date))
    .toEqual(['2025-03', ['newest'], '2025-02', ['older'], '', ['invalid', 'missing']]);
});

test('adds day headers only for dense months with multiple days and keeps equal-date order', () => {
  const photos = Array.from({ length: 13 }, (_, index) => photo(String(index), index < 8 ? '2025-04-02' : '2025-04-01'));
  const rows = timelineRows(photos, 4);
  expect(rows.map(row => row.kind)).toEqual(['month', 'day', 'photos', 'photos', 'day', 'photos', 'photos']);
  expect(rows.flatMap(row => row.kind === 'photos' ? row.photos : [])).toEqual(photos);
  expect(timelineRows(photos.slice(0, 9), 4).filter(row => row.kind === 'day')).toEqual([]);
});


test('album and person grids preserve their source order without headings', () => {
  const old = photo('old', '2024-12-02');
  const current = photo('current', '2026-02-15');
  const undated = photo('undated', '');
  expect(photoRows([old, current, undated], 2)).toEqual([
    { kind: 'photos', key: 'old', photos: [old, current] },
    { kind: 'photos', key: 'undated', photos: [undated] },
  ]);
});

test('the opening timeline and its viewer agree about equal dates and undated photos', () => {
  const input = [photo('older', '2025-01-02'), photo('first', '2025-11-03'), photo('second', '2025-11-03'), photo('undated', '')];
  const visible = timelineRows(input, 3).flatMap(row => row.kind === 'photos' ? row.photos : []);
  expect(orderTimelinePhotos(input)).toEqual(visible);
  expect(visible.map(item => item.id)).toEqual(['first', 'second', 'older', 'undated']);
});
