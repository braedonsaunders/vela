import { expect, test } from 'bun:test';
import { readableInk } from '../src/widgets/guide/contrast';

test('live labels choose the higher-contrast ink from the skin palette', () => {
  expect(readableInk('#e8513f', '#f5f1e9', '#111419')).toBe('#111419');
  expect(readableInk('#1b2430', '#ffffff', '#111419')).toBe('#ffffff');
});
