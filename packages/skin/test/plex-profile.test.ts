import { expect, test } from 'bun:test';
import { nextProfilePin, profileGridColumns, profileInitials } from '../src/widgets/auth/connect/plex-profile';

test('Plex Home profile grids grow from two to four columns with the viewport', () => {
  expect(profileGridColumns(390)).toBe(2);
  expect(profileGridColumns(768)).toBe(3);
  expect(profileGridColumns(1440)).toBe(4);
});

test('profile initials are bounded and useful for missing avatars', () => {
  expect(profileInitials('Demo Owner')).toBe('DO');
  expect(profileInitials(' Kids ')).toBe('K');
  expect(profileInitials('')).toBe('?');
});

test('the PIN pad accepts four digits and deletes without exposing the value', () => {
  expect(['1', '2', '3', '4', '5'].reduce(nextProfilePin, '')).toBe('1234');
  expect(nextProfilePin('1234', 'delete')).toBe('123');
  expect(nextProfilePin('12', 'x')).toBe('12');
});
