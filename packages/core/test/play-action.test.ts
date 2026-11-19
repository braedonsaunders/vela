import { expect, test } from 'bun:test';
import { playParams, startPosition } from '../../../apps/vela/src/play-action';
test('play action overrides resume with zero, preserving source and audio', () => {
  expect(playParams('movie|source|audio|0')).toEqual({ id: 'movie', mediaSourceId: 'source', audioTrackId: 'audio', positionSeconds: '0' });
  expect(playParams('episode|||125.5')).toEqual({ id: 'episode', positionSeconds: '125.5' });
  expect(playParams('movie')).toEqual({ id: 'movie' });
});
test('invalid deep link positions defer to server resume policy', () => {
  for (const value of [undefined, '', ' ', '-1', 'NaN', 'Infinity', 'oops']) expect(startPosition(value)).toBeUndefined();
  expect(startPosition('0')).toBe(0);
});
