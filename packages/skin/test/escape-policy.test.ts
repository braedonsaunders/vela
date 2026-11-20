import { expect, test } from 'bun:test';
import { openScopeFlags } from '../src/escape-policy';

test('only the visible screen can consume Back for an open menu', () => {
  const flags = ['menu', 'drawer'], open = ['menu', 'search-focused'];
  expect(openScopeFlags(flags, open, true)).toEqual(['menu']);
  expect(openScopeFlags(flags, open, false)).toEqual([]);
  expect(openScopeFlags(flags, [], true)).toEqual([]);
  expect(openScopeFlags(flags, open, true)).toEqual(['menu']);
  expect(open).toEqual(['menu', 'search-focused']);
});
