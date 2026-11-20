import { expect, test } from 'bun:test';
import type { Node } from '../../protocol/skin';
import { searchStickyTop } from '../src/search-sticky';

const viewport = { width: 1440, height: 900, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
const children: Node = { type: 'slot', slot: 'children' };

test('home search pins its field edge below wide and compact overlay headers', () => {
  const shell: Node = { type: 'box', children: [
    { type: 'box', role: 'navigation', style: { position: 'absolute', top: '0px', height: '72px' }, small: { height: '60px' } },
    children,
  ] };
  expect(searchStickyTop(shell, false, viewport, 24)).toBe(48);
  expect(searchStickyTop(shell, true, viewport, 18)).toBe(42);
});

test('a flow header needs no second header offset', () => {
  const shell: Node = { type: 'box', children: [
    { type: 'box', role: 'navigation', style: { position: 'relative', height: '64px' } },
    children,
  ] };
  expect(searchStickyTop(shell, false, viewport, 20)).toBe(-20);
});

test('an inset overlay header may declare its height on an inner bezel', () => {
  const shell: Node = { type: 'box', children: [
    { type: 'box', role: 'navigation', style: { position: 'absolute', top: '18px', left: '18px', right: '18px' }, small: { top: '0px' }, children: [
      { type: 'box', style: { position: 'relative', height: '78px' }, small: { height: '58px' } },
    ] },
    children,
  ] };
  expect(searchStickyTop(shell, false, viewport, 34)).toBe(62);
  expect(searchStickyTop(shell, true, viewport, 24)).toBe(34);
});
