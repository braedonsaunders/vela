import { expect, test } from 'bun:test';
import { timelineRows } from '../src/blocks/gallery/timeline-layout';

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
