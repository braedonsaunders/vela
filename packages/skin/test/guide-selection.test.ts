import { expect, test } from 'bun:test';
import { programmeSelection } from '../src/widgets/guide/selection';

test('airing selections tune a different channel and open the current one', () => {
  expect(programmeSelection(true, 'b', 'a')).toBe('preview');
  expect(programmeSelection(true, 'b', 'b')).toBe('watch');
});

test('future and ended programmes never tune, even on the playing channel', () => {
  expect(programmeSelection(false, 'b', 'a')).toBe('details');
  expect(programmeSelection(false, 'a', 'a')).toBe('details');
});
