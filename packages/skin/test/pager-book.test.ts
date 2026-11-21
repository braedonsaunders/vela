import { expect, test } from 'bun:test';
import { pagerBinding, pagerState, readsPager, reportPager, subscribePager } from '../src/pager-book';

test('a row report reaches only that row, and only when its ends change', () => {
  const calls: string[] = [];
  const stopA = subscribePager('row-a', () => calls.push('a'));
  const stopB = subscribePager('row-b', () => calls.push('b'));
  reportPager('row-a', { atStart: true, atEnd: false });
  reportPager('row-a', { atStart: true, atEnd: false });
  expect(calls).toEqual(['a']);
  expect(pagerState('row-a')).toEqual({ atStart: true, atEnd: false });
  expect(pagerState('row-b')).toBeUndefined();
  stopA();
  reportPager('row-a', { atStart: false, atEnd: false });
  expect(calls).toEqual(['a']);
  stopB();
});

test('a node reads pager state through its own tests, not through its children', () => {
  const atEnd = pagerBinding(() => 'true');
  const other = () => 'x';
  const arrow = { kind: 'box', when: [{ read: other }], disabled: [{ read: atEnd }], children: [] };
  const row = { kind: 'box', when: [{ read: other }], children: [arrow] };
  const repeat = { kind: 'repeat', item: arrow };
  expect(readsPager(arrow)).toBe(true);
  expect(readsPager(row)).toBe(false);
  expect(readsPager(repeat)).toBe(false);
  expect(readsPager({ kind: 'text', text: { parts: ['Next ', atEnd] } })).toBe(true);
});
