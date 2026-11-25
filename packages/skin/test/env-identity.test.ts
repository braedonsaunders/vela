// An environment keeps values it rebuilds while they say the same, so tracked nodes that read them
// (the shell's navigation reads the libraries) do not draw again for unrelated changes.
import { expect, test } from 'bun:test';
import { sameDestinations, sameFields } from '../../../apps/vela/src/env-identity';

const movies = { id: 'movies', name: 'Movies', kind: 'movies', dateDisplay: 'date', backdrop: '' } as never;
const screen = () => ({ id: 'screen:sports', name: 'Sports', kind: 'screen', dateDisplay: 'date', backdrop: '' }) as never;

test('a plugin screen entry built afresh is the same destination', () => {
  expect(sameDestinations([movies, screen()], [movies, screen()])).toBe(true);
});

test('a renamed, added, removed or reordered destination is a change', () => {
  expect(sameDestinations([movies, screen()], [movies, { ...(screen() as object), name: 'Live sports' } as never])).toBe(false);
  expect(sameDestinations([movies], [movies, screen()])).toBe(false);
  expect(sameDestinations([screen(), movies], [movies, screen()])).toBe(false);
  expect(sameDestinations(undefined, [movies])).toBe(false);
});

test('flat records compare field by field', () => {
  expect(sameFields({ version: '1', server: 'Ether' }, { version: '1', server: 'Ether' })).toBe(true);
  expect(sameFields({ version: '1', server: 'Ether' }, { version: '2', server: 'Ether' })).toBe(false);
  expect(sameFields({ version: '1' }, { version: '1', server: '' } as { version: string })).toBe(false);
});
