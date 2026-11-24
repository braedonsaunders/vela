import { expect, test } from 'bun:test';
import { openScopeFlags, pressTakesFocus, successor } from '../src/escape-policy';

test('only the visible screen can consume Back for an open menu', () => {
  const flags = ['menu', 'drawer'], open = ['menu', 'search-focused'];
  expect(openScopeFlags(flags, open, true)).toEqual(['menu']);
  expect(openScopeFlags(flags, open, false)).toEqual([]);
  expect(openScopeFlags(flags, [], true)).toEqual([]);
  expect(openScopeFlags(flags, open, true)).toEqual(['menu']);
  expect(open).toEqual(['menu', 'search-focused']);
});

test('a pressed season tab drawn anew as the chosen one hands focus to its replacement', () => {
  const body = { name: 'body' };
  const pressed = { name: 'Season 2 (off)' }, chosen = { name: 'Season 2 (on)' }, other = { name: 'Season 3' };
  const left = { target: pressed, does: 'select:show|season|2' };
  const drawn = new Map([[other, 'select:show|season|3'], [chosen, 'select:show|season|2']]);
  // Its element left the page, so focus fell to the body (or to nothing).
  expect(successor(left, drawn, body, body)).toBe(chosen);
  expect(successor(left, drawn, null, body)).toBe(chosen);
});

test('focus stays put when the pressed button is still drawn, went elsewhere, or has no replacement', () => {
  const body = { name: 'body' }, button = { name: 'Play' }, field = { name: 'search field' };
  const left = { target: button, does: 'play:t1' };
  // A redraw binds the same element anew: another button doing the same is not taken.
  expect(successor(left, new Map([[button, 'play:t1'], [{ name: 'Play (hero)' }, 'play:t1']]), body, body)).toBeUndefined();
  // The press moved focus on purpose (a menu's first item, a field).
  expect(successor(left, new Map([[{ name: 'Play again' }, 'play:t1']]), field, body)).toBeUndefined();
  // Nothing drawn does what it did (a route that closed).
  expect(successor(left, new Map([[{ name: 'Season 1' }, 'select:show|season|1']]), body, body)).toBeUndefined();
});

test('a button pressed while focus is on the body takes focus; one pressed with focus elsewhere does not', () => {
  const body = { name: 'body' };
  expect(pressTakesFocus(body, body)).toBe(true);
  expect(pressTakesFocus(null, body)).toBe(true);
  expect(pressTakesFocus({ name: 'search field' }, body)).toBe(false);
});
