import { expect, test } from 'bun:test';
import { Media } from '../src/store/media';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';

const features = (value: object | undefined) => {
  const session = { features: value, onReset() {} } as unknown as Session;
  return new Media(new StateBox({ children: {} } as unknown as VelaState), session, () => 0).features();
};

test('listening is off only when the server says so; reading only where it is advertised', () => {
  // A server without the flags (Ether before W195) plays audio through ordinary playback, and cannot read.
  expect(features({ mediaClasses: { available: true, classes: ['audiobook', 'book'] } })).toEqual({ classes: ['audiobook', 'book'], reading: [], audio: true, childRoles: false });
  expect(features(undefined).audio).toBe(true);
  expect(features({ audioPlayback: { available: true } }).audio).toBe(true);
  expect(features({ audioPlayback: { available: false } }).audio).toBe(false);
  expect(features({ reading: { available: true, formats: ['epub'] } }).reading).toEqual(['epub']);
  expect(features({ reading: { available: false, formats: ['epub'] } }).reading).toEqual([]);
});

test('children are read by child level only when the server states child roles', () => {
  expect(features({ pluginLevels: { available: true, tabRows: true, childRoles: true } }).childRoles).toBe(true);
  expect(features({ pluginLevels: { available: true, tabRows: true } }).childRoles).toBe(false);
  expect(features({ pluginLevels: { available: false, childRoles: true } }).childRoles).toBe(false);
  expect(features(undefined).childRoles).toBe(false);
});
