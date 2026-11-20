import { expect, test } from 'bun:test';
import { appearanceModel } from '../src/appearance';
import { refreshed, refreshing, settled } from '../src/store/appearance';
import { ready } from '../src/store/state';

const model = (revision: number) => appearanceModel({ revision, defaultSkinId: 'cinematic', defaultEngineId: 'cinematic', force: false, packs: [] }, 'https://server.test');

test('refreshing an unchanged appearance keeps the current model, so the page is not re-resolved', () => {
  const current = model(3);
  expect(settled(current, model(3))).toBe(current);
});

test('an unchanged ready appearance is a state-level no-op throughout a background refresh', () => {
  const current = ready(model(3));
  expect(refreshing(current)).toBe(current);
  expect(refreshed(current, model(3))).toBe(current);
});

test('a changed or first appearance replaces the model', () => {
  const next = model(4);
  expect(settled(model(3), next)).toBe(next);
  expect(settled(undefined, next)).toBe(next);
});
