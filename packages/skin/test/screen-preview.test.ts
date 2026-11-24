// Ether Studio's reload message is accepted only from the framing window at the connected origin.
import { expect, test } from 'bun:test';
import { acceptReload } from '../../../apps/vela/src/screen-preview-message';

const parent = {};
const origin = 'https://ether.example';
const message = (data: unknown, extra: Partial<{ source: unknown; origin: string }> = {}) => ({ source: parent, origin, data, ...extra });

test('a reload from the parent at the Ether origin names its screen and page', () => {
  expect(acceptReload(message({ type: 'vela:screen-preview:reload', screen: 'sports', page: 'game' }), parent, origin)).toEqual({ screen: 'sports', page: 'game' });
  expect(acceptReload(message({ type: 'vela:screen-preview:reload' }), parent, origin)).toEqual({ screen: undefined, page: undefined });
});

test('any other window, origin or message is ignored', () => {
  expect(acceptReload(message({ type: 'vela:screen-preview:reload' }, { source: {} }), parent, origin)).toBeUndefined();
  expect(acceptReload(message({ type: 'vela:screen-preview:reload' }, { origin: 'https://evil.example' }), parent, origin)).toBeUndefined();
  expect(acceptReload(message({ type: 'vela:screen-preview:reload' }), parent, undefined)).toBeUndefined();
  expect(acceptReload(message({ type: 'other' }), parent, origin)).toBeUndefined();
  expect(acceptReload(message('vela:screen-preview:reload'), parent, origin)).toBeUndefined();
  expect(acceptReload(message({ type: 'vela:screen-preview:reload', screen: 3 }), parent, origin)).toEqual({ screen: undefined, page: undefined });
});
