import { expect, test } from 'bun:test';
import { appearanceModel } from '../src/appearance';
import { settled } from '../src/store/appearance';

const model = (revision: number) => appearanceModel({ revision, defaultSkinId: 'cinematic', defaultEngineId: 'cinematic', force: false, packs: [] }, 'https://server.test');

test('refreshing an unchanged appearance keeps the current model, so the page is not re-resolved', () => {
  const current = model(3);
  expect(settled(current, model(3))).toBe(current);
});

test('a changed or first appearance replaces the model', () => {
  const next = model(4);
  expect(settled(model(3), next)).toBe(next);
  expect(settled(undefined, next)).toBe(next);
});
