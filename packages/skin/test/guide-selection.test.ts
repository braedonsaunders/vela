import { expect, test } from 'bun:test';
import { programmeSelection } from '../src/widgets/guide/selection';

test('every airing selection opens full screen independently of the preview channel', () => {
  expect(programmeSelection(true)).toBe('watch');
});

test('future and ended programmes retain details without tuning', () => {
  expect(programmeSelection(false)).toBe('details');
});
