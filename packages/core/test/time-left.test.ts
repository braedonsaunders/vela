import { expect, test } from 'bun:test';
import { duration } from '../src/i18n';
import { homeModel } from '../src/discovery/models';

test('time left reads in hours and minutes, the one wording Home and title pages share', () => {
  expect(duration(8940)).toBe('2 h 29 min');
  expect(duration(7200)).toBe('2 h');
  expect(duration(1800)).toBe('30 min');
  expect(duration(20)).toBe('1 min');
});

test("Home's hero says how long is left in that wording", () => {
  const title = { id: 'film', kind: 'movie', name: 'Film', summary: '', genres: [], durationSeconds: 9000, watch: { positionSeconds: 60, played: false, favorite: false, watchlisted: false }, artwork: [] };
  const data = { viewer: { id: 'v', name: 'V', policyRevision: '1' }, capabilities: { features: { liveTV: { available: false }, aiSearch: { available: false }, descriptiveSearch: { available: false } }, skins: [] }, defaultSkinId: 'x', rows: [],
    heroes: [{ title, reason: 'resume', action: { kind: 'resume', titleId: 'film' }, receiptToken: '' }] };
  const [action] = homeModel(data as never).heroActions;
  expect(action).toMatchObject({ actionLabel: 'Resume', actionDetail: '2 h 29 min left' });
});
