import { expect, test } from 'bun:test';
import { decodeCountryRuns, encodeCountryRuns } from '../tools/country-map';

test('country-map packing preserves ocean, adjacent IDs and runs longer than 16 bits', () => {
  const ids = new Uint8Array(70004);
  ids.fill(177, 1, 70001);
  ids.set([4, 1, 0], 70001);
  const runs = encodeCountryRuns(ids);
  expect(runs.length).toBe(36);
  expect(Buffer.from(decodeCountryRuns(runs, ids.length)).equals(Buffer.from(ids))).toBe(true);
  expect(() => decodeCountryRuns(runs, ids.length - 1)).toThrow('Invalid country map size');
});
