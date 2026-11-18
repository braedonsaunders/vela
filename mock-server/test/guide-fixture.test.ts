import { expect, test } from 'bun:test';
import { scaleGuide } from '../guide-fixture';
for (const count of [1000, 10000] as const) test(`dense ${count} channel fixture bounds generation to requested rows`, () => {
  const fixture = scaleGuide(count);
  expect(fixture.channels.length).toBe(count);
  const from = Date.UTC(2026, 10, 18, 12), until = from + 3600000;
  const rows = [fixture.channels[0]!.id, fixture.channels[count - 1]!.id];
  const guide = fixture.guide(from, until, rows);
  expect(new Set(guide.map(p => p.channelId))).toEqual(new Set(rows));
  expect(guide.length).toBeGreaterThanOrEqual(12);
  for (const p of guide) { expect(Date.parse(p.start)).toBeLessThan(until); expect(Date.parse(p.end)).toBeGreaterThan(from); }
});
test('programme identities and geometry are independent of viewport request order', () => {
  const fixture = scaleGuide(1000), from = Date.UTC(2026, 10, 18), until = from + 3600000;
  expect(fixture.guide(from, until, ['scale-31'])).toEqual(fixture.guide(from, until, ['scale-0', 'scale-31']).filter(p => p.channelId === 'scale-31'));
});
