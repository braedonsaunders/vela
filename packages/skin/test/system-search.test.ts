import { expect, test } from 'bun:test';
import { systemSearch } from '../src/widgets/search/system-search';

test('only Apple TV searches on the system search screen', () => {
  expect(systemSearch('ios', true)).toBe(true);
  expect(systemSearch('ios', false)).toBe(false);
  expect(systemSearch('ios', undefined)).toBe(false);
  expect(systemSearch('android', true)).toBe(false);
  expect(systemSearch('web', false)).toBe(false);
});
