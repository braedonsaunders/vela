import { expect, test } from 'bun:test';
import { settledFrame } from '../src/keyframes';

test('settled transient overlays disappear while ordinary entrance content stays visible', () => {
  expect(settledFrame({keyframes:'vanish',duration:300}, {}, false)).toEqual({opacity:0});
  expect(settledFrame({keyframes:'dissolve',duration:300}, {}, false)).toBeUndefined();
  expect(settledFrame({keyframes:'vanish',duration:300,iterations:'infinite'}, {}, false)).toBeUndefined();
});
